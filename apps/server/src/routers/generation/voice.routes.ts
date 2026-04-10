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
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { elevenLabsService, type ElevenLabsVoiceModel } from '../../services/elevenlabs';
import { firebaseStorageService } from '../../services/firebase-storage';
import { trackQuests } from '../../services/quest-tracker';

// ── Pricing constants ─────────────────────────────────────────────────

const FIAT_MARGIN = 1.35;
const LOAR_MARGIN = 1.25;
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

async function refundCredits(userId: string, credits: number): Promise<void> {
  const ref = userCreditsCol().doc(userId);
  try {
    const doc = await ref.get();
    if (doc.exists) {
      await ref.update({ balance: (doc.data()?.balance || 0) + credits, updatedAt: new Date() });
    }
  } catch (err) {
    console.error(`CRITICAL: Voice credit refund failed for ${userId}:`, err);
  }
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

// ── Router ────────────────────────────────────────────────────────────

const voiceModelSchema = z.enum([
  'eleven_flash_v2_5',
  'eleven_multilingual_v2',
  'eleven_turbo_v2',
  'eleven_v3',
]);

export const voiceRouter = router({
  // ── TTS with billing ──────────────────────────────────────────────────

  synthesize: protectedProcedure
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
      })
    )
    .mutation(async ({ input, ctx }) => {
      const genId = randomUUID();
      const startTime = Date.now();

      const charCost = CHAR_COST[input.modelId];
      const providerCost = charCost * input.text.length;
      const fiatPrice = withFiat(providerCost);
      const loarPrice = withLoar(providerCost);
      const credits = toCredits(providerCost);

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
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await voiceGenerationsCol().doc(genId).update({ status: 'running' });

        const result = await elevenLabsService.textToSpeech({
          text: input.text,
          voiceId: input.voiceId,
          modelId: input.modelId,
          stability: input.stability,
          similarityBoost: input.similarityBoost,
          style: input.style,
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

        return {
          generationId: genId,
          status: 'completed' as const,
          audioUrl,
          modelId: input.modelId,
          characterCount: input.text.length,
          creditsCharged: credits,
          fiatPriceUsd: fiatPrice,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits);
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

  // ── Sound effects ─────────────────────────────────────────────────────

  soundEffect: protectedProcedure
    .input(
      z.object({
        text: z.string().min(1).max(500),
        durationSeconds: z.number().min(0.5).max(22).optional(),
        entityId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const genId = randomUUID();
      const credits = toCredits(SOUND_EFFECT_COST_USD);

      await voiceGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          type: 'sound_effect',
          prompt: input.text,
          providerCostUsd: SOUND_EFFECT_COST_USD,
          fiatPriceUsd: withFiat(SOUND_EFFECT_COST_USD),
          loarPriceUsd: withLoar(SOUND_EFFECT_COST_USD),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await voiceGenerationsCol().doc(genId).update({ status: 'running' });

        const result = await elevenLabsService.soundEffect({
          text: input.text,
          durationSeconds: input.durationSeconds,
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

        return {
          generationId: genId,
          status: 'completed' as const,
          audioUrl,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(SOUND_EFFECT_COST_USD),
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits);
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

  // ── Voice design ──────────────────────────────────────────────────────

  designVoice: protectedProcedure
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
      const genId = randomUUID();
      const credits = toCredits(VOICE_DESIGN_COST_USD);

      await voiceGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          type: 'voice_design',
          name: input.name,
          providerCostUsd: VOICE_DESIGN_COST_USD,
          fiatPriceUsd: withFiat(VOICE_DESIGN_COST_USD),
          loarPriceUsd: withLoar(VOICE_DESIGN_COST_USD),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await voiceGenerationsCol().doc(genId).update({ status: 'running' });

        const result = await elevenLabsService.designVoice({
          name: input.name,
          description: input.description,
          text: input.previewText,
          gender: input.gender,
          age: input.age,
          accent: input.accent,
          accentStrength: input.accentStrength,
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
          fiatPriceUsd: withFiat(VOICE_DESIGN_COST_USD),
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits);
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

  cloneVoice: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        description: z.string().optional(),
        audioUrls: z.array(z.string().url()).min(1).max(25),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const genId = randomUUID();
      const credits = toCredits(INSTANT_CLONE_COST_USD);

      await voiceGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          type: 'instant_clone',
          name: input.name,
          providerCostUsd: INSTANT_CLONE_COST_USD,
          fiatPriceUsd: withFiat(INSTANT_CLONE_COST_USD),
          loarPriceUsd: withLoar(INSTANT_CLONE_COST_USD),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
        });

      await deductCredits(ctx.user.uid, credits);

      try {
        await voiceGenerationsCol().doc(genId).update({ status: 'running' });

        // Fetch audio buffers from URLs
        const audioBuffers = await Promise.all(
          input.audioUrls.map(async (url) => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`Failed to fetch audio from ${url}`);
            return Buffer.from(await res.arrayBuffer());
          })
        );

        const result = await elevenLabsService.instantCloneVoice({
          name: input.name,
          description: input.description,
          audioBuffers,
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
        await refundCredits(ctx.user.uid, credits);
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

  // ── Browse voices ─────────────────────────────────────────────────────

  listVoices: publicProcedure.query(async () => {
    if (!elevenLabsService.isConfigured()) return [];
    return elevenLabsService.listVoices();
  }),

  // ── Cost estimate ─────────────────────────────────────────────────────

  estimateCost: publicProcedure
    .input(
      z.object({
        type: z.enum(['tts', 'sound_effect', 'voice_design', 'instant_clone']),
        characterCount: z.number().min(1).optional(), // for TTS
        modelId: voiceModelSchema.optional(),
      })
    )
    .query(({ input }) => {
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
      }

      return {
        providerCostUsd: providerCost,
        fiatPriceUsd: withFiat(providerCost),
        loarPriceUsd: withLoar(providerCost),
        credits: toCredits(providerCost),
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
