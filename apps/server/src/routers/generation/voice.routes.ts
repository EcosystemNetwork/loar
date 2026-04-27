/**
 * Voice Generation Router
 *
 * Studio OS voice and sound layer powered by ElevenLabs.
 * All audio outputs are uploaded to Firebase Storage and returned as URLs.
 *
 * Capabilities:
 *   voice.synthesize      — TTS with routed model selection and credit billing
 *   voice.soundEffect     — Generate a sound effect from a text description
 *   voice.designVoice     — Design a new original voice for a character
 *   voice.cloneVoice      — Instant voice clone from audio samples
 *   voice.listVoices      — Browse available ElevenLabs voices
 *   voice.estimateCost    — Pre-flight cost estimate
 *
 * Voice model pricing per character:
 *   eleven_flash_v2_5      $0.000024/char (fast, low latency)
 *   eleven_multilingual_v2 $0.000030/char (stable, 29 languages)
 *   eleven_turbo_v2        $0.000030/char (turbo quality)
 *   eleven_v3              $0.000040/char (expressive, best emotion)
 *
 * Sound effects: ~$0.08/effect
 * Voice design:  ~$0.08 flat fee
 * Instant clone: ~$0.09 flat fee
 */
import {
  router,
  protectedProcedure,
  publicProcedure,
  requirePermission,
  expensiveProcedure,
} from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { elevenLabsService, type ElevenLabsVoiceModel } from '../../services/elevenlabs';
import { firebaseStorageService } from '../../services/firebase-storage';
import { trackQuests } from '../../services/quest-tracker';
import { FieldValue } from 'firebase-admin/firestore';
import { validateUploadUrl } from '../../lib/url-validator';
import { createAttachment } from '../media/media.handlers';
import { logFailedRefund } from '../../lib/refund-audit';
import { sanitizePrompt } from '../../lib/prompt-sanitize';
import { reserveClientToken } from '../../lib/jobIdempotency';
import { fireJobWebhook, validateWebhookUrl, webhookUrlSchema } from '../../lib/webhooks';
import { publishToGallery } from '../../lib/gallery-publish';
import { TRPCError } from '@trpc/server';

// Idempotency token regex shared across voice procedures.
const clientTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'clientToken must match [A-Za-z0-9_-]{16,128}')
  .optional();

// ── Pricing — loaded from platform config (admin-configurable) ────────

import { getPlatformConfig } from '../../services/platformConfig';

const LOAR_TO_USD = 0.01;

// Provider cost per character (USD)
const CHAR_COST: Record<ElevenLabsVoiceModel, number> = {
  eleven_flash_v2_5: 0.000024,
  eleven_multilingual_v2: 0.00003,
  eleven_turbo_v2: 0.00003,
  eleven_v3: 0.00004,
};

const SOUND_EFFECT_COST_USD = 0.08;
const VOICE_DESIGN_COST_USD = 0.08;
const INSTANT_CLONE_COST_USD = 0.09;
const VOICE_MODIFY_COST_USD = 0.08;

async function getMargins() {
  const cfg = await getPlatformConfig();
  return { fiatMargin: cfg.fiatMargin, loarMargin: cfg.loarMargin };
}
function withFiat(usd: number, fiatMargin = 1.35) {
  return Math.round(usd * fiatMargin * 100) / 100;
}
function withLoar(usd: number, loarMargin = 1.25) {
  return Math.round(usd * loarMargin * 100) / 100;
}
function toCredits(usd: number, fiatMargin = 1.35) {
  return Math.ceil(withFiat(usd, fiatMargin) / LOAR_TO_USD);
}

// ── Collections ───────────────────────────────────────────────────────

const voiceGenerationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('voiceGenerations');
};

// ── Credit deduction helper ───────────────────────────────────────────

const userCreditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

async function deductCredits(userId: string, credits: number): Promise<void> {
  if (!db) throw new Error('Firebase is not configured');
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(userId, credits);
  const ref = userCreditsCol().doc(userId);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const balance = doc.exists ? doc.data()?.balance || 0 : 0;
    if (balance < credits) {
      throw new Error(
        `Insufficient credits. Need ${credits}, have ${balance}. Purchase more to continue.`
      );
    }
    tx.update(ref, {
      balance: balance - credits,
      totalSpent: (doc.data()?.totalSpent || 0) + credits,
      updatedAt: new Date(),
    });
  });
}

async function refundCredits(userId: string, credits: number, genId?: string): Promise<void> {
  const ref = userCreditsCol().doc(userId);
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
    console.error(`CRITICAL: Voice credit refund failed for ${userId}:`, err);
    logFailedRefund({
      userId,
      credits,
      source: 'voice',
      generationId: genId ?? 'unknown',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
  // Refund always pairs with a failed generation — record it for Grafana.
  recordAiGeneration('elevenlabs', 'voice', 'failure');
}

// ── Storage upload helper ─────────────────────────────────────────────

async function uploadAudio(
  buffer: Buffer,
  _contentType: string,
  filename: string
): Promise<string> {
  const key = await firebaseStorageService.upload(buffer, filename);
  return firebaseStorageService.getPublicUrl(key);
}

// ── Fetch with timeout ───────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000; // 30 seconds

async function fetchWithTimeout(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // redirect: 'error' prevents post-validation 3xx bounce to internal metadata endpoints.
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Auto-attach helper ───────────────────────────────────────────────

async function autoAttachAudio(opts: {
  creator: string;
  entityId: string | undefined;
  generationId: string;
  audioUrl: string;
  label: string;
  category: 'sound' | 'music' | 'video';
}) {
  if (!opts.entityId) return;

  let targetName = '';
  try {
    const entityDoc = await db.collection('entities').doc(opts.entityId).get();
    if (!entityDoc.exists) return;
    // Verify the caller owns this entity before attaching
    if (entityDoc.data()?.creator !== opts.creator) return;
    targetName = entityDoc.data()?.name ?? '';
  } catch {
    // Best-effort
  }

  try {
    await createAttachment(opts.creator, {
      contentHash: `gen:${opts.generationId}:audio`,
      originalFilename: `generation-${opts.generationId}.mp3`,
      mimeType: 'audio/mpeg',
      size: 0,
      url: opts.audioUrl,
      targetType: 'entity',
      targetId: opts.entityId,
      targetName,
      category: opts.category,
      label: opts.label,
      generationId: opts.generationId,
    });
  } catch (err) {
    console.error('Failed to auto-attach audio:', err);
  }
}

// ── Router ────────────────────────────────────────────────────────────

const voiceModelSchema = z.enum([
  'eleven_flash_v2_5',
  'eleven_multilingual_v2',
  'eleven_turbo_v2',
  'eleven_v3',
]);

export const voiceRouter = router({
  // ── TTS with billing ──────────────────────────────────────────────────

  // INF-6: ElevenLabs TTS — cost scales with character count ($0.00004/char).
  synthesize: expensiveProcedure
    .use(requirePermission('generation.voice'))
    .input(
      z.object({
        text: z.string().min(1).max(5000),
        voiceId: z.string().min(1),
        modelId: voiceModelSchema.default('eleven_flash_v2_5'),
        stability: z.number().min(0).max(1).optional(),
        similarityBoost: z.number().min(0).max(1).optional(),
        style: z.number().min(0).max(1).optional(),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
        clientToken: clientTokenSchema,
        webhookUrl: webhookUrlSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      input.text = sanitizePrompt(input.text);
      const genId = randomUUID();

      // Validate webhookUrl early — fail before any billable work.
      let validatedWebhookUrl: string | undefined;
      if (input.webhookUrl) {
        const check = validateWebhookUrl(input.webhookUrl);
        if (!check.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
        validatedWebhookUrl = check.url;
      }

      // ── Idempotency (clientToken) ───────────────────────────────────
      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId: genId,
          procedure: 'voice.synthesize',
        });
        if (reservation?.existing) {
          const existingSnap = await voiceGenerationsCol().doc(reservation.existing.jobId).get();
          const d = existingSnap.exists ? (existingSnap.data() as any) : {};
          return {
            generationId: reservation.existing.jobId,
            status: (d.status ?? 'queued') as 'queued' | 'running' | 'completed' | 'failed',
            audioUrl: (d.audioUrl ?? null) as string | null,
            modelId: (d.modelId ?? input.modelId) as string,
            characterCount: (d.characterCount ?? input.text.length) as number,
            creditsCharged: (d.creditsCharged ?? 0) as number,
            fiatPriceUsd: (d.fiatPriceUsd ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      const startTime = Date.now();

      const { fiatMargin, loarMargin } = await getMargins();
      const charCost = CHAR_COST[input.modelId];
      const providerCost = charCost * input.text.length;
      const fiatPrice = withFiat(providerCost, fiatMargin);
      const loarPrice = withLoar(providerCost, loarMargin);
      const credits = toCredits(providerCost, fiatMargin);

      // Save initial record
      await voiceGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          universeId: input.universeId || null,
          type: 'tts',
          modelId: input.modelId,
          voiceId: input.voiceId,
          characterCount: input.text.length,
          providerCostUsd: providerCost,
          fiatPriceUsd: fiatPrice,
          loarPriceUsd: loarPrice,
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
          ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
          ...(input.clientToken ? { clientToken: input.clientToken } : {}),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await voiceGenerationsCol().doc(genId).update({ status: 'running' });

        const { resolveProviderKey } = await import('../../lib/byok');
        const apiKey = await resolveProviderKey(ctx.user.uid, 'elevenlabs');
        const result = await elevenLabsService.textToSpeech({
          text: input.text,
          voiceId: input.voiceId,
          modelId: input.modelId,
          stability: input.stability,
          similarityBoost: input.similarityBoost,
          style: input.style,
          apiKey,
        });

        if (!result.audioBuffer || result.audioBuffer.length === 0) {
          throw new Error('Provider returned empty audio — generation failed silently');
        }

        const filename = `voice-tts-${genId}.mp3`;
        const audioUrl = await uploadAudio(result.audioBuffer, result.contentType, filename);
        const latencyMs = Date.now() - startTime;

        trackQuests(ctx.user.uid, [{ questId: 'first_voice_generation' }]);

        await voiceGenerationsCol().doc(genId).update({
          status: 'completed',
          audioUrl,
          latencyMs,
          completedAt: new Date(),
        });

        // Auto-attach TTS audio to entity
        autoAttachAudio({
          creator: ctx.user.uid,
          entityId: input.entityId,
          generationId: genId,
          audioUrl,
          label: `TTS — ${input.text.slice(0, 60)}`,
          category: 'sound',
        });

        void publishToGallery({
          creatorUid: ctx.user.uid,
          mediaUrl: audioUrl,
          mediaType: 'audio',
          title: input.text.slice(0, 100) || 'Generated Voice',
          description: input.text,
          universeId: input.universeId || null,
          generationId: genId,
          generationModel: `elevenlabs:${input.modelId}`,
        });

        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.completed',
          jobId: genId,
          kind: 'voice',
          payload: {
            status: 'completed',
            audioUrl,
            modelId: input.modelId,
            characterCount: input.text.length,
            creditsCharged: credits,
          },
        });

        return {
          generationId: genId,
          status: 'completed' as const,
          audioUrl: audioUrl as string | null,
          modelId: input.modelId as string,
          characterCount: input.text.length,
          creditsCharged: credits,
          fiatPriceUsd: fiatPrice,
          idempotentReplay: false as const,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, genId);
        await voiceGenerationsCol()
          .doc(genId)
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
          jobId: genId,
          kind: 'voice',
          payload: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            creditsRefunded: true,
          },
        });
        throw error;
      }
    }),

  // ── Sound effects ─────────────────────────────────────────────────────

  // INF-6: ElevenLabs SFX (~$0.08 per call).
  soundEffect: expensiveProcedure
    .use(requirePermission('generation.voice'))
    .input(
      z.object({
        text: z.string().min(1).max(500),
        durationSeconds: z.number().min(0.5).max(22).optional(),
        entityId: z.string().optional(),
        clientToken: clientTokenSchema,
        webhookUrl: webhookUrlSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      input.text = sanitizePrompt(input.text);
      const genId = randomUUID();

      // Validate webhookUrl early.
      let validatedWebhookUrl: string | undefined;
      if (input.webhookUrl) {
        const check = validateWebhookUrl(input.webhookUrl);
        if (!check.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
        validatedWebhookUrl = check.url;
      }

      // ── Idempotency (clientToken) ───────────────────────────────────
      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId: genId,
          procedure: 'voice.soundEffect',
        });
        if (reservation?.existing) {
          const existingSnap = await voiceGenerationsCol().doc(reservation.existing.jobId).get();
          const d = existingSnap.exists ? (existingSnap.data() as any) : {};
          return {
            generationId: reservation.existing.jobId,
            status: (d.status ?? 'queued') as 'queued' | 'running' | 'completed' | 'failed',
            audioUrl: (d.audioUrl ?? null) as string | null,
            creditsCharged: (d.creditsCharged ?? 0) as number,
            fiatPriceUsd: (d.fiatPriceUsd ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      const { fiatMargin, loarMargin } = await getMargins();
      const credits = toCredits(SOUND_EFFECT_COST_USD, fiatMargin);

      await voiceGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          type: 'sound_effect',
          prompt: input.text,
          providerCostUsd: SOUND_EFFECT_COST_USD,
          fiatPriceUsd: withFiat(SOUND_EFFECT_COST_USD, fiatMargin),
          loarPriceUsd: withLoar(SOUND_EFFECT_COST_USD, loarMargin),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
          ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
          ...(input.clientToken ? { clientToken: input.clientToken } : {}),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await voiceGenerationsCol().doc(genId).update({ status: 'running' });

        const { resolveProviderKey: resolveSfxKey } = await import('../../lib/byok');
        const apiKey = await resolveSfxKey(ctx.user.uid, 'elevenlabs');
        const result = await elevenLabsService.soundEffect({
          text: input.text,
          durationSeconds: input.durationSeconds,
          apiKey,
        });

        if (!result.audioBuffer || result.audioBuffer.length === 0) {
          throw new Error(
            'Provider returned empty audio — sound effect generation failed silently'
          );
        }

        const filename = `voice-sfx-${genId}.mp3`;
        const audioUrl = await uploadAudio(result.audioBuffer, result.contentType, filename);

        await voiceGenerationsCol().doc(genId).update({
          status: 'completed',
          audioUrl,
          completedAt: new Date(),
        });

        // Auto-attach sound effect to entity
        autoAttachAudio({
          creator: ctx.user.uid,
          entityId: input.entityId,
          generationId: genId,
          audioUrl,
          label: `SFX — ${input.text.slice(0, 60)}`,
          category: 'sound',
        });

        void publishToGallery({
          creatorUid: ctx.user.uid,
          mediaUrl: audioUrl,
          mediaType: 'audio',
          title: input.text.slice(0, 100) || 'Generated SFX',
          description: input.text,
          generationId: genId,
          generationModel: 'elevenlabs:sound_effect',
          tags: ['sfx'],
        });

        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.completed',
          jobId: genId,
          kind: 'voice',
          payload: {
            status: 'completed',
            audioUrl,
            creditsCharged: credits,
          },
        });

        return {
          generationId: genId,
          status: 'completed' as const,
          audioUrl: audioUrl as string | null,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(SOUND_EFFECT_COST_USD, fiatMargin),
          idempotentReplay: false as const,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, genId);
        await voiceGenerationsCol()
          .doc(genId)
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
          jobId: genId,
          kind: 'voice',
          payload: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            creditsRefunded: true,
          },
        });
        throw error;
      }
    }),

  // ── Voice design ──────────────────────────────────────────────────────

  // INF-6: ElevenLabs voice design (~$0.08 per call).
  designVoice: expensiveProcedure
    .use(requirePermission('generation.voice'))
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().min(1).max(500),
        previewText: z.string().min(10).max(300),
        gender: z.enum(['male', 'female', 'neutral']).optional(),
        age: z.enum(['young', 'middle_aged', 'old']).optional(),
        accent: z.string().optional(),
        accentStrength: z.number().min(0.3).max(2.0).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fiatMargin, loarMargin } = await getMargins();
      const genId = randomUUID();
      const credits = toCredits(VOICE_DESIGN_COST_USD, fiatMargin);

      await voiceGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          type: 'voice_design',
          name: input.name,
          providerCostUsd: VOICE_DESIGN_COST_USD,
          fiatPriceUsd: withFiat(VOICE_DESIGN_COST_USD, fiatMargin),
          loarPriceUsd: withLoar(VOICE_DESIGN_COST_USD, loarMargin),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await voiceGenerationsCol().doc(genId).update({ status: 'running' });

        const { resolveProviderKey: resolveDesignKey } = await import('../../lib/byok');
        const apiKey = await resolveDesignKey(ctx.user.uid, 'elevenlabs');
        const result = await elevenLabsService.designVoice({
          name: input.name,
          description: input.description,
          text: input.previewText,
          gender: input.gender,
          age: input.age,
          accent: input.accent,
          accentStrength: input.accentStrength,
          apiKey,
        });

        if (!result.audioBuffer || result.audioBuffer.length === 0 || !result.voiceId) {
          throw new Error('Provider returned empty response — voice design failed silently');
        }

        const filename = `voice-design-preview-${genId}.mp3`;
        const audioUrl = await uploadAudio(result.audioBuffer, result.contentType, filename);

        await voiceGenerationsCol().doc(genId).update({
          status: 'completed',
          voiceId: result.voiceId,
          audioUrl,
          completedAt: new Date(),
        });

        return {
          generationId: genId,
          status: 'completed' as const,
          voiceId: result.voiceId,
          audioUrl,
          name: input.name,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(VOICE_DESIGN_COST_USD, fiatMargin),
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, genId);
        await voiceGenerationsCol()
          .doc(genId)
          .update({
            status: 'failed',
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        throw error;
      }
    }),

  // ── Instant voice clone ───────────────────────────────────────────────

  // INF-6: ElevenLabs voice cloning — uploads samples + trains.
  cloneVoice: expensiveProcedure
    .use(requirePermission('generation.voice'))
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        audioUrls: z.array(z.string().url()).min(1).max(25),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fiatMargin, loarMargin } = await getMargins();
      const genId = randomUUID();
      const credits = toCredits(INSTANT_CLONE_COST_USD, fiatMargin);

      await voiceGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          type: 'instant_clone',
          name: input.name,
          providerCostUsd: INSTANT_CLONE_COST_USD,
          fiatPriceUsd: withFiat(INSTANT_CLONE_COST_USD, fiatMargin),
          loarPriceUsd: withLoar(INSTANT_CLONE_COST_USD, loarMargin),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await voiceGenerationsCol().doc(genId).update({ status: 'running' });

        // Fetch audio buffers from URLs (validate SSRF + enforce 30s timeout per URL)
        const audioBuffers = await Promise.all(
          input.audioUrls.map(async (url) => {
            await validateUploadUrl(url);
            const res = await fetchWithTimeout(url);
            if (!res.ok) throw new Error(`Failed to fetch audio from ${url}`);
            return Buffer.from(await res.arrayBuffer());
          })
        );

        const { resolveProviderKey: resolveCloneKey } = await import('../../lib/byok');
        const apiKey = await resolveCloneKey(ctx.user.uid, 'elevenlabs');
        const result = await elevenLabsService.instantCloneVoice({
          name: input.name,
          description: input.description,
          audioBuffers,
          apiKey,
        });

        if (!result.voiceId) {
          throw new Error('Provider returned empty response — voice clone failed silently');
        }

        await voiceGenerationsCol().doc(genId).update({
          status: 'completed',
          voiceId: result.voiceId,
          completedAt: new Date(),
        });

        return {
          generationId: genId,
          status: 'completed' as const,
          voiceId: result.voiceId,
          name: result.name,
          creditsCharged: credits,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, genId);
        await voiceGenerationsCol()
          .doc(genId)
          .update({
            status: 'failed',
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        throw error;
      }
    }),

  // ── Voice modify (swap + effect) ──────────────────────────────────────

  // INF-6: ElevenLabs voice modification (~$0.08 per call).
  modify: expensiveProcedure
    .use(requirePermission('generation.voice'))
    .input(
      z.object({
        audioUrl: z.string().url(),
        targetVoiceId: z
          .string()
          .min(10)
          .max(64)
          .regex(/^[A-Za-z0-9_-]+$/, 'voiceId must be alphanumeric'),
        modelId: z
          .enum(['eleven_multilingual_sts_v2', 'eleven_english_sts_v2'])
          .default('eleven_multilingual_sts_v2'),
        stability: z.number().min(0).max(1).optional(),
        similarityBoost: z.number().min(0).max(1).optional(),
        style: z.number().min(0).max(1).optional(),
        removeBackgroundNoise: z.boolean().optional(),
        presetId: z.string().optional(), // for analytics: which Effects preset was picked
        entityId: z.string().optional(),
        universeId: z.string().optional(),
        parentGenerationId: z.string().optional(),
        clientToken: clientTokenSchema,
        webhookUrl: webhookUrlSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // C1 + C2 + H8: source-asset IDOR, voice allowlist, and (below) content-type check
      const { assertEditSourceAuthorized } = await import('../../lib/edit-source-authz');
      const { assertVoiceIdAllowed } = await import('../../lib/voice-authz');
      await assertEditSourceAuthorized({
        uid: ctx.user.uid,
        mediaUrl: input.audioUrl,
        sourceGenerationId: input.parentGenerationId,
      });
      await assertVoiceIdAllowed(ctx.user.uid, input.targetVoiceId);
      const genId = randomUUID();

      let validatedWebhookUrl: string | undefined;
      if (input.webhookUrl) {
        const check = validateWebhookUrl(input.webhookUrl);
        if (!check.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
        validatedWebhookUrl = check.url;
      }

      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId: genId,
          procedure: 'voice.modify',
        });
        if (reservation?.existing) {
          const existingSnap = await voiceGenerationsCol().doc(reservation.existing.jobId).get();
          const d = existingSnap.exists ? (existingSnap.data() as any) : {};
          return {
            generationId: reservation.existing.jobId,
            status: (d.status ?? 'queued') as 'queued' | 'running' | 'completed' | 'failed',
            audioUrl: (d.audioUrl ?? null) as string | null,
            creditsCharged: (d.creditsCharged ?? 0) as number,
            fiatPriceUsd: (d.fiatPriceUsd ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      const startTime = Date.now();
      const { fiatMargin, loarMargin } = await getMargins();
      const credits = toCredits(VOICE_MODIFY_COST_USD, fiatMargin);

      await voiceGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          universeId: input.universeId || null,
          type: 'voice_modify',
          modelId: input.modelId,
          voiceId: input.targetVoiceId,
          sourceAudioUrl: input.audioUrl,
          parentGenerationId: input.parentGenerationId || null,
          presetId: input.presetId || null,
          providerCostUsd: VOICE_MODIFY_COST_USD,
          fiatPriceUsd: withFiat(VOICE_MODIFY_COST_USD, fiatMargin),
          loarPriceUsd: withLoar(VOICE_MODIFY_COST_USD, loarMargin),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
          ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
          ...(input.clientToken ? { clientToken: input.clientToken } : {}),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await voiceGenerationsCol().doc(genId).update({ status: 'running' });

        // Fetch source audio (SSRF-validated + timed out)
        await validateUploadUrl(input.audioUrl);
        const sourceRes = await fetchWithTimeout(input.audioUrl);
        if (!sourceRes.ok) {
          throw new Error('Failed to fetch source audio');
        }
        // H8: verify the fetched resource is actually audio before we forward
        // it to the voice-changer. Rejecting here prevents us paying for a
        // provider call that'll 4xx on obviously-wrong payloads (JSON, HTML,
        // binary garbage) and avoids arbitrary-MIME smuggling.
        const sourceContentType =
          sourceRes.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
        if (!sourceContentType || !sourceContentType.startsWith('audio/')) {
          throw new Error('Source URL did not return an audio content-type');
        }
        const sourceBuffer = Buffer.from(await sourceRes.arrayBuffer());
        if (sourceBuffer.length === 0) {
          throw new Error('Source audio is empty');
        }
        // Cap the pulled payload at 50 MB — longer clips have never been a
        // legitimate input to voice-modify and bloat ElevenLabs cost.
        if (sourceBuffer.length > 50 * 1024 * 1024) {
          throw new Error('Source audio exceeds 50MB');
        }

        const { resolveProviderKey: resolveChangerKey } = await import('../../lib/byok');
        const apiKey = await resolveChangerKey(ctx.user.uid, 'elevenlabs');
        const result = await elevenLabsService.voiceChanger({
          audioBuffer: sourceBuffer,
          voiceId: input.targetVoiceId,
          modelId: input.modelId,
          stability: input.stability,
          similarityBoost: input.similarityBoost,
          style: input.style,
          removeBackgroundNoise: input.removeBackgroundNoise,
          apiKey,
        });

        if (!result.audioBuffer || result.audioBuffer.length === 0) {
          throw new Error('Provider returned empty audio — voice modify failed silently');
        }

        const filename = `voice-modify-${genId}.mp3`;
        const audioUrl = await uploadAudio(result.audioBuffer, result.contentType, filename);
        const latencyMs = Date.now() - startTime;

        await voiceGenerationsCol().doc(genId).update({
          status: 'completed',
          audioUrl,
          latencyMs,
          completedAt: new Date(),
        });

        autoAttachAudio({
          creator: ctx.user.uid,
          entityId: input.entityId,
          generationId: genId,
          audioUrl,
          label: `Voice modify — ${input.presetId || input.targetVoiceId.slice(0, 8)}`,
          category: 'sound',
        });

        void publishToGallery({
          creatorUid: ctx.user.uid,
          mediaUrl: audioUrl,
          mediaType: 'audio',
          title: input.presetId ? `Voice: ${input.presetId}` : `Voice modify`,
          description: input.presetId || '',
          universeId: input.universeId || null,
          generationId: genId,
          generationModel: `elevenlabs:${input.modelId}`,
          tags: ['voice-modify', ...(input.presetId ? [input.presetId] : [])],
        });

        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.completed',
          jobId: genId,
          kind: 'voice',
          payload: {
            status: 'completed',
            audioUrl,
            modelId: input.modelId,
            creditsCharged: credits,
          },
        });

        return {
          generationId: genId,
          status: 'completed' as const,
          audioUrl: audioUrl as string | null,
          modelId: input.modelId as string,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(VOICE_MODIFY_COST_USD, fiatMargin),
          idempotentReplay: false as const,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, genId);
        await voiceGenerationsCol()
          .doc(genId)
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
          jobId: genId,
          kind: 'voice',
          payload: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            creditsRefunded: true,
          },
        });
        throw error;
      }
    }),

  // ── Browse voices ─────────────────────────────────────────────────────

  listVoices: publicProcedure.query(async () => {
    if (!elevenLabsService.isConfigured()) return [];
    return elevenLabsService.listVoices();
  }),

  // ── Cost estimate ─────────────────────────────────────────────────────

  estimateCost: publicProcedure
    .input(
      z.object({
        type: z.enum(['tts', 'sound_effect', 'voice_design', 'instant_clone', 'voice_modify']),
        characterCount: z.number().min(1).optional(), // for TTS
        modelId: voiceModelSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const { fiatMargin, loarMargin } = await getMargins();
      let providerCost: number;

      switch (input.type) {
        case 'tts': {
          const model = input.modelId || 'eleven_flash_v2_5';
          const chars = input.characterCount || 100;
          providerCost = CHAR_COST[model as ElevenLabsVoiceModel] * chars;
          break;
        }
        case 'sound_effect':
          providerCost = SOUND_EFFECT_COST_USD;
          break;
        case 'voice_design':
          providerCost = VOICE_DESIGN_COST_USD;
          break;
        case 'instant_clone':
          providerCost = INSTANT_CLONE_COST_USD;
          break;
        case 'voice_modify':
          providerCost = VOICE_MODIFY_COST_USD;
          break;
      }

      return {
        providerCostUsd: providerCost,
        fiatPriceUsd: withFiat(providerCost, fiatMargin),
        loarPriceUsd: withLoar(providerCost, loarMargin),
        credits: toCredits(providerCost, fiatMargin),
      };
    }),

  // ── History ───────────────────────────────────────────────────────────

  history: protectedProcedure
    .input(
      z.object({ limit: z.number().min(1).max(100).default(20), entityId: z.string().optional() })
    )
    .query(async ({ input, ctx }) => {
      let query = voiceGenerationsCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.entityId) {
        query = voiceGenerationsCol()
          .where('userId', '==', ctx.user.uid)
          .where('entityId', '==', input.entityId)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      }

      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),
});
