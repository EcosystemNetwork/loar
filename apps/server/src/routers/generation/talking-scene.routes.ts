/**
 * Talking Scene Router (PRD 8)
 *
 * Single-mutation combo: portrait image + dialogue text + voice → published
 * lip-synced talking-character clip.
 *
 * Pipeline (atomic credit accounting; refunds on any stage failure):
 *   1. ElevenLabs TTS         (voice.synthesize internals)
 *   2. Image-to-video         (generation.dispatchGeneration with veo3 i2v)
 *   3. Lip-sync               (lipSyncService.sync, autoPublish=false)
 *   4. publishToGallery       (with full source-ref lineage)
 *
 * The published gallery doc carries:
 *   parentGenerationId       = lipsync genId
 *   sourceImageUrl           = portrait url
 *   sourceVideoGenerationId  = i2v genId
 *   sourceAudioGenerationId  = tts genId
 */
import { router, protectedProcedure, requirePermission } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { elevenLabsService, type ElevenLabsVoiceModel } from '../../services/elevenlabs';
import { firebaseStorageService } from '../../services/firebase-storage';
import { lipSyncService } from '../../services/lipsync';
import { dispatchGeneration, generateInputSchema } from './generation.routes';
import { getModelById } from '../../services/video-models';
import { publishToGallery } from '../../lib/gallery-publish';
import { extractVideoThumbnail } from '../../services/video-thumbnail';
import { logFailedRefund } from '../../lib/refund-audit';
import { sanitizePrompt } from '../../lib/prompt-sanitize';
import { reserveClientToken } from '../../lib/jobIdempotency';
import { fireJobWebhook, validateWebhookUrl, webhookUrlSchema } from '../../lib/webhooks';
import { assertEditSourceAuthorized } from '../../lib/edit-source-authz';
import { assertVoiceIdAllowed } from '../../lib/voice-authz';

const clientTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'clientToken must match [A-Za-z0-9_-]{16,128}')
  .optional();

// ── Pricing ─────────────────────────────────────────────────────────────
//
// Talking-scene cost is the sum of its sub-ops, billed up-front in one tx so
// refund semantics are atomic. The numbers mirror the per-op credit costs
// already used by voice/lipsync/generation routers.

const LIPSYNC_CREDITS = 5;
const I2V_CREDITS_BASE = 13; // matches LEGACY_CREDIT_COSTS.video in generation.routes
const TTS_PER_CHAR = 0.0034; // eleven_v3 * 1.35 fiat margin / 0.01 USD/credit ≈ 0.0034 cr/char (rounded up)

function estimateTtsCredits(text: string): number {
  return Math.max(1, Math.ceil(text.length * TTS_PER_CHAR));
}

// ── Collections ─────────────────────────────────────────────────────────

const talkingScenesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('talkingScenes');
};

const userCreditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

const voiceGenerationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('voiceGenerations');
};

const videoGenerationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('videoGenerations');
};

// ── Credit helpers ──────────────────────────────────────────────────────

async function deductCredits(uid: string, credits: number): Promise<void> {
  if (!db) throw new Error('Firebase is not configured');
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(uid, credits);
  const ref = userCreditsCol().doc(uid);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const balance = doc.exists ? doc.data()?.balance || 0 : 0;
    if (balance < credits) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Insufficient credits. Need ${credits}, have ${balance}.`,
      });
    }
    tx.update(ref, {
      balance: balance - credits,
      totalSpent: (doc.data()?.totalSpent || 0) + credits,
      updatedAt: new Date(),
    });
  });
}

async function refundCredits(uid: string, credits: number, sceneId: string): Promise<void> {
  try {
    await userCreditsCol()
      .doc(uid)
      .update({
        balance: FieldValue.increment(credits),
        totalSpent: FieldValue.increment(-credits),
        updatedAt: new Date(),
      });
  } catch (err) {
    console.error(`CRITICAL: talking-scene refund failed for ${uid}:`, err);
    logFailedRefund({
      userId: uid,
      credits,
      source: 'talking-scene',
      generationId: sceneId,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
}

// ── Stage helpers ───────────────────────────────────────────────────────

async function runTts(opts: {
  uid: string;
  text: string;
  voiceId: string;
  modelId: ElevenLabsVoiceModel;
}): Promise<{ ttsGenId: string; audioUrl: string }> {
  const ttsGenId = randomUUID();
  const result = await elevenLabsService.textToSpeech({
    text: opts.text,
    voiceId: opts.voiceId,
    modelId: opts.modelId,
  });
  if (!result.audioBuffer || result.audioBuffer.length === 0) {
    throw new Error('TTS returned empty audio');
  }
  const filename = `tts-${ttsGenId}.mp3`;
  const key = await firebaseStorageService.upload(result.audioBuffer, filename);
  const audioUrl = firebaseStorageService.getPublicUrl(key);

  // Persist a minimal voiceGenerations record so the audio shows up in user history.
  await voiceGenerationsCol().doc(ttsGenId).set({
    id: ttsGenId,
    userId: opts.uid,
    type: 'tts',
    modelId: opts.modelId,
    voiceId: opts.voiceId,
    characterCount: opts.text.length,
    status: 'completed',
    audioUrl,
    source: 'talking-scene',
    createdAt: new Date(),
    completedAt: new Date(),
  });

  return { ttsGenId, audioUrl };
}

async function runImageToVideo(opts: {
  uid: string;
  imageUrl: string;
  prompt: string;
  durationSec: number;
}): Promise<{ i2vGenId: string; videoUrl: string; modelId: string }> {
  // Use the standard veo3 i2v model (audio off — we lipsync separately).
  const modelId = 'veo31-i2v';
  const model = getModelById(modelId);
  if (!model) throw new Error(`Talking-scene image-to-video model not found: ${modelId}`);

  const i2vInput = generateInputSchema.parse({
    prompt: opts.prompt,
    imageUrl: opts.imageUrl,
    mode: 'image_to_video',
    durationSec: opts.durationSec,
    aspectRatio: '9:16',
    resolution: '720p',
    audio: false,
  });

  const result = await dispatchGeneration(model, i2vInput);
  if (result.status !== 'completed' || !result.videoUrl) {
    throw new Error(result.error || 'Talking-scene portrait animation failed');
  }

  // Persist a videoGenerations record for downstream lineage queries.
  const i2vGenId = result.id;
  await videoGenerationsCol().doc(i2vGenId).set({
    id: i2vGenId,
    userId: opts.uid,
    modelId,
    mode: 'image_to_video',
    prompt: opts.prompt,
    imageUrl: opts.imageUrl,
    videoUrl: result.videoUrl,
    durationSec: opts.durationSec,
    status: 'completed',
    source: 'talking-scene',
    createdAt: new Date(),
    completedAt: new Date(),
  });

  return { i2vGenId, videoUrl: result.videoUrl, modelId };
}

// ── Router ──────────────────────────────────────────────────────────────

const voiceModelSchema = z.enum([
  'eleven_flash_v2_5',
  'eleven_multilingual_v2',
  'eleven_turbo_v2',
  'eleven_v3',
]);

export const talkingSceneRouter = router({
  estimateCost: protectedProcedure
    .input(z.object({ dialogue: z.string().min(1).max(800) }))
    .query(({ input }) => {
      const tts = estimateTtsCredits(input.dialogue);
      return {
        ttsCredits: tts,
        i2vCredits: I2V_CREDITS_BASE,
        lipsyncCredits: LIPSYNC_CREDITS,
        totalCredits: tts + I2V_CREDITS_BASE + LIPSYNC_CREDITS,
      };
    }),

  create: protectedProcedure
    .use(requirePermission('generation.lipsync'))
    .input(
      z.object({
        imageUrl: z.string().url(),
        // Dialogue cap tightened from 2000 → 800 (M10). 800 chars is ~60–80s of
        // spoken audio at typical TTS pacing — far beyond the 10s clip length,
        // so no legitimate talking-scene needs more. Keeps TTS cost bounded.
        dialogue: z.string().min(1).max(800),
        voiceId: z
          .string()
          .min(10)
          .max(64)
          .regex(/^[A-Za-z0-9_-]+$/, 'voiceId must be alphanumeric'),
        voiceModelId: voiceModelSchema.default('eleven_v3'),
        /** Optional motion instruction layered onto the portrait animation. */
        motionPrompt: z.string().max(500).optional(),
        /** Talking-clip length. Limited to short-form (≤10s). */
        durationSec: z.number().min(3).max(10).default(6),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
        /** Optional — lets the authz layer verify ownership of the portrait. */
        sourceGenerationId: z.string().optional(),
        clientToken: clientTokenSchema,
        webhookUrl: webhookUrlSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertEditSourceAuthorized({
        uid: ctx.user.uid,
        mediaUrl: input.imageUrl,
        sourceGenerationId: input.sourceGenerationId,
      });
      await assertVoiceIdAllowed(ctx.user.uid, input.voiceId);
      const dialogue = sanitizePrompt(input.dialogue);
      const motionPrompt = input.motionPrompt ? sanitizePrompt(input.motionPrompt) : '';
      const sceneId = randomUUID();

      // Idempotency check before credit deduction — talking scenes are
      // expensive (TTS + i2v + lipsync stages).
      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId: sceneId,
          procedure: 'talkingScene.create',
        });
        if (reservation?.existing) {
          const existing = await talkingScenesCol().doc(reservation.existing.jobId).get();
          const d = existing.exists ? (existing.data() as any) : {};
          return {
            sceneId: reservation.existing.jobId,
            status: (d.status ?? 'queued') as string,
            videoUrl: (d.finalVideoUrl ?? null) as string | null,
            ttsGenerationId: (d.ttsGenerationId ?? null) as string | null,
            imageToVideoGenerationId: (d.imageToVideoGenerationId ?? null) as string | null,
            creditsCharged: (d.creditsCharged ?? 0) as number,
            latencyMs: (d.latencyMs ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      // Validate webhookUrl.
      let validatedWebhookUrl: string | undefined;
      if (input.webhookUrl) {
        const check = validateWebhookUrl(input.webhookUrl);
        if (!check.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
        validatedWebhookUrl = check.url;
      }

      const startTime = Date.now();

      const ttsCredits = estimateTtsCredits(dialogue);
      const totalCredits = ttsCredits + I2V_CREDITS_BASE + LIPSYNC_CREDITS;

      // Write initial scene record
      await talkingScenesCol()
        .doc(sceneId)
        .set({
          id: sceneId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          universeId: input.universeId || null,
          imageUrl: input.imageUrl,
          dialogue,
          voiceId: input.voiceId,
          voiceModelId: input.voiceModelId,
          durationSec: input.durationSec,
          creditsCharged: totalCredits,
          status: 'queued',
          createdAt: new Date(),
          ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
          ...(input.clientToken ? { clientToken: input.clientToken } : {}),
        });

      await deductCredits(ctx.user.uid, totalCredits);

      try {
        // 1. TTS
        await talkingScenesCol().doc(sceneId).update({ status: 'tts' });
        const { ttsGenId, audioUrl } = await runTts({
          uid: ctx.user.uid,
          text: dialogue,
          voiceId: input.voiceId,
          modelId: input.voiceModelId,
        });

        // 2. Image → Video (animated portrait)
        await talkingScenesCol().doc(sceneId).update({ status: 'animating' });
        const portraitPrompt =
          motionPrompt ||
          'Talking head portrait, subtle natural facial movement, character speaking with mouth movement and blinks';
        const {
          i2vGenId,
          videoUrl,
          modelId: i2vModelId,
        } = await runImageToVideo({
          uid: ctx.user.uid,
          imageUrl: input.imageUrl,
          prompt: portraitPrompt,
          durationSec: input.durationSec,
        });

        // 3. Lip-sync (autoPublish=false — we publish below with full lineage)
        await talkingScenesCol().doc(sceneId).update({ status: 'lipsyncing' });
        const lipsyncResult = await lipSyncService.sync({
          videoUrl,
          audioUrl,
          model: 'fal-ai/lipsync',
        });
        if (lipsyncResult.status !== 'completed' || !lipsyncResult.videoUrl) {
          throw new Error(lipsyncResult.error || 'Lip-sync stage failed');
        }

        // Permanent re-host of the synced video
        const videoRes = await fetch(lipsyncResult.videoUrl);
        if (!videoRes.ok) throw new Error('Failed to fetch synced video');
        const videoBuffer = Buffer.from(await videoRes.arrayBuffer());
        const filename = `talking-scene-${sceneId}.mp4`;
        const finalKey = await firebaseStorageService.upload(videoBuffer, filename);
        const finalUrl = firebaseStorageService.getPublicUrl(finalKey);

        // 4. Publish to gallery with full source-ref lineage
        const thumbnailUrl = await extractVideoThumbnail(finalUrl, sceneId).catch(() => undefined);
        await publishToGallery({
          creatorUid: ctx.user.uid,
          mediaUrl: finalUrl,
          thumbnailUrl,
          mediaType: 'ai-video',
          title: dialogue.slice(0, 80) || 'Talking Scene',
          description: dialogue,
          universeId: input.universeId ?? null,
          generationId: sceneId,
          generationModel: 'talking-scene',
          parentGenerationId: i2vGenId,
          sourceImageUrl: input.imageUrl,
          sourceVideoGenerationId: i2vGenId,
          sourceAudioGenerationId: ttsGenId,
        });

        const latencyMs = Date.now() - startTime;
        await talkingScenesCol().doc(sceneId).update({
          status: 'completed',
          ttsGenerationId: ttsGenId,
          audioUrl,
          imageToVideoGenerationId: i2vGenId,
          intermediateVideoUrl: videoUrl,
          imageToVideoModelId: i2vModelId,
          finalVideoUrl: finalUrl,
          latencyMs,
          completedAt: new Date(),
        });

        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.completed',
          jobId: sceneId,
          kind: 'video',
          payload: {
            operation: 'talkingScene',
            status: 'completed',
            resultUrl: finalUrl,
            ttsGenerationId: ttsGenId,
            imageToVideoGenerationId: i2vGenId,
            creditsCharged: totalCredits,
            latencyMs,
          },
        });

        return {
          sceneId,
          status: 'completed' as const,
          videoUrl: finalUrl as string | null,
          ttsGenerationId: ttsGenId as string | null,
          imageToVideoGenerationId: i2vGenId as string | null,
          creditsCharged: totalCredits,
          latencyMs,
          idempotentReplay: false as const,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, totalCredits, sceneId);
        await talkingScenesCol()
          .doc(sceneId)
          .update({
            status: 'failed',
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.failed',
          jobId: sceneId,
          kind: 'video',
          payload: {
            operation: 'talkingScene',
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            creditsRefunded: true,
          },
        });
        throw error instanceof TRPCError
          ? error
          : new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: error instanceof Error ? error.message : 'Talking-scene generation failed',
            });
      }
    }),

  getHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ input, ctx }) => {
      const snap = await talkingScenesCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),
});
