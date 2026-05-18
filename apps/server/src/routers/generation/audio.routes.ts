/**
 * Audio/Music Generation Router
 *
 * AI-powered music and audio generation with smart model routing and credit billing.
 *
 * Capabilities:
 *   audio.listModels     — Browse available audio/music models
 *   audio.estimateCost   — Pre-flight cost estimate
 *   audio.generate       — Generate music/audio with smart routing + billing
 *   audio.getRecord      — Get generation status by ID
 *   audio.history        — User's audio generation history
 *
 * Models:
 *   stable-audio-2         ~$0.04/gen  (premium, up to 47s)
 *   musicgen-large          ~$0.02/gen  (standard, up to 30s)
 *   musicgen-stereo-large   ~$0.03/gen  (standard stereo, up to 30s)
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
import { falService } from '../../services/fal';
import { firebaseStorageService } from '../../services/firebase-storage';
import { trackQuests } from '../../services/quest-tracker';
import { createAttachment } from '../media/media.handlers';
import { publishToGallery } from '../../lib/gallery-publish';
import { withReservation } from '../../services/credits';
import {
  getVisibleModels,
  getModelById,
  getModelIds,
  routeModel,
  validateManualSelection,
  markProviderUnhealthy,
  markProviderHealthy,
} from '../../services/audio-models';
import type { AudioGenerationMode, RoutingMode } from '../../services/audio-models';
import { getPlatformConfig } from '../../services/platformConfig';
import { sanitizePrompt } from '../../lib/prompt-sanitize';

// ── Pricing helpers ──────────────────────────────────────────────────

const LOAR_TO_USD = 0.01;

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

// ── Collections ──────────────────────────────────────────────────────

const audioGenerationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('audioGenerations');
};

// ── Storage upload helper ────────────────────────────────────────────

async function uploadAudio(buffer: Buffer, filename: string): Promise<string> {
  const key = await firebaseStorageService.upload(buffer, filename);
  return firebaseStorageService.getPublicUrl(key);
}

// ── Auto-attach helper ───────────────────────────────────────────────

async function autoAttachAudio(opts: {
  creator: string;
  entityId: string | undefined;
  generationId: string;
  audioUrl: string;
  label: string;
}) {
  if (!opts.entityId) return;

  let targetName = '';
  try {
    const entityDoc = await db.collection('entities').doc(opts.entityId).get();
    if (!entityDoc.exists) return;
    if (entityDoc.data()?.creator !== opts.creator) return;
    targetName = entityDoc.data()?.name ?? '';
  } catch {
    // Best-effort
  }

  try {
    await createAttachment(opts.creator, {
      contentHash: `gen:${opts.generationId}:music`,
      originalFilename: `music-${opts.generationId}.mp3`,
      mimeType: 'audio/mpeg',
      size: 0,
      url: opts.audioUrl,
      targetType: 'entity',
      targetId: opts.entityId,
      targetName,
      category: 'music',
      label: opts.label,
      generationId: opts.generationId,
    });
  } catch (err) {
    console.error('Failed to auto-attach music:', err);
  }
}

// ── Map model IDs to FAL IDs ─────────────────────────────────────────

function toFalModel(modelId: string): string {
  const model = getModelById(modelId);
  if (!model?.falModelId) throw new Error(`No FAL model mapping for: ${modelId}`);
  return model.falModelId;
}

// ── Router ───────────────────────────────────────────────────────────

const audioModeSchema = z.enum(['text_to_music', 'text_to_sound']);
const routingModeSchema = z.enum(['auto', 'manual']);

export const audioRouter = router({
  // ── List models ────────────────────────────────────────────────────
  listModels: publicProcedure.query(() => {
    return getVisibleModels().map((m) => ({
      id: m.id,
      displayName: m.displayName,
      shortDescription: m.shortDescription,
      mode: m.mode,
      qualityTier: m.qualityTier,
      maxDurationSec: m.maxDurationSec,
      supportedDurations: m.supportedDurations,
      fiatPriceUsd: m.fiatPriceUsd,
      loarPriceUsd: m.loarPriceUsd,
      creditCost: m.creditCost,
      tags: m.tags,
      bestFor: m.bestFor,
    }));
  }),

  // ── Cost estimate ──────────────────────────────────────────────────
  estimateCost: publicProcedure
    .input(
      z.object({
        mode: audioModeSchema.default('text_to_music'),
        durationSec: z.number().min(1).max(60).default(15),
        modelId: z.string().optional(),
        qualityTarget: z.enum(['draft', 'standard', 'premium']).optional(),
      })
    )
    .query(async ({ input }) => {
      const { fiatMargin, loarMargin } = await getMargins();

      if (input.modelId) {
        const model = getModelById(input.modelId);
        if (!model) throw new Error(`Unknown model: ${input.modelId}`);
        return {
          modelId: model.id,
          modelName: model.displayName,
          providerCostUsd: model.providerCostUsd,
          fiatPriceUsd: withFiat(model.providerCostUsd, fiatMargin),
          loarPriceUsd: withLoar(model.providerCostUsd, loarMargin),
          credits: toCredits(model.providerCostUsd, fiatMargin),
        };
      }

      const decision = routeModel({
        mode: input.mode,
        durationSec: input.durationSec,
        qualityTarget: input.qualityTarget,
      });

      return {
        modelId: decision.chosenModelId,
        modelName: getModelById(decision.chosenModelId)?.displayName ?? decision.chosenModelId,
        providerCostUsd: decision.providerCostUsd,
        fiatPriceUsd: withFiat(decision.providerCostUsd, fiatMargin),
        loarPriceUsd: withLoar(decision.providerCostUsd, loarMargin),
        credits: toCredits(decision.providerCostUsd, fiatMargin),
      };
    }),

  // ── Generate music/audio ───────────────────────────────────────────
  // INF-6: FAL stable-audio / musicgen (~$0.02–0.04 per call).
  generate: expensiveProcedure
    .use(requirePermission('generation.audio'))
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        mode: audioModeSchema.default('text_to_music'),
        durationSec: z.number().min(1).max(60).default(15),
        routingMode: routingModeSchema.default('auto'),
        selectedModelId: z.string().optional(),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
        genre: z.string().max(100).optional(),
        style: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      input.prompt = sanitizePrompt(input.prompt);
      const genId = randomUUID();
      const startTime = Date.now();
      const { fiatMargin, loarMargin } = await getMargins();

      // Route to model
      let modelId: string;
      let providerCost: number;
      let reasonCode: string;

      if (input.routingMode === 'manual' && input.selectedModelId) {
        const model = validateManualSelection(input.selectedModelId);
        modelId = model.id;
        providerCost = model.providerCostUsd;
        reasonCode = 'manual_user_selection';
      } else {
        const decision = routeModel({
          mode: input.mode,
          durationSec: input.durationSec,
          qualityTarget: 'standard',
        });
        modelId = decision.chosenModelId;
        providerCost = decision.providerCostUsd;
        reasonCode = decision.reasonCode;
      }

      const fiatPrice = withFiat(providerCost, fiatMargin);
      const loarPrice = withLoar(providerCost, loarMargin);
      const credits = toCredits(providerCost, fiatMargin);
      const model = getModelById(modelId)!;

      // Save initial record
      await audioGenerationsCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          universeId: input.universeId || null,
          routingMode: input.routingMode,
          requestedModelId: input.selectedModelId || null,
          finalModelId: modelId,
          provider: model.provider,
          status: 'queued',
          prompt: input.prompt,
          mode: input.mode,
          durationSec: input.durationSec,
          genre: input.genre || null,
          style: input.style || null,
          providerCostUsd: providerCost,
          fiatPriceUsd: fiatPrice,
          loarPriceUsd: loarPrice,
          creditsCharged: credits,
          marginUsd: fiatPrice - providerCost,
          routingReasonCode: reasonCode,
          createdAt: new Date(),
        });

      try {
        return await withReservation(
          {
            userId: ctx.user.uid,
            modelId,
            provider: model.provider,
            estimatedCredits: credits,
            byok: false,
            meta: {
              generationId: genId,
              entityId: input.entityId ?? null,
              universeId: input.universeId ?? null,
            },
          },
          async () => {
            await audioGenerationsCol().doc(genId).update({ status: 'running' });

            // Build prompt with genre/style context
            let fullPrompt = input.prompt;
            if (input.genre) fullPrompt = `${input.genre} music: ${fullPrompt}`;
            if (input.style) fullPrompt = `${input.style} style. ${fullPrompt}`;

            const { resolveProviderKey } = await import('../../lib/byok');
            let audioBuffer: Buffer;

            if (model.provider === 'google') {
              const googleKey = await resolveProviderKey(ctx.user.uid, 'google');
              if (!googleKey) {
                throw new Error('GOOGLE_API_KEY is not configured — set one in /settings/api-keys');
              }
              const { lyriaGenerate } = await import('../../services/gemini');
              const lyria = await lyriaGenerate({
                apiKey: googleKey,
                model: model.googleModelId ?? 'lyria-3-clip-preview',
                prompt: fullPrompt,
              });
              audioBuffer = lyria.audioBuffer;
            } else if (model.provider === 'elevenlabs') {
              const elevenKey = await resolveProviderKey(ctx.user.uid, 'elevenlabs');
              if (!elevenKey) {
                throw new Error(
                  'ELEVENLABS_API_KEY is not configured — set one in /settings/api-keys'
                );
              }
              const { elevenLabsService } = await import('../../services/elevenlabs');
              if (input.mode === 'text_to_sound') {
                const sfx = await elevenLabsService.soundEffect({
                  text: fullPrompt,
                  durationSeconds: Math.min(Math.max(input.durationSec ?? 5, 0.5), 22),
                  apiKey: elevenKey,
                });
                audioBuffer = sfx.audioBuffer;
              } else {
                const music = await elevenLabsService.composeMusic({
                  prompt: fullPrompt,
                  musicLengthMs: Math.min(
                    Math.max((input.durationSec ?? 30) * 1000, 3000),
                    600_000
                  ),
                  apiKey: elevenKey,
                });
                audioBuffer = music.audioBuffer;
              }
            } else {
              // Default: FAL
              const falModelId = toFalModel(modelId);
              const apiKey = await resolveProviderKey(ctx.user.uid, 'fal');
              const result = await falService.generateAudio({
                prompt: fullPrompt,
                model: falModelId as any,
                durationSec: input.durationSec,
                apiKey,
              });
              if (result.status === 'failed' || !result.audioUrl) {
                throw new Error(result.error || 'Audio generation failed — no audio returned');
              }
              const audioRes = await fetch(result.audioUrl);
              if (!audioRes.ok) throw new Error('Failed to download generated audio from provider');
              audioBuffer = Buffer.from(await audioRes.arrayBuffer());
            }

            const filename = `music-${genId}.mp3`;
            const permanentUrl = await uploadAudio(audioBuffer, filename);

            const latencyMs = Date.now() - startTime;

            markProviderHealthy(model.provider);

            trackQuests(ctx.user.uid, [{ questId: 'first_music_generation' }]);

            await audioGenerationsCol().doc(genId).update({
              status: 'completed',
              audioUrl: permanentUrl,
              permanentAudioUrl: permanentUrl,
              latencyMs,
              completedAt: new Date(),
            });

            // Auto-attach to entity
            autoAttachAudio({
              creator: ctx.user.uid,
              entityId: input.entityId,
              generationId: genId,
              audioUrl: permanentUrl,
              label: `Music — ${input.prompt.slice(0, 60)}`,
            });

            const audioTags = [input.genre, input.style].filter(Boolean) as string[];
            void publishToGallery({
              creatorUid: ctx.user.uid,
              mediaUrl: permanentUrl,
              mediaType: 'audio',
              title: input.prompt.slice(0, 100) || 'Generated Audio',
              description: input.prompt,
              universeId: input.universeId || null,
              generationId: genId,
              generationModel: modelId,
              tags: audioTags,
            });

            return {
              result: {
                generationId: genId,
                status: 'completed' as const,
                audioUrl: permanentUrl,
                modelId,
                modelName: model.displayName,
                durationSec: input.durationSec,
                creditsCharged: credits,
                fiatPriceUsd: fiatPrice,
                loarPriceUsd: loarPrice,
                latencyMs,
              },
            };
          }
        );
      } catch (error) {
        markProviderUnhealthy(model.provider);
        await audioGenerationsCol()
          .doc(genId)
          .update({
            status: 'failed',
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        throw error;
      }
    }),

  // ── Get record ─────────────────────────────────────────────────────
  getRecord: protectedProcedure
    .input(z.object({ generationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await audioGenerationsCol().doc(input.generationId).get();
      if (!doc.exists) throw new Error('Audio generation not found');
      const data = doc.data()!;
      if (data.userId !== ctx.user.uid) throw new Error('Not authorized');
      return { id: doc.id, ...data };
    }),

  // ── History ────────────────────────────────────────────────────────
  history: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        entityId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      let query = audioGenerationsCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.entityId) {
        query = audioGenerationsCol()
          .where('userId', '==', ctx.user.uid)
          .where('entityId', '==', input.entityId)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      }

      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),
});
