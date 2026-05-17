/**
 * Video Editing Router
 *
 * Post-processing operations on existing video/image content:
 * - Upscale (4× super-resolution)
 * - Frame interpolation (smooth slow-motion)
 * - Video-to-video restyle (preserve motion, change style)
 * - Inpainting (region replacement on frames)
 * - Background removal
 * - Video extension (continue a clip)
 *
 * All operations charge credits and persist records to Firestore.
 */
import { router, protectedProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { falService } from '../../services/fal';
import {
  getEditingModelById,
  getEditingModelsForOperation,
  getEnabledEditingModels,
  getDefaultModelForOperation,
  type EditingJobRecord,
  type EditingOperation,
  type InpaintMode,
} from '../../services/editing-models';
import { publishToGallery } from '../../lib/gallery-publish';
import { recordAssetEventAsync } from '../../services/lineage';
import type { AssetEventStep, AssetOutputKind } from '../../services/lineage/types';
import { reserveClientToken } from '../../lib/jobIdempotency';
import { fireJobWebhook, validateWebhookUrl, webhookUrlSchema } from '../../lib/webhooks';
import { assertEditSourceAuthorized } from '../../lib/edit-source-authz';
import { assertSafeExternalUrl } from '../../lib/safe-fetch-url';
import { withReservation } from '../../services/credits';

// Prompt length caps. Kept tight (≤500) because these strings are forwarded to
// Flux/FAL/Google where unbounded input drives GPU memory and provider cost.
// Composition adds ~200 chars of scaffolding, so user input + scaffolding still
// stays well under downstream model context limits.
const PROMPT_MAX = 500;
const NEG_PROMPT_MAX = 500;

function safeErrorMessage(raw: string | undefined, fallback: string): string {
  const msg = raw?.trim() || fallback;
  // Strip provider names so error strings don't disclose the routing stack.
  return msg
    .replace(/\bFAL\b/gi, 'provider')
    .replace(/\bGoogle\b/gi, 'provider')
    .replace(/\bImagen\b/gi, 'provider')
    .replace(/\bFlux\b/gi, 'model')
    .replace(/\bElevenLabs\b/gi, 'provider');
}

// Shared idempotency + webhook schema fragments for this router's mutations.
const clientTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'clientToken must match [A-Za-z0-9_-]{16,128}')
  .optional();

// ── Collections ─────────────────────────────────────────────────────────

const editingJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('editingJobs');
};

// Credit handling moved to `withReservation` (`../../services/credits`).
// Each procedure below wraps the provider call in a reservation that
// reconciles on success and cancels on thrown error.

const EDIT_OUTPUT_KIND: Record<EditingOperation, AssetOutputKind> = {
  upscale: 'image',
  interpolate: 'video',
  restyle: 'video',
  inpaint: 'image',
  remove_bg: 'image',
  extend: 'video',
  relight: 'image',
  retexture: 'image',
};

async function saveJobRecord(record: EditingJobRecord): Promise<void> {
  await editingJobsCol()
    .doc(record.id)
    .set({ ...record, createdAt: record.createdAt, completedAt: record.completedAt || null });

  // PRD 10: lineage event for this edit step.
  const promptRefs: Array<{ kind: 'image' | 'mask'; url: string }> = [];
  if (record.inputUrl) promptRefs.push({ kind: 'image', url: record.inputUrl });
  if ((record as any).maskUrl) promptRefs.push({ kind: 'mask', url: (record as any).maskUrl });

  recordAssetEventAsync({
    assetId: record.id,
    parentAssetId: record.sourceGenerationId ?? record.sourceAttachmentId ?? null,
    kind: 'edit',
    tool: record.modelId,
    step: record.operation as AssetEventStep,
    prompt: record.prompt ?? null,
    promptRefs,
    modelId: record.modelId,
    creditCost: record.creditsCharged ?? 0,
    latencyMs: record.latencyMs ?? null,
    creatorUid: record.userId,
    universeAddress: record.universeAddress?.toLowerCase() ?? null,
    outputUrl: record.outputUrl ?? null,
    outputKind: EDIT_OUTPUT_KIND[record.operation],
    status: record.status === 'completed' ? 'completed' : 'failed',
  });
}

// ── Throttle ────────────────────────────────────────────────────────────
// NOTE (L15): this throttle lives in-process. On a multi-instance deployment
// (e.g. horizontal autoscaling on Railway/Fly) a coordinated attacker can
// bypass it by spraying across replicas. The spend-cap in
// `lib/generation-guards.ts` is the authoritative global limiter — this map
// only softens accidental client-side double-clicks. If the deployment
// scales beyond a single node, migrate this to Redis (see lib/redis.ts)
// rather than relaxing the cap.

const lastEditByUser = new Map<string, number>();

function checkEditThrottle(userId: string, minMs = 2_000): void {
  const now = Date.now();
  const last = lastEditByUser.get(userId);
  if (last && now - last < minMs) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `Please wait before submitting another edit.`,
    });
  }
  lastEditByUser.set(userId, now);
}

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [key, ts] of lastEditByUser) {
    if (ts < cutoff) lastEditByUser.delete(key);
  }
}, 5 * 60_000);

// ── Zod Schemas ─────────────────────────────────────────────────────────

const operationSchema = z.enum([
  'upscale',
  'interpolate',
  'restyle',
  'inpaint',
  'remove_bg',
  'extend',
  'relight',
]);

const inpaintModeSchema = z.enum(['replace', 'remove', 'add', 'fix']);

// Negative prompt that always applies to remove/replace/fix actions — blocks the
// common artifacts users hit when Flux tries to re-paint a region that should be
// blank or should match surrounding texture.
const UNIVERSAL_NEGATIVE_PROMPT =
  'blurry, low quality, watermark, jpeg artifacts, extra limbs, deformed, seams, halo';

function composeInpaintPrompt(
  mode: InpaintMode,
  userPrompt: string
): { prompt: string; negativePrompt: string } {
  const trimmed = userPrompt.trim();
  switch (mode) {
    case 'remove':
      // Flux inpaint can't truly "erase" — describing the clean plate forces a
      // seamless fill that matches surrounding context.
      return {
        prompt: trimmed
          ? `clean background, seamless fill matching surroundings, ${trimmed}, photorealistic, no object, empty space`
          : 'clean background, seamless fill matching surroundings, photorealistic, no object, empty space',
        negativePrompt: `${UNIVERSAL_NEGATIVE_PROMPT}, any object, figure, text, logo, character`,
      };
    case 'add':
      return {
        prompt: trimmed
          ? `${trimmed}, seamlessly integrated, matching lighting and perspective, photorealistic detail`
          : 'new object, seamlessly integrated, matching lighting and perspective',
        negativePrompt: UNIVERSAL_NEGATIVE_PROMPT,
      };
    case 'fix':
      return {
        prompt: trimmed
          ? `${trimmed}, highly detailed, anatomically correct, sharp focus, high quality`
          : 'highly detailed, anatomically correct, sharp focus, high quality, natural proportions',
        negativePrompt: `${UNIVERSAL_NEGATIVE_PROMPT}, malformed, mutated, bad anatomy, bad hands, extra fingers, fused fingers, disfigured`,
      };
    case 'replace':
    default:
      return {
        prompt: trimmed,
        negativePrompt: UNIVERSAL_NEGATIVE_PROMPT,
      };
  }
}

// ── Router ──────────────────────────────────────────────────────────────

export const editingRouter = router({
  /** List available editing models, optionally filtered by operation */
  listModels: protectedProcedure
    .input(z.object({ operation: operationSchema.optional() }).optional())
    .query(({ input }) => {
      if (input?.operation) {
        return getEditingModelsForOperation(input.operation).map((m) => ({
          id: m.id,
          operation: m.operation,
          displayName: m.displayName,
          shortDescription: m.shortDescription,
          tier: m.tier,
          fiatPriceUsd: m.fiatPriceUsd,
          loarPriceUsd: m.loarPriceUsd,
          creditCost: m.creditCost,
          supportsVideo: m.supportsVideo,
          supportsImage: m.supportsImage,
          tags: m.tags,
          bestFor: m.bestFor,
        }));
      }
      return getEnabledEditingModels().map((m) => ({
        id: m.id,
        operation: m.operation,
        displayName: m.displayName,
        shortDescription: m.shortDescription,
        tier: m.tier,
        fiatPriceUsd: m.fiatPriceUsd,
        loarPriceUsd: m.loarPriceUsd,
        creditCost: m.creditCost,
        supportsVideo: m.supportsVideo,
        supportsImage: m.supportsImage,
        tags: m.tags,
        bestFor: m.bestFor,
      }));
    }),

  /** Estimate cost for an editing operation */
  estimateCost: protectedProcedure
    .input(
      z.object({
        operation: operationSchema,
        modelId: z.string().optional(),
      })
    )
    .query(({ input }) => {
      const model = input.modelId
        ? getEditingModelById(input.modelId)
        : getDefaultModelForOperation(input.operation);

      if (!model) throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found' });

      return {
        modelId: model.id,
        displayName: model.displayName,
        creditCost: model.creditCost,
        fiatPriceUsd: model.fiatPriceUsd,
        loarPriceUsd: model.loarPriceUsd,
      };
    }),

  // ── Upscale ─────────────────────────────────────────────────────────

  upscale: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        modelId: z.string().default('upscale-esrgan'),
        prompt: z.string().max(PROMPT_MAX).optional(),
        scale: z.number().min(2).max(4).default(4),
        sourceGenerationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertSafeExternalUrl(input.imageUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'imageUrl rejected',
        });
      }
      await assertEditSourceAuthorized({
        uid: ctx.user.uid,
        mediaUrl: input.imageUrl,
        sourceGenerationId: input.sourceGenerationId,
      });
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'upscale') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid upscale model' });
      }

      const jobId = randomUUID();
      const startTime = Date.now();

      try {
        return await withReservation(
          {
            userId: ctx.user.uid,
            modelId: model.id,
            provider: 'fal',
            estimatedCredits: model.creditCost,
            byok: false,
            meta: { generationId: jobId, operation: 'upscale' },
          },
          async () => {
            const { resolveProviderKey } = await import('../../lib/byok');
            const apiKey = await resolveProviderKey(ctx.user.uid, 'fal');
            const result = await falService.upscaleImage({
              imageUrl: input.imageUrl,
              model: model.falModelId,
              prompt: input.prompt,
              scale: input.scale,
              apiKey,
            });

            if (result.status === 'failed' || !result.imageUrl) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: safeErrorMessage(result.error, 'Upscale failed'),
              });
            }

            const record: EditingJobRecord = {
              id: jobId,
              userId: ctx.user.uid,
              operation: 'upscale',
              modelId: model.id,
              status: 'completed',
              inputUrl: input.imageUrl,
              outputUrl: result.imageUrl,
              providerCostUsd: model.providerCostUsd,
              creditsCharged: model.creditCost,
              latencyMs: Date.now() - startTime,
              createdAt: new Date(),
              completedAt: new Date(),
              sourceGenerationId: input.sourceGenerationId,
            };
            saveJobRecord(record).catch(console.error);

            return {
              result: { jobId, imageUrl: result.imageUrl, model: model.displayName },
            };
          }
        );
      } catch (err) {
        // withReservation already cancelled the reservation (full refund).
        const record: EditingJobRecord = {
          id: jobId,
          userId: ctx.user.uid,
          operation: 'upscale',
          modelId: model.id,
          status: 'failed',
          inputUrl: input.imageUrl,
          providerCostUsd: 0,
          creditsCharged: 0,
          failureReason: err instanceof Error ? err.message : 'Upscale failed',
          createdAt: new Date(),
          completedAt: new Date(),
          sourceGenerationId: input.sourceGenerationId,
        };
        saveJobRecord(record).catch(console.error);
        throw err;
      }
    }),

  // ── Frame Interpolation ─────────────────────────────────────────────

  interpolate: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        multiplier: z.number().min(2).max(8).default(2),
        modelId: z.string().default('interpolate-film'),
        sourceGenerationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertSafeExternalUrl(input.videoUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'videoUrl rejected',
        });
      }
      await assertEditSourceAuthorized({
        uid: ctx.user.uid,
        mediaUrl: input.videoUrl,
        sourceGenerationId: input.sourceGenerationId,
      });
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'interpolate') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid interpolation model' });
      }

      const jobId = randomUUID();
      const startTime = Date.now();

      try {
        return await withReservation(
          {
            userId: ctx.user.uid,
            modelId: model.id,
            provider: 'fal',
            estimatedCredits: model.creditCost,
            byok: false,
            meta: { generationId: jobId, operation: 'interpolate' },
          },
          async () => {
            const { resolveProviderKey: resolveInterp } = await import('../../lib/byok');
            const interpKey = await resolveInterp(ctx.user.uid, 'fal');
            const result = await falService.interpolateFrames({
              videoUrl: input.videoUrl,
              model: model.falModelId,
              multiplier: input.multiplier,
              apiKey: interpKey,
            });

            if (result.status === 'failed' || !result.videoUrl) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: safeErrorMessage(result.error, 'Interpolation failed'),
              });
            }

            const record: EditingJobRecord = {
              id: jobId,
              userId: ctx.user.uid,
              operation: 'interpolate',
              modelId: model.id,
              status: 'completed',
              inputUrl: input.videoUrl,
              outputUrl: result.videoUrl,
              providerCostUsd: model.providerCostUsd,
              creditsCharged: model.creditCost,
              latencyMs: Date.now() - startTime,
              createdAt: new Date(),
              completedAt: new Date(),
              sourceGenerationId: input.sourceGenerationId,
            };
            saveJobRecord(record).catch(console.error);

            return {
              result: { jobId, videoUrl: result.videoUrl, model: model.displayName },
            };
          }
        );
      } catch (err) {
        const record: EditingJobRecord = {
          id: jobId,
          userId: ctx.user.uid,
          operation: 'interpolate',
          modelId: model.id,
          status: 'failed',
          inputUrl: input.videoUrl,
          providerCostUsd: 0,
          creditsCharged: 0,
          failureReason: err instanceof Error ? err.message : 'Interpolation failed',
          createdAt: new Date(),
          completedAt: new Date(),
          sourceGenerationId: input.sourceGenerationId,
        };
        saveJobRecord(record).catch(console.error);
        throw err;
      }
    }),

  // ── Video-to-Video Restyle ──────────────────────────────────────────

  restyle: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        prompt: z.string().min(1, 'Describe the new style').max(PROMPT_MAX),
        modelId: z.string().default('restyle-wan-v2v'),
        strength: z.number().min(0.1).max(1).default(0.65),
        negativePrompt: z.string().max(NEG_PROMPT_MAX).optional(),
        sourceGenerationId: z.string().optional(),
        clientToken: clientTokenSchema,
        webhookUrl: webhookUrlSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertSafeExternalUrl(input.videoUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'videoUrl rejected',
        });
      }
      await assertEditSourceAuthorized({
        uid: ctx.user.uid,
        mediaUrl: input.videoUrl,
        sourceGenerationId: input.sourceGenerationId,
      });
      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'restyle') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid restyle model' });
      }

      const jobId = randomUUID();

      // Idempotency — before any credit deduction.
      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId,
          procedure: 'editing.restyle',
        });
        if (reservation?.existing) {
          const existing = await editingJobsCol().doc(reservation.existing.jobId).get();
          const d = existing.exists ? (existing.data() as any) : {};
          return {
            jobId: reservation.existing.jobId,
            videoUrl: (d.outputUrl ?? undefined) as string | undefined,
            model: model.displayName,
            idempotentReplay: true as const,
          };
        }
      }

      // Validate webhookUrl early.
      let validatedWebhookUrl: string | undefined;
      if (input.webhookUrl) {
        const check = validateWebhookUrl(input.webhookUrl);
        if (!check.ok) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: check.reason });
        }
        validatedWebhookUrl = check.url;
      }

      checkEditThrottle(ctx.user.uid);
      const startTime = Date.now();

      try {
        return await withReservation(
          {
            userId: ctx.user.uid,
            modelId: model.id,
            provider: 'fal',
            estimatedCredits: model.creditCost,
            byok: false,
            meta: { generationId: jobId, operation: 'restyle' },
          },
          async () => {
            const { resolveProviderKey: resolveRestyle } = await import('../../lib/byok');
            const restyleKey = await resolveRestyle(ctx.user.uid, 'fal');
            const result = await falService.restyleVideo({
              videoUrl: input.videoUrl,
              prompt: input.prompt,
              model: model.falModelId,
              strength: input.strength,
              negativePrompt: input.negativePrompt,
              apiKey: restyleKey,
            });

            if (result.status === 'failed' || !result.videoUrl) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: safeErrorMessage(result.error, 'Restyle failed'),
              });
            }

            const record: EditingJobRecord & { webhookUrl?: string; clientToken?: string } = {
              id: jobId,
              userId: ctx.user.uid,
              operation: 'restyle',
              modelId: model.id,
              status: 'completed',
              inputUrl: input.videoUrl,
              outputUrl: result.videoUrl,
              prompt: input.prompt,
              providerCostUsd: model.providerCostUsd,
              creditsCharged: model.creditCost,
              latencyMs: Date.now() - startTime,
              createdAt: new Date(),
              completedAt: new Date(),
              sourceGenerationId: input.sourceGenerationId,
              ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
              ...(input.clientToken ? { clientToken: input.clientToken } : {}),
            };
            saveJobRecord(record).catch(console.error);

            // Auto-publish derivative clip to gallery with source-video lineage
            try {
              const { extractVideoThumbnail } = await import('../../services/video-thumbnail');
              const thumbnailUrl = await extractVideoThumbnail(result.videoUrl, jobId);
              await publishToGallery({
                creatorUid: ctx.user.uid,
                mediaUrl: result.videoUrl,
                thumbnailUrl,
                mediaType: 'ai-video',
                title: input.prompt.slice(0, 80) || 'Restyled Clip',
                description: input.prompt,
                generationId: jobId,
                generationModel: model.id,
                parentGenerationId: input.sourceGenerationId || null,
                sourceVideoGenerationId: input.sourceGenerationId || null,
              });
            } catch (err) {
              console.error('[restyle] gallery publish failed:', err);
            }

            fireJobWebhook({
              ownerUid: ctx.user.uid,
              webhookUrl: validatedWebhookUrl,
              clientToken: input.clientToken,
              event: 'job.completed',
              jobId,
              kind: 'video',
              payload: {
                operation: 'restyle',
                status: 'completed',
                resultUrl: result.videoUrl,
                modelUsed: model.id,
                creditsCharged: model.creditCost,
              },
            });

            return {
              result: {
                jobId,
                videoUrl: result.videoUrl as string | undefined,
                model: model.displayName,
                idempotentReplay: false as const,
              },
            };
          }
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Restyle failed';
        const record: EditingJobRecord & { webhookUrl?: string; clientToken?: string } = {
          id: jobId,
          userId: ctx.user.uid,
          operation: 'restyle',
          modelId: model.id,
          status: 'failed',
          inputUrl: input.videoUrl,
          prompt: input.prompt,
          providerCostUsd: 0,
          creditsCharged: 0,
          failureReason: errMsg,
          createdAt: new Date(),
          completedAt: new Date(),
          sourceGenerationId: input.sourceGenerationId,
          ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
          ...(input.clientToken ? { clientToken: input.clientToken } : {}),
        };
        saveJobRecord(record).catch(console.error);
        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.failed',
          jobId,
          kind: 'video',
          payload: {
            operation: 'restyle',
            status: 'failed',
            errorMessage: errMsg,
            creditsRefunded: true,
          },
        });
        throw err;
      }
    }),

  // ── Inpainting ──────────────────────────────────────────────────────

  inpaint: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        maskUrl: z.string().url(),
        prompt: z.string().max(PROMPT_MAX).default(''),
        mode: inpaintModeSchema.default('replace'),
        modelId: z.string().default('inpaint-flux'),
        negativePrompt: z.string().max(NEG_PROMPT_MAX).optional(),
        seed: z.number().int().optional(),
        strength: z.number().min(0).max(1).optional(),
        guidanceScale: z.number().min(1).max(20).optional(),
        sourceGenerationId: z.string().optional(),
        universeId: z.string().optional(),
        /** If true, result is auto-published to the user's gallery */
        publishToGallery: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertSafeExternalUrl(input.imageUrl);
        assertSafeExternalUrl(input.maskUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'URL rejected',
        });
      }
      await assertEditSourceAuthorized({
        uid: ctx.user.uid,
        mediaUrl: input.imageUrl,
        sourceGenerationId: input.sourceGenerationId,
      });
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'inpaint') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid inpaint model' });
      }

      // Eraser models (lama-style) don't take prompts — they just fill the mask
      // with plausible surrounding texture. Detected via the 'erase' tag.
      const isEraser = model.tags.includes('erase');

      // Replace/Add require a prompt unless using a prompt-free eraser model
      if (!isEraser && input.mode === 'replace' && !input.prompt.trim()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Replace mode requires a prompt describing what to fill in.',
        });
      }
      if (!isEraser && input.mode === 'add' && !input.prompt.trim()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Add mode requires a prompt describing what to add.',
        });
      }

      const { prompt: composedPrompt, negativePrompt: composedNegative } = composeInpaintPrompt(
        input.mode,
        input.prompt
      );
      const finalNegative = input.negativePrompt
        ? `${composedNegative}, ${input.negativePrompt}`
        : composedNegative;

      const jobId = randomUUID();
      const startTime = Date.now();

      try {
        return await withReservation(
          {
            userId: ctx.user.uid,
            modelId: model.id,
            provider: 'fal',
            estimatedCredits: model.creditCost,
            byok: false,
            meta: { generationId: jobId, operation: 'inpaint' },
          },
          async () => {
            const { resolveProviderKey: resolveInpaintKey } = await import('../../lib/byok');
            const inpaintKey = await resolveInpaintKey(ctx.user.uid, 'fal');
            const result = isEraser
              ? await falService.eraseRegion({
                  imageUrl: input.imageUrl,
                  maskUrl: input.maskUrl,
                  model: model.falModelId,
                  apiKey: inpaintKey,
                })
              : await falService.inpaintImage({
                  imageUrl: input.imageUrl,
                  maskUrl: input.maskUrl,
                  prompt: composedPrompt,
                  model: model.falModelId,
                  negativePrompt: finalNegative,
                  seed: input.seed,
                  strength: input.strength,
                  guidanceScale: input.guidanceScale,
                  apiKey: inpaintKey,
                });

            if (result.status === 'failed' || !result.imageUrl) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: safeErrorMessage(result.error, 'Inpaint failed'),
              });
            }

            const record: EditingJobRecord = {
              id: jobId,
              userId: ctx.user.uid,
              operation: 'inpaint',
              modelId: model.id,
              status: 'completed',
              inputUrl: input.imageUrl,
              outputUrl: result.imageUrl,
              maskUrl: input.maskUrl,
              prompt: input.prompt,
              negativePrompt: input.negativePrompt,
              mode: input.mode,
              seed: result.seed,
              providerCostUsd: model.providerCostUsd,
              creditsCharged: model.creditCost,
              latencyMs: Date.now() - startTime,
              createdAt: new Date(),
              completedAt: new Date(),
              sourceGenerationId: input.sourceGenerationId,
            };

            // Gallery auto-publish — per product rule, every generated image must
            // appear in the user's gallery without a manual promote step.
            if (input.publishToGallery) {
              try {
                const modeLabels: Record<InpaintMode, string> = {
                  replace: 'Replaced region',
                  remove: 'Removed object',
                  add: 'Added content',
                  fix: 'Fixed details',
                };
                const title = input.prompt.trim()
                  ? `${modeLabels[input.mode]}: ${input.prompt.trim().slice(0, 60)}`
                  : modeLabels[input.mode];

                await publishToGallery({
                  creatorUid: ctx.user.uid,
                  mediaUrl: result.imageUrl,
                  mediaType: 'ai-image',
                  title,
                  description: `Inpaint (${input.mode}) via ${model.displayName}${
                    input.prompt.trim() ? ` — "${input.prompt.trim()}"` : ''
                  }`,
                  generationId: jobId,
                  generationModel: model.displayName,
                  universeId: input.universeId ?? null,
                  tags: ['inpaint', input.mode, 'edit'],
                });
                record.galleryContentId = jobId;
              } catch (err) {
                // Gallery publish is best-effort — don't fail the whole request.
                console.warn('[inpaint] publishToGallery failed:', err);
              }
            }

            saveJobRecord(record).catch(console.error);

            return {
              result: {
                jobId,
                imageUrl: result.imageUrl,
                model: model.displayName,
                seed: result.seed,
                mode: input.mode,
              },
            };
          }
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Inpaint failed';
        const record: EditingJobRecord = {
          id: jobId,
          userId: ctx.user.uid,
          operation: 'inpaint',
          modelId: model.id,
          status: 'failed',
          inputUrl: input.imageUrl,
          maskUrl: input.maskUrl,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          mode: input.mode,
          seed: input.seed,
          providerCostUsd: 0,
          creditsCharged: 0,
          failureReason: errMsg,
          createdAt: new Date(),
          completedAt: new Date(),
          sourceGenerationId: input.sourceGenerationId,
        };
        saveJobRecord(record).catch(console.error);
        throw err;
      }
    }),

  // ── Background Removal ──────────────────────────────────────────────

  removeBackground: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        modelId: z.string().default('remove-bg-birefnet'),
        sourceGenerationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertSafeExternalUrl(input.imageUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'imageUrl rejected',
        });
      }
      await assertEditSourceAuthorized({
        uid: ctx.user.uid,
        mediaUrl: input.imageUrl,
        sourceGenerationId: input.sourceGenerationId,
      });
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'remove_bg') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid background removal model' });
      }

      const jobId = randomUUID();
      const startTime = Date.now();

      return withReservation(
        {
          userId: ctx.user.uid,
          modelId: model.id,
          provider: 'fal',
          estimatedCredits: model.creditCost,
          byok: false,
          meta: { generationId: jobId, operation: 'remove_bg' },
        },
        async () => {
          const { resolveProviderKey: resolveBgKey } = await import('../../lib/byok');
          const bgKey = await resolveBgKey(ctx.user.uid, 'fal');
          const result = await falService.removeBackground({
            imageUrl: input.imageUrl,
            model: model.falModelId,
            apiKey: bgKey,
          });

          if (result.status === 'failed' || !result.imageUrl) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: safeErrorMessage(result.error, 'Background removal failed'),
            });
          }

          const record: EditingJobRecord = {
            id: jobId,
            userId: ctx.user.uid,
            operation: 'remove_bg',
            modelId: model.id,
            status: 'completed',
            inputUrl: input.imageUrl,
            outputUrl: result.imageUrl,
            providerCostUsd: model.providerCostUsd,
            creditsCharged: model.creditCost,
            latencyMs: Date.now() - startTime,
            createdAt: new Date(),
            completedAt: new Date(),
            sourceGenerationId: input.sourceGenerationId,
          };
          saveJobRecord(record).catch(console.error);

          return { result: { jobId, imageUrl: result.imageUrl, model: model.displayName } };
        }
      );
    }),

  // ── Video Extension ─────────────────────────────────────────────────

  extend: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        prompt: z.string().min(1, 'Describe what happens next').max(PROMPT_MAX),
        durationSec: z.number().min(2).max(10).default(5),
        modelId: z.string().default('extend-wan'),
        sourceGenerationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertSafeExternalUrl(input.videoUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'videoUrl rejected',
        });
      }
      await assertEditSourceAuthorized({
        uid: ctx.user.uid,
        mediaUrl: input.videoUrl,
        sourceGenerationId: input.sourceGenerationId,
      });
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'extend') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid extend model' });
      }

      const jobId = randomUUID();
      const startTime = Date.now();

      return withReservation(
        {
          userId: ctx.user.uid,
          modelId: model.id,
          provider: 'fal',
          estimatedCredits: model.creditCost,
          byok: false,
          meta: { generationId: jobId, operation: 'extend' },
        },
        async () => {
          // Extract last frame from the video using ffmpeg, then use image-to-video
          let lastFrameUrl = input.videoUrl;
          try {
            // Only accept HTTPS — ffmpeg's default protocol set can read local
            // files via `file:`, `concat:`, `subfile:`, etc.
            let parsedVideoUrl: URL;
            try {
              parsedVideoUrl = new URL(input.videoUrl);
            } catch {
              throw new Error('videoUrl is not a valid URL');
            }
            if (parsedVideoUrl.protocol !== 'https:') {
              throw new Error('videoUrl must be an https: URL');
            }

            const { execFile } = await import('child_process');
            const { promisify } = await import('util');
            const { tmpdir } = await import('os');
            const { join } = await import('path');
            const { readFile, unlink } = await import('fs/promises');
            const execFileAsync = promisify(execFile);

            const outPath = join(tmpdir(), `lastframe-${jobId}.jpg`);

            // Extract the last frame using ffmpeg (seek to near-end)
            await execFileAsync(
              'ffmpeg',
              [
                '-y',
                '-protocol_whitelist',
                'https,tls,tcp',
                '-sseof',
                '-0.5',
                '-i',
                input.videoUrl,
                '-frames:v',
                '1',
                '-q:v',
                '2',
                outPath,
              ],
              { timeout: 15000 }
            );

            // Upload to FAL as data URL for the image-to-video call
            const frameBuffer = await readFile(outPath);
            lastFrameUrl = `data:image/jpeg;base64,${frameBuffer.toString('base64')}`;
            unlink(outPath).catch(() => {});
          } catch (err) {
            console.warn('[extend] Could not extract last frame, using video URL directly:', err);
          }

          // Use image-to-video generation with the last frame
          const { resolveProviderKey: resolveExtendKey } = await import('../../lib/byok');
          const extendKey = await resolveExtendKey(ctx.user.uid, 'fal');
          const result = await falService.generateVideo({
            prompt: input.prompt,
            model: model.falModelId as any,
            imageUrl: lastFrameUrl,
            duration: input.durationSec,
            apiKey: extendKey,
          });

          if (result.status === 'failed' || !result.videoUrl) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: safeErrorMessage(result.error, 'Video extension failed'),
            });
          }

          const record: EditingJobRecord = {
            id: jobId,
            userId: ctx.user.uid,
            operation: 'extend',
            modelId: model.id,
            status: 'completed',
            inputUrl: input.videoUrl,
            outputUrl: result.videoUrl,
            prompt: input.prompt,
            providerCostUsd: model.providerCostUsd,
            creditsCharged: model.creditCost,
            latencyMs: Date.now() - startTime,
            createdAt: new Date(),
            completedAt: new Date(),
            sourceGenerationId: input.sourceGenerationId,
          };
          saveJobRecord(record).catch(console.error);

          return { result: { jobId, videoUrl: result.videoUrl, model: model.displayName } };
        }
      );
    }),

  // ── Relight (lighting / time-of-day / backdrop / color mood) ────────

  /** List the canonical relight presets grouped by kind. */
  relightPresets: protectedProcedure.query(async () => {
    const { LIGHTING_PRESETS, TIME_OF_DAY_PRESETS, BACKDROP_PRESETS, MOOD_PRESETS } =
      await import('../../services/relight/presets');
    const strip = (p: { id: string; kind: string; label: string; description: string }) => ({
      id: p.id,
      kind: p.kind,
      label: p.label,
      description: p.description,
    });
    return {
      lighting: LIGHTING_PRESETS.map(strip),
      time: TIME_OF_DAY_PRESETS.map(strip),
      backdrop: BACKDROP_PRESETS.map(strip),
      mood: MOOD_PRESETS.map(strip),
    };
  }),

  relight: protectedProcedure
    .input(
      z
        .object({
          imageUrl: z.string().url(),
          presetIds: z.array(z.string()).max(8).default([]),
          freeText: z.string().max(500).optional(),
          tonePackId: z.string().optional(),
          universeAddress: z.string().optional(),
          modelId: z.string().default('relight-nano-banana'),
          numImages: z.number().int().min(1).max(4).default(1),
          publishToGallery: z.boolean().default(true),
          sourceGenerationId: z.string().optional(),
          sourceAttachmentId: z.string().optional(),
        })
        .refine((v) => v.presetIds.length > 0 || (v.freeText && v.freeText.trim().length > 0), {
          message: 'Pick at least one preset or describe the relight in free text',
          path: ['presetIds'],
        })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        assertSafeExternalUrl(input.imageUrl);
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: err instanceof Error ? err.message : 'imageUrl rejected',
        });
      }
      await assertEditSourceAuthorized({
        uid: ctx.user.uid,
        mediaUrl: input.imageUrl,
        sourceGenerationId: input.sourceGenerationId,
      });
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'relight') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid relight model' });
      }

      // Resolve tone pack (if requested) — soft-fail if unreadable; the relight
      // still works without a house look applied.
      let tonePack: {
        presetIds?: string[];
        customPromptFragment?: string;
        customNegativeFragment?: string;
      } | null = null;
      if (input.tonePackId) {
        try {
          if (!db) throw new Error('Firebase not configured');
          const packDoc = await db.collection('universeTonePacks').doc(input.tonePackId).get();
          if (packDoc.exists) {
            const data = packDoc.data()!;
            tonePack = {
              presetIds: Array.isArray(data.presetIds) ? data.presetIds : [],
              customPromptFragment: data.customPromptFragment,
              customNegativeFragment: data.customNegativeFragment,
            };
          }
        } catch (err) {
          console.warn('[relight] Failed to load tone pack', input.tonePackId, err);
        }
      }

      const { composeRelightPrompt } = await import('../../services/relight/presets');
      const composed = composeRelightPrompt({
        presetIds: input.presetIds,
        freeText: input.freeText,
        tonePack,
      });

      if (!composed.prompt.trim()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Could not compose a relight prompt — pick at least one valid preset.',
        });
      }

      const totalCost = model.creditCost * input.numImages;
      const jobId = randomUUID();
      const startTime = Date.now();

      try {
        return await withReservation(
          {
            userId: ctx.user.uid,
            modelId: model.id,
            provider: 'fal',
            estimatedCredits: totalCost,
            byok: false,
            meta: { generationId: jobId, operation: 'relight' },
          },
          async () => {
            const { resolveProviderKey: resolveRelightKey } = await import('../../lib/byok');
            const relightKey = await resolveRelightKey(ctx.user.uid, 'fal');
            const result = await falService.editImage({
              prompt: composed.prompt,
              imageUrls: [input.imageUrl],
              numImages: input.numImages,
              negativePrompt: composed.negativePrompt || undefined,
              apiKey: relightKey,
            });

            if (result.status === 'failed' || !result.imageUrl) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: safeErrorMessage(result.error, 'Relight failed'),
              });
            }

            const outputs = (result.images ?? [{ url: result.imageUrl }]).map((img) => img.url);

            const record: EditingJobRecord = {
              id: jobId,
              userId: ctx.user.uid,
              operation: 'relight',
              modelId: model.id,
              status: 'completed',
              inputUrl: input.imageUrl,
              outputUrl: outputs[0],
              prompt: composed.prompt,
              negativePrompt: composed.negativePrompt,
              providerCostUsd: model.providerCostUsd * input.numImages,
              creditsCharged: totalCost,
              latencyMs: Date.now() - startTime,
              seed: result.seed,
              createdAt: new Date(),
              completedAt: new Date(),
              sourceGenerationId: input.sourceGenerationId,
              sourceAttachmentId: input.sourceAttachmentId,
              presetIds: composed.appliedPresetIds,
              tonePackId: input.tonePackId,
              universeAddress: input.universeAddress,
            };
            saveJobRecord(record).catch(console.error);

            // Auto-publish each output to the public gallery so it joins the
            // creator's portfolio without a manual step. Best-effort — failure
            // here does NOT fail the relight call.
            if (input.publishToGallery) {
              const presetTags = composed.appliedPresetIds.map((p) => `relight:${p}`);
              for (const outUrl of outputs) {
                publishToGallery({
                  creatorUid: ctx.user.uid,
                  mediaUrl: outUrl,
                  mediaType: 'ai-image',
                  title: `Relight — ${composed.appliedPresetIds.slice(0, 2).join(', ') || 'custom'}`,
                  description: composed.prompt.slice(0, 240),
                  universeId: input.universeAddress ?? null,
                  generationId: jobId,
                  generationModel: model.displayName,
                  tags: ['relight', ...presetTags],
                }).catch((err) =>
                  console.error(`[relight] gallery publish failed for ${jobId}:`, err)
                );
              }
            }

            // If the source was a tracked media attachment, chain new variants so
            // the entity / universe sees them grouped under the original.
            if (input.sourceAttachmentId && db) {
              try {
                const { createAttachment, getNextVersion } =
                  await import('../../routers/media/media.handlers');
                const sourceDoc = await db
                  .collection('mediaAttachments')
                  .doc(input.sourceAttachmentId)
                  .get();
                if (sourceDoc.exists && ctx.user.address) {
                  const src = sourceDoc.data()!;
                  const variantLabel =
                    composed.appliedPresetIds.slice(0, 2).join(' + ') ||
                    (input.freeText ? input.freeText.slice(0, 40) : 'Relight');
                  for (const outUrl of outputs) {
                    const version = await getNextVersion(
                      src.targetType,
                      src.targetId,
                      src.category ?? 'image',
                      input.sourceAttachmentId
                    );
                    await createAttachment(ctx.user.address, {
                      contentHash: '', // unknown — gallery rehost computes its own
                      originalFilename: `${jobId}.png`,
                      mimeType: 'image/png',
                      size: 0,
                      url: outUrl,
                      targetType: src.targetType,
                      targetId: src.targetId,
                      targetName: src.targetName ?? '',
                      category: src.category ?? 'image',
                      label: `${src.label ?? 'Image'} — ${variantLabel}`,
                      subCategory: src.subCategory ?? null,
                      version,
                      variantOf: input.sourceAttachmentId,
                      variantLabel,
                      sortOrder: src.sortOrder ?? 0,
                      generationId: jobId,
                    });
                  }
                }
              } catch (err) {
                console.error(`[relight] variant chain failed for ${jobId}:`, err);
              }
            }

            return {
              result: {
                jobId,
                imageUrl: outputs[0],
                images: outputs,
                appliedPresetIds: composed.appliedPresetIds,
                prompt: composed.prompt,
                creditsCharged: totalCost,
                model: model.displayName,
              },
            };
          }
        );
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Relight failed';
        const failedRecord: EditingJobRecord = {
          id: jobId,
          userId: ctx.user.uid,
          operation: 'relight',
          modelId: model.id,
          status: 'failed',
          inputUrl: input.imageUrl,
          prompt: composed.prompt,
          negativePrompt: composed.negativePrompt,
          providerCostUsd: 0,
          creditsCharged: 0,
          failureReason: errMsg,
          createdAt: new Date(),
          completedAt: new Date(),
          sourceGenerationId: input.sourceGenerationId,
          sourceAttachmentId: input.sourceAttachmentId,
          presetIds: composed.appliedPresetIds,
          tonePackId: input.tonePackId,
          universeAddress: input.universeAddress,
        };
        saveJobRecord(failedRecord).catch(console.error);
        throw err;
      }
    }),

  // ── History ─────────────────────────────────────────────────────────

  history: protectedProcedure
    .input(
      z.object({
        operation: operationSchema.optional(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      let query = editingJobsCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit + 1);

      if (input.operation) {
        query = editingJobsCol()
          .where('userId', '==', ctx.user.uid)
          .where('operation', '==', input.operation)
          .orderBy('createdAt', 'desc')
          .limit(input.limit + 1);
      }

      if (input.cursor) {
        const cursorDoc = await editingJobsCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const jobs = snapshot.docs.slice(0, input.limit).map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          operation: data.operation,
          modelId: data.modelId,
          status: data.status,
          inputUrl: data.inputUrl,
          outputUrl: data.outputUrl,
          prompt: data.prompt,
          creditsCharged: data.creditsCharged,
          latencyMs: data.latencyMs,
          createdAt: data.createdAt?.toDate?.() || data.createdAt,
        };
      });

      return {
        jobs,
        nextCursor:
          snapshot.docs.length > input.limit ? snapshot.docs[input.limit - 1]?.id : undefined,
      };
    }),
});
