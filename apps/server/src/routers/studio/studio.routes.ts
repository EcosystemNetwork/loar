/**
 * Studio Orchestrator — Entity Asset Pack Generation
 *
 * The top-level "Studio OS" endpoint. Users select an entity and a set of
 * capabilities; the orchestrator fans out to image, voice, 3D, video, and
 * wiki generation, then links all outputs back to the entity via the media
 * attachments system.
 *
 * Capabilities per entity kind:
 *
 *   person / character
 *     portrait       — 4 images (square_hd, Nano Banana or routed)
 *     voice          — TTS sample of a character line
 *     sound_motif    — ElevenLabs sound effect
 *     intro_video    — 5-8s image-to-video animation of best portrait
 *     3d_model       — Meshy image-to-3D from best portrait
 *     lore_card      — Wikia text summary via Gemini
 *
 *   place
 *     hero_image     — 4 landscape_16_9 images
 *     ambience_sound — ElevenLabs sound effect
 *     establishing_shot — image-to-video
 *     lore_card
 *
 *   thing / artifact
 *     product_shot   — 4 images (landscape or square)
 *     sound_effect   — ElevenLabs SFX
 *     3d_model       — Meshy image-to-3D
 *     lore_card
 *
 *   event
 *     keyframe_image — 4 landscape_16_9 images
 *     animated_short — image-to-video
 *     lore_card
 *
 * API:
 *   studio.createEntityPack   — Start a full or partial asset pack job
 *   studio.getJob             — Poll job + task status
 *   studio.listJobs           — List jobs for an entity
 *   studio.estimatePackCost   — Pre-flight cost for a capability set
 */
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { falService } from '../../services/fal';
import { elevenLabsService } from '../../services/elevenlabs';
import { meshyService } from '../../services/meshy';
import { geminiService } from '../../services/gemini';
import { routeImageModel, getImageModelById } from '../../services/image-models';
import {
  routeModel as routeVideoModel,
  getModelById as getVideoModelById,
} from '../../services/video-models';
import { firebaseStorageService } from '../../services/firebase-storage';
import { trackQuests } from '../../services/quest-tracker';
import { logFailedRefund } from '../../lib/refund-audit';
import { reserveClientToken } from '../../lib/jobIdempotency';
import { fireJobWebhook, validateWebhookUrl, webhookUrlSchema } from '../../lib/webhooks';
import { TRPCError } from '@trpc/server';
import { createAttachment } from '../media/media.handlers';

// ── Types ─────────────────────────────────────────────────────────────

const CAPABILITIES = [
  'portrait',
  'hero_image',
  'product_shot',
  'keyframe_image',
  'voice',
  'sound_motif',
  'ambience_sound',
  'sound_effect',
  'intro_video',
  'establishing_shot',
  'animated_short',
  '3d_model',
  'lore_card',
] as const;

type Capability = (typeof CAPABILITIES)[number];

// Capability → modality mapping
const CAPABILITY_MODALITY: Record<Capability, string> = {
  portrait: 'image',
  hero_image: 'image',
  product_shot: 'image',
  keyframe_image: 'image',
  voice: 'voice',
  sound_motif: 'voice',
  ambience_sound: 'voice',
  sound_effect: 'voice',
  intro_video: 'video',
  establishing_shot: 'video',
  animated_short: 'video',
  '3d_model': '3d',
  lore_card: 'text',
};

// Approximate provider cost per capability (USD)
const CAPABILITY_COST_USD: Record<Capability, number> = {
  portrait: 0.006 * 4, // 4 images × Nano Banana
  hero_image: 0.006 * 4,
  product_shot: 0.006 * 4,
  keyframe_image: 0.006 * 4,
  voice: 0.000024 * 200, // 200 chars × Flash v2.5
  sound_motif: 0.08,
  ambience_sound: 0.08,
  sound_effect: 0.08,
  intro_video: 0.25, // Veo 3.1 fast i2v
  establishing_shot: 0.25,
  animated_short: 0.25,
  '3d_model': 0.15, // image-to-3D
  lore_card: 0.01, // Gemini text gen (estimate)
};

const FIAT_MARGIN = 1.35;
const LOAR_MARGIN = 1.25;
const LOAR_TO_USD = 0.01;

function withFiat(usd: number) {
  return Math.round(usd * FIAT_MARGIN * 100) / 100;
}
function withLoar(usd: number) {
  return Math.round(usd * LOAR_MARGIN * 100) / 100;
}
function toCredits(usd: number) {
  return Math.ceil(withFiat(usd) / LOAR_TO_USD);
}

// ── Collections ───────────────────────────────────────────────────────

const studioJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('studioJobs');
};

// ── Credit helpers ────────────────────────────────────────────────────

async function deductCredits(userId: string, credits: number): Promise<void> {
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(userId, credits);
  const ref = db.collection('userCredits').doc(userId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const balance = doc.exists ? doc.data()?.balance || 0 : 0;
    if (balance < credits) {
      throw new Error(`Insufficient credits. Need ${credits}, have ${balance}.`);
    }
    tx.update(ref, {
      balance: balance - credits,
      totalSpent: (doc.data()?.totalSpent || 0) + credits,
      updatedAt: new Date(),
    });
  });
}

async function refundCredits(userId: string, credits: number): Promise<void> {
  if (credits <= 0) return;
  const ref = db.collection('userCredits').doc(userId);
  const { recordCreditsTx, recordAiGeneration } = await import('../../lib/metrics');
  try {
    await ref.update({
      balance: FieldValue.increment(credits),
      totalSpent: FieldValue.increment(-credits),
      updatedAt: new Date(),
    });
    recordCreditsTx('refund', 'success');
  } catch (err) {
    recordCreditsTx('refund', 'failure');
    console.error(`CRITICAL: Studio pack credit refund failed for ${userId}:`, err);
    logFailedRefund({
      userId,
      credits,
      source: 'studio',
      generationId: 'pack',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
  recordAiGeneration('multi', 'studio', 'failure');
}

// ── Task runners ──────────────────────────────────────────────────────

interface TaskResult {
  capability: Capability;
  status: 'completed' | 'failed';
  modality: string;
  urls?: string[];
  text?: string;
  modelId?: string;
  creditsUsed: number;
  failureReason?: string;
}

async function runImageTask(
  capability: Capability,
  prompt: string,
  imageSize: 'square_hd' | 'landscape_16_9',
  numImages: number
): Promise<TaskResult> {
  const modality = 'image';
  const decision = routeImageModel({ task: 'text_to_image' });
  const model = getImageModelById(decision.chosenModelId);
  const creditsUsed = decision.creditCostPerImage * numImages;

  try {
    const result = await falService.generateImage({
      prompt,
      model: model?.falModelId as any,
      imageSize,
      numImages,
    });

    if (result.status !== 'completed' || !result.images?.length) {
      return { capability, status: 'failed', modality, creditsUsed, failureReason: result.error };
    }

    return {
      capability,
      status: 'completed',
      modality,
      urls: result.images.map((img) => img.url),
      modelId: decision.chosenModelId,
      creditsUsed,
    };
  } catch (err) {
    return {
      capability,
      status: 'failed',
      modality,
      creditsUsed: 0,
      failureReason: err instanceof Error ? err.message : 'Image generation failed',
    };
  }
}

async function runVideoTask(
  capability: Capability,
  prompt: string,
  imageUrl: string | undefined
): Promise<TaskResult> {
  const modality = 'video';
  const mode = imageUrl ? 'image_to_video' : 'text_to_video';
  const decision = routeVideoModel({ mode, durationSec: 5, resolution: '720p', audio: false });
  const model = getVideoModelById(decision.chosenModelId);
  const creditsUsed = decision.creditCost;

  try {
    const result = await falService.generateVideo({
      prompt,
      model: model?.falModelId as any,
      imageUrl,
      duration: 5,
      aspectRatio: '16:9',
    });

    if (result.status === 'failed' || !result.videoUrl) {
      return { capability, status: 'failed', modality, creditsUsed, failureReason: result.error };
    }

    return {
      capability,
      status: 'completed',
      modality,
      urls: [result.videoUrl],
      modelId: decision.chosenModelId,
      creditsUsed,
    };
  } catch (err) {
    return {
      capability,
      status: 'failed',
      modality,
      creditsUsed: 0,
      failureReason: err instanceof Error ? err.message : 'Video generation failed',
    };
  }
}

async function runSoundTask(capability: Capability, prompt: string): Promise<TaskResult> {
  const modality = 'voice';
  const creditsUsed = toCredits(CAPABILITY_COST_USD[capability]);

  try {
    const result = await elevenLabsService.soundEffect({ text: prompt, durationSeconds: 3 });
    const key = await firebaseStorageService.upload(
      result.audioBuffer,
      `studio-sfx-${randomUUID()}.mp3`
    );
    const url = firebaseStorageService.getPublicUrl(key);

    return { capability, status: 'completed', modality, urls: [url], creditsUsed };
  } catch (err) {
    return {
      capability,
      status: 'failed',
      modality,
      creditsUsed: 0,
      failureReason: err instanceof Error ? err.message : 'Sound generation failed',
    };
  }
}

async function runVoiceTask(
  capability: Capability,
  text: string,
  voiceId: string
): Promise<TaskResult> {
  const modality = 'voice';
  const creditsUsed = toCredits(CAPABILITY_COST_USD[capability]);

  try {
    const result = await elevenLabsService.textToSpeech({ text, voiceId });
    const key = await firebaseStorageService.upload(
      result.audioBuffer,
      `studio-tts-${randomUUID()}.mp3`
    );
    const url = firebaseStorageService.getPublicUrl(key);

    return { capability, status: 'completed', modality, urls: [url], creditsUsed };
  } catch (err) {
    return {
      capability,
      status: 'failed',
      modality,
      creditsUsed: 0,
      failureReason: err instanceof Error ? err.message : 'Voice synthesis failed',
    };
  }
}

async function run3DTask(
  capability: Capability,
  imageUrl: string | undefined,
  prompt: string | undefined
): Promise<TaskResult> {
  const modality = '3d';
  const creditsUsed = toCredits(CAPABILITY_COST_USD[capability]);

  try {
    let taskId: string;
    if (imageUrl) {
      const result = await meshyService.imageTo3D({ imageUrl, enablePbr: true });
      taskId = result.taskId;
    } else if (prompt) {
      const result = await meshyService.textTo3DPreview({ prompt });
      taskId = result.taskId;
    } else {
      throw new Error('3D generation requires either an imageUrl or a prompt');
    }

    const task = await meshyService.waitForTask(
      taskId,
      imageUrl ? 'image-to-3d' : 'text-to-3d',
      15 * 60 * 1000
    );

    const urls = Object.values(task.modelUrls).filter(Boolean) as string[];

    return { capability, status: 'completed', modality, urls, creditsUsed };
  } catch (err) {
    return {
      capability,
      status: 'failed',
      modality,
      creditsUsed: 0,
      failureReason: err instanceof Error ? err.message : '3D generation failed',
    };
  }
}

async function runLoreTask(
  entityName: string,
  entityKind: string,
  description: string
): Promise<TaskResult> {
  const creditsUsed = toCredits(CAPABILITY_COST_USD.lore_card);

  try {
    const text = await geminiService.generateEntityLore(entityName, entityKind, description);
    return {
      capability: 'lore_card',
      status: 'completed',
      modality: 'text',
      text,
      creditsUsed,
    };
  } catch (err) {
    return {
      capability: 'lore_card',
      status: 'failed',
      modality: 'text',
      creditsUsed: 0,
      failureReason: err instanceof Error ? err.message : 'Lore generation failed',
    };
  }
}

// ── Router ────────────────────────────────────────────────────────────

export const studioRouter = router({
  /**
   * Estimate total credits/cost for a capability set before committing.
   */
  estimatePackCost: publicProcedure
    .input(
      z.object({
        capabilities: z.array(z.enum(CAPABILITIES)).min(1),
      })
    )
    .query(({ input }) => {
      const items = input.capabilities.map((cap) => {
        const providerCost = CAPABILITY_COST_USD[cap];
        return {
          capability: cap,
          modality: CAPABILITY_MODALITY[cap],
          providerCostUsd: providerCost,
          fiatPriceUsd: withFiat(providerCost),
          loarPriceUsd: withLoar(providerCost),
          credits: toCredits(providerCost),
        };
      });

      const totalProviderCost = items.reduce((s, i) => s + i.providerCostUsd, 0);
      return {
        items,
        totalProviderCostUsd: Math.round(totalProviderCost * 100) / 100,
        totalFiatPriceUsd: withFiat(totalProviderCost),
        totalLoarPriceUsd: withLoar(totalProviderCost),
        totalCredits: toCredits(totalProviderCost),
      };
    }),

  /**
   * Create an entity asset pack job.
   * Fans out to all requested capabilities, links results to the entity via
   * mediaAttachments, and returns a job ID for status polling.
   */
  createEntityPack: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        entityKind: z.string().min(1), // 'person', 'place', 'thing', 'event', etc.
        entityName: z.string().min(1),
        entityDescription: z.string().min(1),
        capabilities: z.array(z.enum(CAPABILITIES)).min(1),

        // Optional overrides
        imagePromptOverride: z.string().optional(),
        videoPromptOverride: z.string().optional(),
        voiceText: z.string().optional(), // for voice capability
        voiceId: z.string().optional(), // ElevenLabs voice ID for voice capability
        soundPromptOverride: z.string().optional(),

        // Idempotency token — see docs/prd-mcp-integration.md §2.
        clientToken: z
          .string()
          .min(16)
          .max(128)
          .regex(/^[A-Za-z0-9_-]+$/, 'clientToken must match [A-Za-z0-9_-]{16,128}')
          .optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify entity exists before charging
      const entityDoc = await db.collection('entities').doc(input.entityId).get();
      if (!entityDoc.exists) {
        throw new Error(
          `Entity "${input.entityId}" not found. Cannot create asset pack for a non-existent entity.`
        );
      }

      const jobId = randomUUID();

      // ── Idempotency (clientToken) ───────────────────────────────────
      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId,
          procedure: 'studio.createEntityPack',
        });
        if (reservation?.existing) {
          const existingSnap = await studioJobsCol().doc(reservation.existing.jobId).get();
          const d = existingSnap.exists ? (existingSnap.data() as any) : {};
          return {
            jobId: reservation.existing.jobId,
            status: (d.status ?? 'running') as 'running' | 'completed' | 'failed',
            capabilities: (d.capabilities ?? input.capabilities) as typeof input.capabilities,
            totalCreditsCharged: (d.totalCreditsCharged ?? 0) as number,
            totalFiatPriceUsd: (d.totalFiatPriceUsd ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      // Estimate total credits upfront
      const totalProviderCost = input.capabilities.reduce(
        (s, cap) => s + CAPABILITY_COST_USD[cap],
        0
      );
      const totalCredits = toCredits(totalProviderCost);

      // Create job record
      await studioJobsCol()
        .doc(jobId)
        .set({
          id: jobId,
          userId: ctx.user.uid,
          entityId: input.entityId,
          entityKind: input.entityKind,
          entityName: input.entityName,
          capabilities: input.capabilities,
          status: 'running',
          totalCreditsCharged: totalCredits,
          totalFiatPriceUsd: withFiat(totalProviderCost),
          tasks: [],
          createdAt: new Date(),
        });

      // Deduct credits upfront
      try {
        await deductCredits(ctx.user.uid, totalCredits);
      } catch (err) {
        await studioJobsCol()
          .doc(jobId)
          .update({
            status: 'failed',
            failureReason: err instanceof Error ? err.message : 'Credit deduction failed',
            completedAt: new Date(),
          });
        throw err;
      }

      // Fan out capability tasks (fire-and-forget, runs in background)
      runPackJob(jobId, ctx.user.uid, input, totalCredits).catch((err) => {
        console.error(`Studio pack job ${jobId} failed:`, err);
      });

      return {
        jobId,
        status: 'running' as const,
        capabilities: input.capabilities,
        totalCreditsCharged: totalCredits,
        totalFiatPriceUsd: withFiat(totalProviderCost),
        idempotentReplay: false as const,
      };
    }),

  getJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await studioJobsCol().doc(input.jobId).get();
      if (!doc.exists) return null;
      const data = doc.data()!;
      if (data.userId !== ctx.user.uid) throw new Error('Not authorized');
      return { id: doc.id, ...data };
    }),

  listJobs: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async ({ input, ctx }) => {
      const snapshot = await studioJobsCol()
        .where('userId', '==', ctx.user.uid)
        .where('entityId', '==', input.entityId)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),
});

// ── Background job runner ──────────────────────────────────────────────

async function runPackJob(
  jobId: string,
  userId: string,
  input: {
    entityId: string;
    entityKind: string;
    entityName: string;
    entityDescription: string;
    capabilities: Capability[];
    imagePromptOverride?: string;
    videoPromptOverride?: string;
    voiceText?: string;
    voiceId?: string;
    soundPromptOverride?: string;
  },
  totalCreditsCharged: number
): Promise<void> {
  const results: TaskResult[] = [];
  let creditsActuallyUsed = 0;

  // Image prompt used across image/video/3d tasks
  const imagePrompt =
    input.imagePromptOverride ||
    `${input.entityKind} portrait of ${input.entityName}, ${input.entityDescription}, high quality concept art, detailed, cinematic lighting`;

  // Track first completed image URL for downstream tasks (video, 3D)
  let firstImageUrl: string | undefined;

  // Run capabilities in order — image first so video/3D can reference it
  for (const capability of input.capabilities) {
    let result: TaskResult;

    switch (capability) {
      case 'portrait':
      case 'product_shot':
        result = await runImageTask(capability, imagePrompt, 'square_hd', 4);
        if (result.status === 'completed' && result.urls?.length) {
          firstImageUrl = result.urls[0];
        }
        break;

      case 'hero_image':
      case 'keyframe_image':
        result = await runImageTask(capability, imagePrompt, 'landscape_16_9', 4);
        if (result.status === 'completed' && result.urls?.length) {
          firstImageUrl = result.urls[0];
        }
        break;

      case 'voice': {
        const text =
          input.voiceText || `${input.entityName}. ${input.entityDescription.slice(0, 150)}`;
        const voiceId = input.voiceId || 'pNInz6obpgDQGcFmaJgB'; // default ElevenLabs Adam
        result = await runVoiceTask(capability, text, voiceId);
        break;
      }

      case 'sound_motif':
      case 'ambience_sound':
      case 'sound_effect': {
        const soundPrompt =
          input.soundPromptOverride ||
          `${capability === 'ambience_sound' ? 'Ambient background soundscape for' : 'Sound effect for'} ${input.entityName}, ${input.entityDescription.slice(0, 100)}`;
        result = await runSoundTask(capability, soundPrompt);
        break;
      }

      case 'intro_video':
      case 'establishing_shot':
      case 'animated_short': {
        const videoPrompt =
          input.videoPromptOverride ||
          `Cinematic shot of ${input.entityName}, ${input.entityDescription.slice(0, 200)}, smooth camera movement, high quality`;
        result = await runVideoTask(capability, videoPrompt, firstImageUrl);
        break;
      }

      case '3d_model':
        result = await run3DTask(capability, firstImageUrl, imagePrompt);
        break;

      case 'lore_card':
        result = await runLoreTask(input.entityName, input.entityKind, input.entityDescription);
        break;
    }

    results.push(result);
    creditsActuallyUsed += result.creditsUsed;

    // Attach completed assets to entity via mediaAttachments
    if (result.status === 'completed' && result.urls?.length) {
      for (const url of result.urls) {
        try {
          const mimeType =
            result.modality === 'video'
              ? 'video/mp4'
              : result.modality === 'voice'
                ? 'audio/mpeg'
                : result.modality === '3d'
                  ? 'model/gltf-binary'
                  : 'image/jpeg';
          await createAttachment(userId, {
            contentHash: `studio:${jobId}:${capability}:${url.split('/').pop() || ''}`,
            originalFilename: url.split('/').pop() || capability,
            mimeType,
            size: 0,
            url,
            targetType: 'entity',
            targetId: input.entityId,
            targetName: input.entityName,
            category: CAPABILITY_MODALITY[capability] as any,
            label: capability,
            generationId: jobId,
          });
        } catch (attachErr) {
          console.error(`Failed to attach studio asset ${capability}:`, attachErr);
        }
      }
    }

    // Persist lore card text to entity
    if (result.status === 'completed' && result.text) {
      await db.collection('entities').doc(input.entityId).update({
        loreCard: result.text,
        updatedAt: new Date(),
      });
    }
  }

  // Refund unused credits
  const creditsToRefund = totalCreditsCharged - creditsActuallyUsed;
  if (creditsToRefund > 0) {
    await refundCredits(userId, creditsToRefund);
  }

  const completedCount = results.filter((r) => r.status === 'completed').length;
  const jobStatus =
    completedCount === 0 ? 'failed' : completedCount < results.length ? 'partial' : 'completed';

  trackQuests(userId, [{ questId: 'first_studio_pack' }]);

  await studioJobsCol()
    .doc(jobId)
    .update({
      status: jobStatus,
      tasks: results,
      totalCreditsActuallyUsed: creditsActuallyUsed,
      totalCreditsRefunded: creditsToRefund > 0 ? creditsToRefund : 0,
      completedAt: new Date(),
    });
}
