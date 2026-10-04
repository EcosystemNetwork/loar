/**
 * 3D Generation Router
 *
 * Studio OS 3D layer powered by Meshy.
 * Supports text-to-3D (preview → refine pipeline) and image-to-3D.
 * Task state is polled asynchronously via Firestore + a polling endpoint.
 *
 * Capabilities:
 *   threed.textTo3DPreview   — Start a preview task (fast, low-poly)
 *   threed.textTo3DRefine    — Refine a preview into a final model
 *   threed.imageTo3D         — Single or multi-image to 3D
 *   threed.getTask           — Poll task status
 *   threed.history           — User's 3D generation history
 *   threed.estimateCost      — Pre-flight cost estimate
 *
 * Pricing:
 *   text-to-3D preview  ~$0.05
 *   text-to-3D refine   ~$0.20
 *   image-to-3D         ~$0.15
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
import {
  MESHY_REMESH_MAX_POLYCOUNT,
  MESHY_REMESH_MIN_POLYCOUNT,
  meshyService,
} from '../../services/meshy';
import {
  tripo3dService,
  type TripoAnimation,
  type TripoConvertFormat,
  type TripoRigType,
} from '../../services/tripo3d';
import { trackQuests } from '../../services/quest-tracker';
import { FieldValue } from 'firebase-admin/firestore';
import { createAttachment } from '../media/media.handlers';
import { logFailedRefund } from '../../lib/refund-audit';
import { publishToGallery } from '../../lib/gallery-publish';
import { rehostModelBundle } from '../../lib/rehost-ephemeral';
import { withReservation } from '../../services/credits';
import { getThreedModelById } from '../../services/threed-models';
import type { MeshyTaskOutput } from '../../services/meshy';

// ── Pricing — loaded from platform config (admin-configurable) ────────

import { getPlatformConfig } from '../../services/platformConfig';
import { sanitizePrompt } from '../../lib/prompt-sanitize';
import { reserveClientToken } from '../../lib/jobIdempotency';
import { fireJobWebhook, validateWebhookUrl, webhookUrlSchema } from '../../lib/webhooks';
import { assertSafeExternalUrl } from '../../lib/safe-fetch-url';
import { TRPCError } from '@trpc/server';
import { releaseHoldOnError, reserveThreedBudget, settleThreedJob } from '../../lib/threed-budget';
import {
  detectTripoRigType,
  pickThreedProvider,
  requireTripoApiKey,
  threedProviderSchema,
  tripoTaskModelUrl,
} from '../../lib/threed-provider';

const clientTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'clientToken must match [A-Za-z0-9_-]{16,128}')
  .optional();

const LOAR_TO_USD = 0.01;

/** Remesh output formats we re-host to permanent storage (see threed.remesh). */
const REMESH_OUTPUT_FORMATS = ['glb', 'fbx', 'obj', 'usdz'] as const;

const COSTS = {
  text_preview: 0.05,
  text_refine: 0.2,
  image_to_3d: 0.15,
};

/**
 * Tripo3D generation cost (USD, $0.01/Tripo credit). One Tripo task gives a
 * finished textured mesh — there is no separate refine step — so it costs
 * more than a Meshy preview but less than preview + refine.
 */
const TRIPO_GEN_COSTS = { hifi: 0.4, game: 0.25 } as const;
const tripoQualitySchema = z.enum(['hifi', 'game']).default('hifi');

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

const threeDGenCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('threeDGenerations');
};
// Bound reads + sort in Firestore via the userId+createdAt index; secondary filters applied in memory to avoid extra composite indexes.
const HISTORY_READ_CAP = 500;

// ── Credit helpers ────────────────────────────────────────────────────
//
// Procedures reserve via `withReservation` for the synchronous Meshy task
// submission. The background `completeThreeDTask` polls Meshy hours later
// and needs a post-reconcile refund path — `refundCreditsAfterReconcile`
// below uses a raw `FieldValue.increment` since the reservation has already
// been settled by the time the polling worker discovers a failure.

const userCreditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};

async function refundCreditsAfterReconcile(
  userId: string,
  credits: number,
  genId?: string
): Promise<void> {
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
    console.error(`CRITICAL: 3D credit refund failed for ${userId}:`, err);
    logFailedRefund({
      userId,
      credits,
      source: 'threed',
      generationId: genId ?? 'unknown',
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
  recordAiGeneration('meshy', 'threed', 'failure');
}

// ── Auto-attach helper ───────────────────────────────────────────────

async function autoAttach3DModel(opts: {
  creator: string;
  entityId: string | null;
  generationId: string;
  modelUrls: MeshyTaskOutput;
  thumbnailUrl?: string;
  type: string;
}) {
  if (!opts.entityId) return; // No entity to attach to

  // Look up entity name for the attachment record
  let targetName = '';
  try {
    const entityDoc = await db.collection('entities').doc(opts.entityId).get();
    if (!entityDoc.exists) return;
    // Verify the caller owns this entity before attaching
    if (entityDoc.data()?.creator !== opts.creator) return;
    targetName = entityDoc.data()?.name ?? '';
  } catch {
    // Best-effort — continue even if entity lookup fails
  }

  // Attach each model format (glb, fbx, usdz, obj) as a separate attachment
  const modelEntries: [string, string][] = [
    ['glb', opts.modelUrls.glb],
    ['fbx', opts.modelUrls.fbx],
    ['obj', opts.modelUrls.obj],
    ['mtl', opts.modelUrls.mtl],
    ['usdz', opts.modelUrls.usdz],
  ].filter((e): e is [string, string] => !!e[1]);

  for (const [format, url] of modelEntries) {
    try {
      const subCategory =
        opts.type === 'text_preview'
          ? 'preview'
          : opts.type === 'text_refine'
            ? 'high_poly'
            : 'game_ready';
      await createAttachment(opts.creator, {
        contentHash: `gen:${opts.generationId}:${format}`,
        originalFilename: `model.${format}`,
        mimeType: format === 'glb' ? 'model/gltf-binary' : `model/${format}`,
        size: 0,
        url,
        targetType: 'entity',
        targetId: opts.entityId,
        targetName,
        category: '3d',
        label: `${opts.type.replace(/_/g, ' ')} — ${format.toUpperCase()}`,
        subCategory,
        generationId: opts.generationId,
      });
    } catch (err) {
      console.error(`Failed to auto-attach 3D model (${format}):`, err);
    }
  }

  // Attach thumbnail as an image if available
  if (opts.thumbnailUrl) {
    try {
      await createAttachment(opts.creator, {
        contentHash: `gen:${opts.generationId}:thumbnail`,
        originalFilename: 'thumbnail.png',
        mimeType: 'image/png',
        size: 0,
        url: opts.thumbnailUrl,
        targetType: 'entity',
        targetId: opts.entityId,
        targetName,
        category: 'image',
        label: '3D model thumbnail',
        subCategory: 'concept_art',
        generationId: opts.generationId,
      });
    } catch (err) {
      console.error('Failed to auto-attach 3D thumbnail:', err);
    }
  }
}

// ── Background completion handler ─────────────────────────────────────

/** Final status of a 3D generation doc — 'completed' means the provider was billed. */
const genStatus = (genId: string) => async () =>
  (await threeDGenCol().doc(genId).get()).data()?.status as string | undefined;

async function completeThreeDTask(opts: {
  genId: string;
  userId: string;
  entityId: string | null;
  provider: 'meshy' | 'tripo';
  /** Provider task id (Meshy or Tripo). */
  taskId: string;
  /** Meshy only — which Meshy endpoint to poll. */
  meshyTaskType?: 'text-to-3d' | 'image-to-3d';
  generationType: string;
  credits: number;
  timeoutMs: number;
  webhookUrl?: string;
  clientToken?: string;
  // Gallery publish metadata — all optional since refine can inherit from the
  // preview and image-to-3D has no text prompt.
  prompt?: string | null;
  universeId?: string | null;
  parentGenerationId?: string | null;
  sourceImageUrl?: string | null;
}) {
  try {
    const { resolveProviderKey } = await import('../../lib/byok');
    const apiKey = await resolveProviderKey(opts.userId, opts.provider);
    let output: {
      modelUrls?: MeshyTaskOutput;
      thumbnailUrl?: string | null;
      videoUrl?: string | null;
    };
    if (opts.provider === 'tripo') {
      const task = await tripo3dService.waitForTask(opts.taskId, opts.timeoutMs, 5000, apiKey);
      const glb = tripoTaskModelUrl(task);
      if (!glb) throw new Error('Tripo3D finished without a model');
      output = {
        modelUrls: { glb } as MeshyTaskOutput,
        thumbnailUrl: task.output?.rendered_image_url ?? null,
        videoUrl: task.output?.rendered_video_url ?? null,
      };
    } else {
      const task = await meshyService.waitForTask(
        opts.taskId,
        opts.meshyTaskType ?? 'text-to-3d',
        opts.timeoutMs,
        undefined,
        apiKey
      );
      output = {
        modelUrls: task.modelUrls,
        thumbnailUrl: task.thumbnailUrl,
        videoUrl: task.videoUrl,
      };
    }

    trackQuests(opts.userId, [{ questId: 'first_3d_generation' }]);

    // Meshy's CDN URLs are CloudFront-signed and Tripo's are signed too — both
    // expire within days, so rehost every format + thumbnail/video to
    // permanent storage before persisting.
    const perm = await rehostModelBundle(output, opts.prompt || opts.genId, opts.userId);

    await threeDGenCol()
      .doc(opts.genId)
      .update({
        status: 'completed',
        ...(opts.provider === 'tripo'
          ? { tripoTaskId: opts.taskId }
          : { meshyTaskId: opts.taskId }),
        modelUrls: perm.modelUrls,
        thumbnailUrl: perm.thumbnailUrl,
        videoUrl: perm.videoUrl,
        completedAt: new Date(),
      });

    await autoAttach3DModel({
      creator: opts.userId,
      entityId: opts.entityId,
      generationId: opts.genId,
      modelUrls: perm.modelUrls as MeshyTaskOutput,
      thumbnailUrl: perm.thumbnailUrl ?? undefined,
      type: opts.generationType,
    });

    // Gallery publish — use GLB as the canonical model URL. Skipped silently
    // if GLB is missing (provider occasionally omits it for failed textures).
    const glbUrl = perm.modelUrls.glb;
    if (glbUrl) {
      const title = opts.prompt?.slice(0, 100) || 'Generated 3D Model';
      void publishToGallery({
        creatorUid: opts.userId,
        mediaUrl: glbUrl,
        mediaType: '3d',
        title,
        description: opts.prompt ?? '',
        thumbnailUrl: perm.thumbnailUrl,
        universeId: opts.universeId ?? null,
        generationId: opts.genId,
        generationModel: `${opts.provider}:${opts.generationType}`,
        parentGenerationId: opts.parentGenerationId ?? null,
        sourceImageUrl: opts.sourceImageUrl ?? null,
      });
    }

    fireJobWebhook({
      ownerUid: opts.userId,
      webhookUrl: opts.webhookUrl,
      clientToken: opts.clientToken,
      event: 'job.completed',
      jobId: opts.genId,
      kind: '3d',
      payload: {
        status: 'completed',
        modelUrls: perm.modelUrls ?? null,
        thumbnailUrl: perm.thumbnailUrl,
        videoUrl: perm.videoUrl,
        generationType: opts.generationType,
        creditsCharged: opts.credits,
      },
    });
  } catch (error) {
    await refundCreditsAfterReconcile(opts.userId, opts.credits, opts.genId);
    await threeDGenCol()
      .doc(opts.genId)
      .update({
        status: 'failed',
        creditsRefunded: true,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      });
    console.error(`3D generation ${opts.genId} failed:`, error);
    fireJobWebhook({
      ownerUid: opts.userId,
      webhookUrl: opts.webhookUrl,
      clientToken: opts.clientToken,
      event: 'job.failed',
      jobId: opts.genId,
      kind: '3d',
      payload: {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        creditsRefunded: true,
      },
    });
  }
}

// ── Router ────────────────────────────────────────────────────────────

const artStyleSchema = z.enum(['realistic', 'cartoon', 'low-poly', 'sculpture', 'pbr']);

export const threedRouter = router({
  // ── Text-to-3D preview ────────────────────────────────────────────────

  // INF-6: Meshy text-to-3D preview (~$0.05 per call) → per-key concurrency slot
  textTo3DPreview: expensiveProcedure
    .use(requirePermission('generation.3d'))
    .input(
      z.object({
        prompt: z.string().min(1).max(1000),
        negativePrompt: z.string().optional(),
        artStyle: artStyleSchema.optional(),
        seed: z.number().optional(),
        targetPolycount: z.number().optional(),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
        clientToken: clientTokenSchema,
        webhookUrl: webhookUrlSchema.optional(),
        /** `auto` = Tripo3D when the user has a Tripo key, else Meshy. */
        provider: threedProviderSchema,
        /** Tripo only: `hifi` (H3.1) or `game` (P1 clean low-poly topology). */
        quality: tripoQualitySchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      input.prompt = sanitizePrompt(input.prompt);
      if (input.negativePrompt) input.negativePrompt = sanitizePrompt(input.negativePrompt);
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
          procedure: 'threed.textTo3DPreview',
        });
        if (reservation?.existing) {
          const existingSnap = await threeDGenCol().doc(reservation.existing.jobId).get();
          const d = existingSnap.exists ? (existingSnap.data() as any) : {};
          return {
            generationId: reservation.existing.jobId,
            status: (d.status ?? 'queued') as 'queued' | 'running' | 'completed' | 'failed',
            provider: (d.provider ?? 'meshy') as 'meshy' | 'tripo',
            meshyTaskId: (d.meshyTaskId ?? null) as string | null,
            creditsCharged: (d.creditsCharged ?? 0) as number,
            fiatPriceUsd: (d.fiatPriceUsd ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      // Resolved before any charge so a missing Tripo key is a clean FORBIDDEN.
      const picked = await pickThreedProvider(ctx.user.uid, input.provider);
      const { provider } = picked;
      const modelId =
        provider === 'tripo' ? `tripo-text-to-3d-${input.quality}` : 'meshy-text-to-3d-preview';
      const { fiatMargin, loarMargin } = await getMargins();
      const cost = provider === 'tripo' ? TRIPO_GEN_COSTS[input.quality] : COSTS.text_preview;
      const credits = toCredits(cost, fiatMargin);
      // Kill-switch + HARD daily-cap reservation, BEFORE any doc/credit charge so a
      // denial needs no refund. Released by settleThreedJob when the job ends.
      const hold = await reserveThreedBudget(provider, cost);

      await threeDGenCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          universeId: input.universeId || null,
          type: 'text_preview',
          provider,
          ...(provider === 'tripo' ? { quality: input.quality } : {}),
          prompt: input.prompt,
          artStyle: input.artStyle || 'realistic',
          providerCostUsd: cost,
          fiatPriceUsd: withFiat(cost, fiatMargin),
          loarPriceUsd: withLoar(cost, loarMargin),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
          ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
          ...(input.clientToken ? { clientToken: input.clientToken } : {}),
        });

      try {
        return await withReservation(
          {
            userId: ctx.user.uid,
            modelId,
            provider,
            estimatedCredits: credits,
            byok: false,
            meta: {
              generationId: genId,
              entityId: input.entityId ?? null,
              universeId: input.universeId ?? null,
            },
          },
          async () => {
            await threeDGenCol().doc(genId).update({ status: 'running' });

            let taskId: string;
            if (picked.provider === 'tripo') {
              const styleHint =
                input.artStyle && input.artStyle !== 'realistic' && input.artStyle !== 'pbr'
                  ? `, ${input.artStyle} style`
                  : '';
              ({ taskId } = await tripo3dService.textToModel({
                prompt: `${input.prompt}${styleHint}`,
                negativePrompt: input.negativePrompt,
                quality: input.quality,
                faceLimit: input.targetPolycount,
                renderVideo: true,
                apiKey: picked.tripoApiKey,
              }));
              await threeDGenCol().doc(genId).update({ tripoTaskId: taskId });
            } else {
              const { resolveProviderKey } = await import('../../lib/byok');
              const apiKey = await resolveProviderKey(ctx.user.uid, 'meshy');
              ({ taskId } = await meshyService.textTo3DPreview({
                prompt: input.prompt,
                negativePrompt: input.negativePrompt,
                artStyle: input.artStyle,
                seed: input.seed,
                targetPolycount: input.targetPolycount,
                apiKey,
              }));
              await threeDGenCol().doc(genId).update({ meshyTaskId: taskId });
            }

            // Fire-and-forget: complete in background, client polls via getTask.
            // Webhook fires from completeThreeDTask on terminal state.
            // The reservation is reconciled when this withReservation block
            // returns successfully — post-completion failures are handled by
            // the background helper using `refundCreditsAfterReconcile`.
            settleThreedJob({
              hold,
              done: completeThreeDTask({
                genId,
                userId: ctx.user.uid,
                entityId: input.entityId || null,
                provider,
                taskId,
                meshyTaskType: 'text-to-3d',
                generationType: 'text_preview',
                credits,
                webhookUrl: validatedWebhookUrl,
                clientToken: input.clientToken,
                timeoutMs: 10 * 60 * 1000,
                prompt: input.prompt,
                universeId: input.universeId || null,
              }).catch((err) => console.error(`Background 3D preview ${genId} error:`, err)),
              provider,
              model: modelId,
              costUsd: cost,
              readStatus: genStatus(genId),
              extra: { generationId: genId },
            });

            return {
              result: {
                generationId: genId,
                status: 'running' as const,
                provider,
                meshyTaskId: (provider === 'meshy' ? taskId : null) as string | null,
                creditsCharged: credits,
                fiatPriceUsd: withFiat(cost, fiatMargin),
                idempotentReplay: false as const,
              },
            };
          }
        );
      } catch (error) {
        await hold?.release();
        await threeDGenCol()
          .doc(genId)
          .update({
            status: 'failed',
            creditsRefunded: true,
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.failed',
          jobId: genId,
          kind: '3d',
          payload: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            creditsRefunded: true,
          },
        });
        throw error;
      }
    }),

  // ── Text-to-3D refine ─────────────────────────────────────────────────

  // INF-6: Meshy text-to-3D refine (~$0.20 per call)
  textTo3DRefine: expensiveProcedure
    .use(requirePermission('generation.3d'))
    .input(
      z.object({
        previewGenerationId: z.string().min(1), // LOAR generation ID from textTo3DPreview
        textureRichness: z.enum(['high', 'medium', 'low']).optional(),
        entityId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { fiatMargin, loarMargin } = await getMargins();
      // Look up the preview task to get the Meshy task ID
      const previewDoc = await threeDGenCol().doc(input.previewGenerationId).get();
      if (!previewDoc.exists) throw new Error('Preview generation not found');
      const previewData = previewDoc.data()!;
      if (previewData.userId !== ctx.user.uid) throw new Error('Not authorized');
      if (previewData.provider === 'tripo') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Tripo3D models are already full quality — there is nothing to refine.',
        });
      }
      if (previewData.status !== 'completed' || !previewData.meshyTaskId) {
        throw new Error('Preview generation must be completed before refining');
      }

      const genId = randomUUID();
      const cost = COSTS.text_refine;
      const credits = toCredits(cost, fiatMargin);
      const hold = await reserveThreedBudget('meshy', cost);

      await threeDGenCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || previewData.entityId || null,
          type: 'text_refine',
          previewGenerationId: input.previewGenerationId,
          previewMeshyTaskId: previewData.meshyTaskId,
          providerCostUsd: cost,
          fiatPriceUsd: withFiat(cost, fiatMargin),
          loarPriceUsd: withLoar(cost, loarMargin),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
        });

      try {
        return await withReservation(
          {
            userId: ctx.user.uid,
            modelId: 'meshy-text-to-3d-refine',
            provider: 'meshy',
            estimatedCredits: credits,
            byok: false,
            meta: {
              generationId: genId,
              previewGenerationId: input.previewGenerationId,
            },
          },
          async () => {
            await threeDGenCol().doc(genId).update({ status: 'running' });

            const { resolveProviderKey } = await import('../../lib/byok');
            const apiKey = await resolveProviderKey(ctx.user.uid, 'meshy');
            const { taskId } = await meshyService.textTo3DRefine({
              previewTaskId: previewData.meshyTaskId,
              textureRichness: input.textureRichness,
              apiKey,
            });

            await threeDGenCol().doc(genId).update({ meshyTaskId: taskId });

            // Fire-and-forget: complete in background, client polls via getTask
            settleThreedJob({
              hold,
              done: completeThreeDTask({
                genId,
                userId: ctx.user.uid,
                entityId: input.entityId || previewData.entityId || null,
                provider: 'meshy',
                taskId,
                meshyTaskType: 'text-to-3d',
                generationType: 'text_refine',
                credits,
                timeoutMs: 15 * 60 * 1000,
                prompt: previewData.prompt ?? null,
                universeId: previewData.universeId ?? null,
                parentGenerationId: input.previewGenerationId,
              }).catch((err) => console.error(`Background 3D refine ${genId} error:`, err)),
              provider: 'meshy',
              model: 'meshy-text-to-3d-refine',
              costUsd: cost,
              readStatus: genStatus(genId),
              extra: { generationId: genId },
            });

            return {
              result: {
                generationId: genId,
                status: 'running' as const,
                meshyTaskId: taskId,
                creditsCharged: credits,
                fiatPriceUsd: withFiat(cost, fiatMargin),
              },
            };
          }
        );
      } catch (error) {
        await hold?.release();
        await threeDGenCol()
          .doc(genId)
          .update({
            status: 'failed',
            creditsRefunded: true,
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        throw error;
      }
    }),

  // ── Image-to-3D ───────────────────────────────────────────────────────

  // INF-6: Meshy image-to-3D (~$0.15 per call)
  imageTo3D: expensiveProcedure
    .input(
      z.object({
        /** With Tripo3D, 2–4 images are read as front, left, back, right views. */
        imageUrls: z.array(z.string().url()).min(1).max(4),
        enablePbr: z.boolean().optional().default(true),
        targetPolycount: z.number().optional(),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
        clientToken: clientTokenSchema,
        webhookUrl: webhookUrlSchema.optional(),
        /** `auto` = Tripo3D when the user has a Tripo key, else Meshy. */
        provider: threedProviderSchema,
        /** Tripo only: `hifi` (H3.1) or `game` (P1 clean low-poly topology). */
        quality: tripoQualitySchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const genId = randomUUID();

      // SSRF guard: every image URL the server hands to Meshy must be a
      // public address. Reject loopback / RFC1918 / IMDS / link-local up front.
      for (const u of input.imageUrls) {
        try {
          assertSafeExternalUrl(u);
        } catch (err) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: err instanceof Error ? err.message : 'imageUrls rejected',
          });
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

      // ── Idempotency (clientToken) ───────────────────────────────────
      if (input.clientToken) {
        const reservation = await reserveClientToken({
          ownerUid: ctx.user.uid,
          clientToken: input.clientToken,
          jobId: genId,
          procedure: 'threed.imageTo3D',
        });
        if (reservation?.existing) {
          const existingSnap = await threeDGenCol().doc(reservation.existing.jobId).get();
          const d = existingSnap.exists ? (existingSnap.data() as any) : {};
          return {
            generationId: reservation.existing.jobId,
            status: (d.status ?? 'queued') as 'queued' | 'running' | 'completed' | 'failed',
            provider: (d.provider ?? 'meshy') as 'meshy' | 'tripo',
            meshyTaskId: (d.meshyTaskId ?? null) as string | null,
            creditsCharged: (d.creditsCharged ?? 0) as number,
            fiatPriceUsd: (d.fiatPriceUsd ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      const picked = await pickThreedProvider(ctx.user.uid, input.provider);
      const { provider } = picked;
      const isMulti = input.imageUrls.length > 1;
      const modelId =
        provider === 'tripo'
          ? `tripo-${isMulti ? 'multiview' : 'image'}-to-3d-${input.quality}`
          : isMulti
            ? 'meshy-multi-image-to-3d'
            : 'meshy-image-to-3d';
      const { fiatMargin, loarMargin } = await getMargins();
      const cost = provider === 'tripo' ? TRIPO_GEN_COSTS[input.quality] : COSTS.image_to_3d;
      const credits = toCredits(cost, fiatMargin);
      const hold = await reserveThreedBudget(provider, cost);

      await threeDGenCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          universeId: input.universeId || null,
          type: isMulti ? 'multi_image_to_3d' : 'image_to_3d',
          provider,
          ...(provider === 'tripo' ? { quality: input.quality } : {}),
          imageUrls: input.imageUrls,
          providerCostUsd: cost,
          fiatPriceUsd: withFiat(cost, fiatMargin),
          loarPriceUsd: withLoar(cost, loarMargin),
          creditsCharged: credits,
          status: 'queued',
          createdAt: new Date(),
          ...(validatedWebhookUrl ? { webhookUrl: validatedWebhookUrl } : {}),
          ...(input.clientToken ? { clientToken: input.clientToken } : {}),
        });

      try {
        return await withReservation(
          {
            userId: ctx.user.uid,
            modelId,
            provider,
            estimatedCredits: credits,
            byok: false,
            meta: {
              generationId: genId,
              entityId: input.entityId ?? null,
              universeId: input.universeId ?? null,
            },
          },
          async () => {
            await threeDGenCol().doc(genId).update({ status: 'running' });

            let taskId: string;
            if (picked.provider === 'tripo') {
              const common = {
                quality: input.quality,
                faceLimit: input.targetPolycount,
                renderVideo: true,
                apiKey: picked.tripoApiKey,
              };
              const [front, left, back, right] = input.imageUrls;
              ({ taskId } = isMulti
                ? await tripo3dService.multiviewToModel({
                    views: { front, left, back, right },
                    ...common,
                  })
                : await tripo3dService.imageToModel({ input: front, ...common }));
              await threeDGenCol().doc(genId).update({ tripoTaskId: taskId });
            } else if (isMulti) {
              const { resolveProviderKey } = await import('../../lib/byok');
              const apiKey = await resolveProviderKey(ctx.user.uid, 'meshy');
              const result = await meshyService.multiImageTo3D({
                imageUrls: input.imageUrls,
                enablePbr: input.enablePbr,
                targetPolycount: input.targetPolycount,
                apiKey,
              });
              taskId = result.taskId;
            } else {
              const { resolveProviderKey } = await import('../../lib/byok');
              const apiKey = await resolveProviderKey(ctx.user.uid, 'meshy');
              const result = await meshyService.imageTo3D({
                imageUrl: input.imageUrls[0],
                enablePbr: input.enablePbr,
                targetPolycount: input.targetPolycount,
                apiKey,
              });
              taskId = result.taskId;
            }
            if (provider === 'meshy') {
              await threeDGenCol().doc(genId).update({ meshyTaskId: taskId });
            }

            // Fire-and-forget: complete in background, client polls via getTask
            settleThreedJob({
              hold,
              done: completeThreeDTask({
                genId,
                userId: ctx.user.uid,
                entityId: input.entityId || null,
                provider,
                taskId,
                meshyTaskType: 'image-to-3d',
                generationType: isMulti ? 'multi_image_to_3d' : 'image_to_3d',
                credits,
                webhookUrl: validatedWebhookUrl,
                clientToken: input.clientToken,
                timeoutMs: 15 * 60 * 1000,
                universeId: input.universeId || null,
                sourceImageUrl: input.imageUrls[0] ?? null,
              }).catch((err) => console.error(`Background 3D image-to-3d ${genId} error:`, err)),
              provider,
              model: modelId,
              costUsd: cost,
              readStatus: genStatus(genId),
              extra: { generationId: genId },
            });

            return {
              result: {
                generationId: genId,
                status: 'running' as const,
                provider,
                meshyTaskId: (provider === 'meshy' ? taskId : null) as string | null,
                creditsCharged: credits,
                fiatPriceUsd: withFiat(cost, fiatMargin),
                idempotentReplay: false as const,
              },
            };
          }
        );
      } catch (error) {
        await hold?.release();
        await threeDGenCol()
          .doc(genId)
          .update({
            status: 'failed',
            creditsRefunded: true,
            failureReason: error instanceof Error ? error.message : 'Unknown error',
            completedAt: new Date(),
          });
        fireJobWebhook({
          ownerUid: ctx.user.uid,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          event: 'job.failed',
          jobId: genId,
          kind: '3d',
          payload: {
            status: 'failed',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            creditsRefunded: true,
          },
        });
        throw error;
      }
    }),

  // ── Status / history ──────────────────────────────────────────────────

  getTask: protectedProcedure
    .input(z.object({ generationId: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await threeDGenCol().doc(input.generationId).get();
      if (!doc.exists) return null;
      const data = doc.data()!;
      if (data.userId !== ctx.user.uid) throw new Error('Not authorized');
      return { id: doc.id, ...data };
    }),

  history: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        entityId: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const snapshot = await threeDGenCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(HISTORY_READ_CAP)
        .get();

      let rows = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, any>);

      if (input.entityId) {
        rows = rows.filter((d) => d.entityId === input.entityId);
      }

      return rows.slice(0, input.limit);
    }),

  estimateCost: publicProcedure
    .input(
      z.object({
        type: z.enum(['text_preview', 'text_refine', 'image_to_3d']),
      })
    )
    .query(async ({ input }) => {
      const { fiatMargin, loarMargin } = await getMargins();
      const cost = COSTS[input.type];
      return {
        providerCostUsd: cost,
        fiatPriceUsd: withFiat(cost, fiatMargin),
        loarPriceUsd: withLoar(cost, loarMargin),
        credits: toCredits(cost, fiatMargin),
      };
    }),

  // ── Rigging + animation (Meshy auto-rig + library) ──────────────────

  /**
   * Curated preset list surfaced in the wiki testbench. Each preset carries
   * an `actionRef` that the server parses to route to the right provider:
   *   - `meshy:<number>`     → Meshy animation library (humanoid only)
   *   - `tripo:<preset name>` → Tripo3D animation library (all rig types)
   *
   * The client filters by `rigTypes` to show only animations valid for the
   * rig the user picked.
   */
  animationPresets: publicProcedure.query(() => ANIMATION_PRESETS),

  /**
   * Rig a textured static GLB so it can accept library animations.
   *
   * `rigType`:
   *   - `auto` → Tripo3D rig-check reads the mesh and picks the skeleton
   *              (humanoid, beast, spider, snake, bird, fish…). Tripo only.
   *   - `biped` → humanoids and two-legged monsters. Tripo3D when `provider`
   *              resolves to it (default when the user has a Tripo key),
   *              otherwise Meshy auto-rig.
   *   - `quadruped | hexapod | octopod | avian | serpentine | aquatic | others`
   *              → Tripo3D (Meshy only rigs humanoids).
   *
   * "Others" is the catch-all for vehicles (planes, cars, boats) and
   * mechanical/abstract meshes — Tripo applies a generic rig.
   *
   * Publishes the rigged GLB to the gallery as a derivative when the
   * provider finishes (1–5 min typical). Returns immediately with a job id
   * the client polls via lineage refetch.
   */
  rig: expensiveProcedure
    .use(requirePermission('generation.3d'))
    .input(
      z.object({
        contentId: z.string().min(1),
        rigType: z
          .enum([
            'biped',
            'quadruped',
            'hexapod',
            'octopod',
            'avian',
            'serpentine',
            'aquatic',
            'others',
            'auto',
          ])
          .default('biped'),
        /** Biped only — Meshy or Tripo3D. Every other rig type is Tripo3D. */
        provider: threedProviderSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const contentDoc = await db.collection('content').doc(input.contentId).get();
      if (!contentDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Content not found' });
      }
      const content = contentDoc.data()!;
      if (content.mediaType !== '3d' || !content.mediaUrl) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only 3D models with a media URL can be rigged',
        });
      }
      if (content.creatorUid && content.creatorUid !== ctx.user.uid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can rig this model',
        });
      }

      // BYOK is mandatory for both providers — there is no server key pool
      // (dispatcher.ts resolves BYOK only). Resolve the caller's Tripo key up
      // front so a missing key fails as a clean FORBIDDEN *before* any credit
      // reservation, the same way every other BYOK-gated route behaves.
      let provider: 'meshy' | 'tripo';
      let tripoApiKey: string | undefined;
      if (input.rigType === 'biped') {
        const picked = await pickThreedProvider(ctx.user.uid, input.provider);
        provider = picked.provider;
        tripoApiKey = picked.tripoApiKey;
      } else {
        if (input.provider === 'meshy') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Meshy only rigs humanoids — use Tripo3D for this rig type.',
          });
        }
        provider = 'tripo';
        tripoApiKey = await requireTripoApiKey(
          ctx.user.uid,
          input.rigType === 'auto'
            ? 'Add your Tripo3D API key at /settings/api-keys to auto-detect and rig models.'
            : 'Add your Tripo3D API key at /settings/api-keys to rig non-humanoid models.'
        );
      }

      const { fiatMargin } = await getMargins();
      const credits = toCredits(RIG_COST, fiatMargin);
      const hold = await reserveThreedBudget(provider, RIG_COST);
      const genId = randomUUID();
      const sourceTitle = (content.title as string | undefined) ?? '3D model';
      const sourceUrl = content.mediaUrl as string;
      const universeId = (content.universeId as string | null | undefined) ?? null;
      const parentGenerationId = (content.generationId as string | null | undefined) ?? null;

      return releaseHoldOnError(hold, () =>
        withReservation(
          {
            userId: ctx.user.uid,
            modelId: `${provider}-rigging:${input.rigType}`,
            provider,
            estimatedCredits: credits,
            byok: false,
            meta: {
              genId,
              sourceContentId: input.contentId,
              rigType: input.rigType,
              kind: 'rig',
            },
          },
          async () => {
            const { resolveProviderKey } = await import('../../lib/byok');

            if (provider === 'meshy') {
              const apiKey = await resolveProviderKey(ctx.user.uid, 'meshy');
              const { taskId } = await meshyService.rigModel({ modelUrl: sourceUrl, apiKey });
              await threeDGenCol().doc(genId).set({
                id: genId,
                userId: ctx.user.uid,
                type: 'meshy_rigging',
                status: 'running',
                meshyTaskId: taskId,
                sourceContentId: input.contentId,
                sourceMediaUrl: sourceUrl,
                rigType: input.rigType,
                universeId,
                parentGenerationId,
                createdAt: new Date(),
              });
              settleThreedJob({
                hold,
                done: completeMeshyRiggingTask({
                  genId,
                  userId: ctx.user.uid,
                  meshyTaskId: taskId,
                  sourceTitle,
                  universeId,
                  parentGenerationId,
                  credits,
                }),
                provider: 'meshy',
                model: 'meshy-rigging',
                costUsd: RIG_COST,
                readStatus: genStatus(genId),
                extra: { generationId: genId },
              });
              return {
                result: {
                  jobId: genId,
                  providerTaskId: taskId,
                  provider: 'meshy' as 'meshy' | 'tripo',
                  rigType: 'biped' as TripoRigType,
                },
                actualCredits: credits,
              };
            }

            // Tripo3D path — upload the GLB, then rig (animate is a separate
            // request). v3's rig endpoint takes the file_token directly, so the
            // old import_model task + inline poll are gone.
            // Key was resolved and non-null-checked before the reservation above.
            const apiKey = tripoApiKey!;
            const fileToken = await tripo3dService.uploadRemoteGlb(sourceUrl, apiKey);
            const rigType: TripoRigType =
              input.rigType === 'auto'
                ? await detectTripoRigType(fileToken, apiKey)
                : input.rigType;
            const { taskId } = await tripo3dService.rigModel({
              input: fileToken,
              rigType,
              apiKey,
            });
            await threeDGenCol()
              .doc(genId)
              .set({
                id: genId,
                userId: ctx.user.uid,
                type: 'tripo_rigging',
                status: 'running',
                tripoRigTaskId: taskId,
                sourceContentId: input.contentId,
                sourceMediaUrl: sourceUrl,
                rigType,
                ...(input.rigType === 'auto' ? { rigTypeDetected: true } : {}),
                universeId,
                parentGenerationId,
                createdAt: new Date(),
              });
            settleThreedJob({
              hold,
              done: completeTripoRiggingTask({
                genId,
                userId: ctx.user.uid,
                tripoRigTaskId: taskId,
                sourceTitle,
                rigType,
                universeId,
                parentGenerationId,
                credits,
              }),
              provider: 'tripo',
              model: 'tripo-rigging',
              costUsd: RIG_COST,
              readStatus: genStatus(genId),
              extra: { generationId: genId },
            });
            return {
              result: {
                jobId: genId,
                providerTaskId: taskId,
                provider: 'tripo' as 'meshy' | 'tripo',
                rigType,
              },
              actualCredits: credits,
            };
          }
        )
      );
    }),

  /**
   * Apply a library animation to a previously-rigged 3D model.
   * Pass `riggedContentId` (the gallery doc id of the rigged item) and an
   * `actionRef` from `animationPresets`. The server reads the rigged item's
   * `generationId` (encoded as `rig:meshy:<taskId>` or `rig:tripo:<taskId>`)
   * to dispatch to the correct provider.
   */
  animate: expensiveProcedure
    .use(requirePermission('generation.3d'))
    .input(
      z.object({
        riggedContentId: z.string().min(1),
        actionRef: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const riggedDoc = await db.collection('content').doc(input.riggedContentId).get();
      if (!riggedDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Rigged model not found' });
      }
      const rigged = riggedDoc.data()!;
      if (rigged.creatorUid && rigged.creatorUid !== ctx.user.uid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can animate this model',
        });
      }
      const parsed = parseRigGenerationId(rigged.generationId as string | undefined);
      if (!parsed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Source is not a rigged model — rig it first via threed.rig',
        });
      }
      const preset = ANIMATION_PRESETS.find((p) => p.actionRef === input.actionRef);
      if (!preset) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown animation preset' });
      }
      if (preset.provider !== parsed.provider) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `This preset requires a ${preset.provider}-rigged model — this one is ${parsed.provider}`,
        });
      }

      // BYOK is mandatory for Tripo3D animation retarget — there is no server
      // key pool. Resolve the caller's own key up front so a missing key is a
      // clean FORBIDDEN before the credit reservation.
      let tripoApiKey: string | undefined;
      if (parsed.provider === 'tripo') {
        const { resolveProviderKey } = await import('../../lib/byok');
        tripoApiKey = await resolveProviderKey(ctx.user.uid, 'tripo');
        if (!tripoApiKey) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Add your Tripo3D API key at /settings/api-keys to animate this model.',
          });
        }
      }

      const { fiatMargin } = await getMargins();
      const credits = toCredits(ANIMATION_COST, fiatMargin);
      const hold = await reserveThreedBudget(parsed.provider, ANIMATION_COST);
      const genId = randomUUID();
      const riggedTitle = (rigged.title as string | undefined) ?? '3D model';
      const universeId = (rigged.universeId as string | null | undefined) ?? null;
      const rigGenId = rigged.generationId as string;

      return releaseHoldOnError(hold, () =>
        withReservation(
          {
            userId: ctx.user.uid,
            modelId: `${parsed.provider}-animation:${input.actionRef}`,
            provider: parsed.provider,
            estimatedCredits: credits,
            byok: false,
            meta: {
              genId,
              riggedContentId: input.riggedContentId,
              actionRef: input.actionRef,
              kind: 'animate',
            },
          },
          async () => {
            const { resolveProviderKey } = await import('../../lib/byok');

            if (parsed.provider === 'meshy') {
              const apiKey = await resolveProviderKey(ctx.user.uid, 'meshy');
              const actionId = Number(input.actionRef.slice('meshy:'.length));
              const { taskId } = await meshyService.applyAnimation({
                rigTaskId: parsed.taskId,
                actionId,
                apiKey,
              });
              await threeDGenCol().doc(genId).set({
                id: genId,
                userId: ctx.user.uid,
                type: 'meshy_animation',
                status: 'running',
                meshyTaskId: taskId,
                riggedContentId: input.riggedContentId,
                actionRef: input.actionRef,
                actionName: preset.name,
                universeId,
                parentGenerationId: rigGenId,
                createdAt: new Date(),
              });
              settleThreedJob({
                hold,
                done: completeMeshyAnimationTask({
                  genId,
                  userId: ctx.user.uid,
                  meshyTaskId: taskId,
                  riggedTitle,
                  actionRef: input.actionRef,
                  actionName: preset.name,
                  universeId,
                  parentGenerationId: rigGenId,
                  credits,
                }),
                provider: 'meshy',
                model: 'meshy-animation',
                costUsd: ANIMATION_COST,
                readStatus: genStatus(genId),
                extra: { generationId: genId },
              });
              return { result: { jobId: genId, providerTaskId: taskId }, actualCredits: credits };
            }

            // Tripo3D animation retarget — key resolved + checked before the
            // reservation above.
            const apiKey = tripoApiKey;
            const tripoAnimation = input.actionRef.slice('tripo:'.length) as TripoAnimation;
            const { taskId } = await tripo3dService.retargetAnimation({
              input: parsed.taskId,
              animation: tripoAnimation,
              apiKey,
            });
            await threeDGenCol().doc(genId).set({
              id: genId,
              userId: ctx.user.uid,
              type: 'tripo_animation',
              status: 'running',
              tripoAnimationTaskId: taskId,
              riggedContentId: input.riggedContentId,
              actionRef: input.actionRef,
              actionName: preset.name,
              universeId,
              parentGenerationId: rigGenId,
              createdAt: new Date(),
            });
            settleThreedJob({
              hold,
              done: completeTripoAnimationTask({
                genId,
                userId: ctx.user.uid,
                tripoAnimationTaskId: taskId,
                riggedTitle,
                actionRef: input.actionRef,
                actionName: preset.name,
                universeId,
                parentGenerationId: rigGenId,
                credits,
              }),
              provider: 'tripo',
              model: 'tripo-animation',
              costUsd: ANIMATION_COST,
              readStatus: genStatus(genId),
              extra: { generationId: genId },
            });
            return { result: { jobId: genId, providerTaskId: taskId }, actualCredits: credits };
          }
        )
      );
    }),

  /**
   * Remesh (retopology / decimation) a previously generated 3D model — e.g. cut
   * a 500k-tri sculpt to a game-ready 30k quad mesh. Pass `contentId` (the
   * gallery item of a 3D model you own). Runs in the background like rig/animate;
   * the result is published to the gallery as a new item.
   *
   * Only glb/fbx/obj/usdz are offered: those are the formats we re-host to
   * permanent storage. Meshy's CDN URLs expire, so stl/3mf/blend would be
   * stored as links that die within days.
   */
  remesh: expensiveProcedure
    .use(requirePermission('generation.3d'))
    .input(
      z.object({
        contentId: z.string().min(1),
        topology: z.enum(['quad', 'triangle']).default('triangle'),
        targetPolycount: z
          .number()
          .int()
          .min(MESHY_REMESH_MIN_POLYCOUNT)
          .max(MESHY_REMESH_MAX_POLYCOUNT)
          .default(30_000),
        targetFormats: z
          .array(z.enum(REMESH_OUTPUT_FORMATS))
          .min(1)
          .max(REMESH_OUTPUT_FORMATS.length)
          .default(['glb']),
        /** `auto` = Tripo3D convert when the user has a Tripo key, else Meshy remesh. */
        provider: threedProviderSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const contentDoc = await db.collection('content').doc(input.contentId).get();
      if (!contentDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Content not found' });
      }
      const content = contentDoc.data()!;
      if (content.mediaType !== '3d' || !content.mediaUrl) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only 3D models with a media URL can be remeshed',
        });
      }
      if (content.creatorUid && content.creatorUid !== ctx.user.uid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can remesh this model',
        });
      }

      const picked = await pickThreedProvider(ctx.user.uid, input.provider);
      // Provider cost comes from the 3D model registry (single source of truth);
      // the credit price applies the same platform margin as every other 3D task.
      // Tripo converts one format per task, so it is billed per format.
      const cost =
        picked.provider === 'tripo'
          ? (getThreedModelById('tripo-remesh')?.providerCostUsd ?? 0) * input.targetFormats.length
          : (getThreedModelById('meshy-remesh')?.providerCostUsd ?? 0);
      const { fiatMargin } = await getMargins();
      const credits = toCredits(cost, fiatMargin);
      const genId = randomUUID();
      const sourceTitle = (content.title as string | undefined) ?? '3D model';
      const sourceUrl = content.mediaUrl as string;
      const universeId = (content.universeId as string | null | undefined) ?? null;
      const parentGenerationId = (content.generationId as string | null | undefined) ?? null;
      const hold = await reserveThreedBudget(picked.provider, cost);

      if (picked.provider === 'tripo') {
        const apiKey = picked.tripoApiKey;
        return releaseHoldOnError(hold, () =>
          withReservation(
            {
              userId: ctx.user.uid,
              modelId: 'tripo-remesh',
              provider: 'tripo',
              estimatedCredits: credits,
              byok: false,
              meta: { genId, sourceContentId: input.contentId, kind: 'remesh' },
            },
            async () => {
              // Upload once; every format's convert task reads the same token.
              const fileToken = await tripo3dService.uploadRemoteGlb(sourceUrl, apiKey);
              const [first, ...rest] = input.targetFormats;
              const { taskId } = await tripo3dService.convertModel(
                tripoRemeshArgs(fileToken, first, input.topology, input.targetPolycount, apiKey)
              );
              await threeDGenCol()
                .doc(genId)
                .set({
                  id: genId,
                  userId: ctx.user.uid,
                  type: 'tripo_remesh',
                  provider: 'tripo',
                  status: 'running',
                  tripoTaskIds: { [first]: taskId },
                  sourceContentId: input.contentId,
                  sourceMediaUrl: sourceUrl,
                  topology: input.topology,
                  targetPolycount: input.targetPolycount,
                  targetFormats: input.targetFormats,
                  providerCostUsd: cost,
                  creditsCharged: credits,
                  universeId,
                  parentGenerationId,
                  createdAt: new Date(),
                });
              settleThreedJob({
                hold,
                done: completeTripoRemeshTask({
                  genId,
                  userId: ctx.user.uid,
                  apiKey,
                  fileToken,
                  firstTask: { format: first, taskId },
                  remainingFormats: rest,
                  sourceTitle,
                  topology: input.topology,
                  targetPolycount: input.targetPolycount,
                  universeId,
                  parentGenerationId,
                  credits,
                }),
                provider: 'tripo',
                model: 'tripo-remesh',
                costUsd: cost,
                readStatus: genStatus(genId),
                extra: { generationId: genId },
              });
              return { result: { jobId: genId, providerTaskId: taskId }, actualCredits: credits };
            }
          )
        );
      }

      return releaseHoldOnError(hold, () =>
        withReservation(
          {
            userId: ctx.user.uid,
            modelId: 'meshy-remesh',
            provider: 'meshy',
            estimatedCredits: credits,
            byok: false,
            meta: { genId, sourceContentId: input.contentId, kind: 'remesh' },
          },
          async () => {
            const { resolveProviderKey } = await import('../../lib/byok');
            const apiKey = await resolveProviderKey(ctx.user.uid, 'meshy');
            const { taskId } = await meshyService.remesh({
              modelUrl: sourceUrl,
              targetFormats: input.targetFormats,
              topology: input.topology,
              targetPolycount: input.targetPolycount,
              apiKey,
            });
            await threeDGenCol().doc(genId).set({
              id: genId,
              userId: ctx.user.uid,
              type: 'meshy_remesh',
              status: 'running',
              meshyTaskId: taskId,
              sourceContentId: input.contentId,
              sourceMediaUrl: sourceUrl,
              topology: input.topology,
              targetPolycount: input.targetPolycount,
              targetFormats: input.targetFormats,
              providerCostUsd: cost,
              creditsCharged: credits,
              universeId,
              parentGenerationId,
              createdAt: new Date(),
            });
            settleThreedJob({
              hold,
              done: completeMeshyRemeshTask({
                genId,
                userId: ctx.user.uid,
                meshyTaskId: taskId,
                sourceTitle,
                topology: input.topology,
                targetPolycount: input.targetPolycount,
                universeId,
                parentGenerationId,
                credits,
              }),
              provider: 'meshy',
              model: 'meshy-remesh',
              costUsd: cost,
              readStatus: genStatus(genId),
              extra: { generationId: genId },
            });
            return { result: { jobId: genId, providerTaskId: taskId }, actualCredits: credits };
          }
        )
      );
    }),
});

// ── Rigging/animation pricing + presets ─────────────────────────────────

const RIG_COST = 0.3;
const ANIMATION_COST = 0.1;

export type RigTypeId =
  | 'biped'
  | 'quadruped'
  | 'hexapod'
  | 'octopod'
  | 'avian'
  | 'serpentine'
  | 'aquatic'
  | 'others';

export interface AnimationPreset {
  /** Stable preset id; `meshy:<n>` or `tripo:<preset name>`. */
  actionRef: string;
  /** Human-readable label for the UI button. */
  name: string;
  /** Rough grouping (DailyActions, Locomotion, Combat, Stunts, Vehicle…). */
  category: string;
  /** Which provider handles this preset — must match the rigged model's. */
  provider: 'meshy' | 'tripo';
  /** Rig types that can use this animation — UI filters by the rig in use. */
  rigTypes: RigTypeId[];
}

/**
 * Curated cross-provider preset list. Meshy presets cover humanoids only;
 * Tripo presets fan out across every non-humanoid rig type so quadrupeds,
 * birds, snakes, fish, insects, spiders, and vehicles all have something to
 * test. Extend freely — UI auto-derives rig-type filters.
 */
const ANIMATION_PRESETS: AnimationPreset[] = [
  // ── Meshy (humanoid) — numeric IDs from the Meshy animation library
  {
    actionRef: 'meshy:0',
    name: 'Idle',
    category: 'DailyActions',
    provider: 'meshy',
    rigTypes: ['biped'],
  },
  {
    actionRef: 'meshy:1',
    name: 'Walking',
    category: 'Locomotion',
    provider: 'meshy',
    rigTypes: ['biped'],
  },
  {
    actionRef: 'meshy:14',
    name: 'Run',
    category: 'Locomotion',
    provider: 'meshy',
    rigTypes: ['biped'],
  },
  {
    actionRef: 'meshy:22',
    name: 'Dance',
    category: 'Performance',
    provider: 'meshy',
    rigTypes: ['biped'],
  },
  {
    actionRef: 'meshy:87',
    name: 'Boxing',
    category: 'Combat',
    provider: 'meshy',
    rigTypes: ['biped'],
  },
  {
    actionRef: 'meshy:452',
    name: 'Backflip',
    category: 'Stunts',
    provider: 'meshy',
    rigTypes: ['biped'],
  },

  // ── Tripo3D (everything else + biped fallback)
  // Generic presets work on humanoid + quadruped + avian + others
  {
    actionRef: 'tripo:preset:idle',
    name: 'Idle',
    category: 'DailyActions',
    provider: 'tripo',
    rigTypes: ['biped', 'quadruped', 'hexapod', 'octopod', 'avian', 'others'],
  },
  {
    actionRef: 'tripo:preset:walk',
    name: 'Walk',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['biped', 'others'],
  },
  {
    actionRef: 'tripo:preset:run',
    name: 'Run',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['biped', 'others'],
  },
  {
    actionRef: 'tripo:preset:jump',
    name: 'Jump',
    category: 'Stunts',
    provider: 'tripo',
    rigTypes: ['biped', 'quadruped', 'hexapod', 'others'],
  },
  {
    actionRef: 'tripo:preset:turn',
    name: 'Turn',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['biped', 'quadruped', 'hexapod', 'octopod', 'avian', 'aquatic', 'others'],
  },
  {
    actionRef: 'tripo:preset:fall',
    name: 'Fall',
    category: 'Reactions',
    provider: 'tripo',
    rigTypes: ['biped', 'quadruped', 'avian', 'others'],
  },
  {
    actionRef: 'tripo:preset:hurt',
    name: 'Hurt',
    category: 'Reactions',
    provider: 'tripo',
    rigTypes: ['biped', 'quadruped', 'hexapod', 'avian', 'others'],
  },
  {
    actionRef: 'tripo:preset:climb',
    name: 'Climb',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['biped', 'hexapod', 'others'],
  },
  {
    actionRef: 'tripo:preset:dive',
    name: 'Dive',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['biped', 'aquatic', 'avian', 'others'],
  },
  {
    actionRef: 'tripo:preset:slash',
    name: 'Slash',
    category: 'Combat',
    provider: 'tripo',
    rigTypes: ['biped', 'quadruped', 'others'],
  },
  {
    actionRef: 'tripo:preset:shoot',
    name: 'Shoot',
    category: 'Combat',
    provider: 'tripo',
    rigTypes: ['biped', 'others'],
  },
  // Rig-type-specific gaits
  {
    actionRef: 'tripo:preset:quadruped:walk',
    name: 'Quadruped Walk',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['quadruped'],
  },
  {
    actionRef: 'tripo:preset:hexapod:walk',
    name: 'Hexapod Walk',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['hexapod'],
  },
  {
    actionRef: 'tripo:preset:octopod:walk',
    name: 'Octopod Walk',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['octopod'],
  },
  {
    actionRef: 'tripo:preset:serpentine:march',
    name: 'Serpentine Slither',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['serpentine'],
  },
  {
    actionRef: 'tripo:preset:aquatic:march',
    name: 'Aquatic Swim',
    category: 'Locomotion',
    provider: 'tripo',
    rigTypes: ['aquatic'],
  },
];

/**
 * Decode the provider + provider-side task id from a rigged gallery item's
 * `generationId`. The encoding is `rig:<provider>:<taskId>`.
 */
function parseRigGenerationId(
  raw: string | undefined
): { provider: 'meshy' | 'tripo'; taskId: string } | null {
  if (!raw) return null;
  if (raw.startsWith('rig:meshy:')) {
    return { provider: 'meshy', taskId: raw.slice('rig:meshy:'.length) };
  }
  if (raw.startsWith('rig:tripo:')) {
    return { provider: 'tripo', taskId: raw.slice('rig:tripo:'.length) };
  }
  // Legacy items predating the provider-tagged scheme — assume Meshy since
  // Tripo wasn't available then.
  if (raw.startsWith('rig:')) {
    return { provider: 'meshy', taskId: raw.slice('rig:'.length) };
  }
  return null;
}

// ── Background completion handlers ───────────────────────────────────────

async function completeMeshyRiggingTask(opts: {
  genId: string;
  userId: string;
  meshyTaskId: string;
  sourceTitle: string;
  universeId: string | null;
  parentGenerationId: string | null;
  credits: number;
}) {
  try {
    const { resolveProviderKey } = await import('../../lib/byok');
    const apiKey = await resolveProviderKey(opts.userId, 'meshy');
    const task = await meshyService.waitForRigging(opts.meshyTaskId, 15 * 60 * 1000, 5000, apiKey);

    if (!task.riggedModelUrls?.glb) {
      throw new Error('Meshy rigging completed without a GLB output');
    }

    // Meshy CDN URLs expire — rehost the rigged GLB/FBX + thumbnail first.
    const perm = await rehostModelBundle(
      {
        modelUrls: { glb: task.riggedModelUrls.glb, fbx: task.riggedModelUrls.fbx },
        thumbnailUrl: task.thumbnailUrl,
      },
      `${opts.sourceTitle}-rigged`,
      opts.userId
    );
    const glbUrl = perm.modelUrls.glb ?? task.riggedModelUrls.glb;

    await threeDGenCol()
      .doc(opts.genId)
      .update({
        status: 'completed',
        riggedGlbUrl: glbUrl,
        riggedFbxUrl: perm.modelUrls.fbx ?? task.riggedModelUrls.fbx ?? null,
        thumbnailUrl: perm.thumbnailUrl,
        completedAt: new Date(),
      });

    void publishToGallery({
      creatorUid: opts.userId,
      mediaUrl: glbUrl,
      mediaType: '3d',
      title: `${opts.sourceTitle} — rigged (humanoid)`,
      description: 'Auto-rigged humanoid skeleton, ready for animation library presets.',
      thumbnailUrl: perm.thumbnailUrl,
      universeId: opts.universeId,
      generationId: `rig:meshy:${opts.meshyTaskId}`,
      generationModel: 'meshy-rigging',
      tags: ['character', '3d', 'rigged', 'biped'],
      parentGenerationId: opts.parentGenerationId,
    });
  } catch (error) {
    await refundCreditsAfterReconcile(opts.userId, opts.credits, opts.genId);
    await threeDGenCol()
      .doc(opts.genId)
      .update({
        status: 'failed',
        creditsRefunded: true,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      })
      .catch(() => {});
    console.error(`Meshy rigging ${opts.genId} failed:`, error);
  }
}

async function completeMeshyRemeshTask(opts: {
  genId: string;
  userId: string;
  meshyTaskId: string;
  sourceTitle: string;
  topology: 'quad' | 'triangle';
  targetPolycount: number;
  universeId: string | null;
  parentGenerationId: string | null;
  credits: number;
}) {
  try {
    const { resolveProviderKey } = await import('../../lib/byok');
    const apiKey = await resolveProviderKey(opts.userId, 'meshy');
    const task = await meshyService.waitForRemesh(opts.meshyTaskId, 10 * 60 * 1000, 5000, apiKey);
    const urls = task.modelUrls;
    if (!urls || !REMESH_OUTPUT_FORMATS.some((f) => urls[f])) {
      throw new Error('Meshy remesh completed without any model output');
    }

    // Meshy CDN URLs expire — rehost every requested format + the thumbnail first.
    const perm = await rehostModelBundle(
      {
        modelUrls: { glb: urls.glb, fbx: urls.fbx, obj: urls.obj, usdz: urls.usdz },
        thumbnailUrl: task.thumbnailUrl,
      },
      `${opts.sourceTitle}-remesh`,
      opts.userId
    );

    await threeDGenCol().doc(opts.genId).update({
      status: 'completed',
      modelUrls: perm.modelUrls,
      thumbnailUrl: perm.thumbnailUrl,
      completedAt: new Date(),
    });

    // Gallery publish — GLB is the canonical mesh; skipped if only other formats were requested.
    const glbUrl = perm.modelUrls.glb;
    if (glbUrl) {
      void publishToGallery({
        creatorUid: opts.userId,
        mediaUrl: glbUrl,
        mediaType: '3d',
        title: `${opts.sourceTitle} — remeshed (${opts.topology}, ${opts.targetPolycount.toLocaleString('en-US')} polys)`,
        description: `Retopologized to ~${opts.targetPolycount.toLocaleString('en-US')} ${opts.topology === 'quad' ? 'quads' : 'triangles'}.`,
        thumbnailUrl: perm.thumbnailUrl,
        universeId: opts.universeId,
        generationId: `remesh:meshy:${opts.meshyTaskId}`,
        generationModel: 'meshy-remesh',
        tags: ['3d', 'remesh', opts.topology],
        parentGenerationId: opts.parentGenerationId,
      });
    }
  } catch (error) {
    await refundCreditsAfterReconcile(opts.userId, opts.credits, opts.genId);
    await threeDGenCol()
      .doc(opts.genId)
      .update({
        status: 'failed',
        creditsRefunded: true,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      })
      .catch(() => {});
    console.error(`Meshy remesh ${opts.genId} failed:`, error);
  }
}

async function completeMeshyAnimationTask(opts: {
  genId: string;
  userId: string;
  meshyTaskId: string;
  riggedTitle: string;
  actionRef: string;
  actionName: string;
  universeId: string | null;
  parentGenerationId: string | null;
  credits: number;
}) {
  try {
    const { resolveProviderKey } = await import('../../lib/byok');
    const apiKey = await resolveProviderKey(opts.userId, 'meshy');
    const task = await meshyService.waitForAnimation(
      opts.meshyTaskId,
      15 * 60 * 1000,
      5000,
      apiKey
    );

    if (!task.animationGlbUrl) {
      throw new Error('Meshy animation completed without a GLB output');
    }

    // Meshy CDN URLs expire — rehost the animated GLB + thumbnail first.
    const perm = await rehostModelBundle(
      { modelUrls: { glb: task.animationGlbUrl }, thumbnailUrl: task.thumbnailUrl },
      `${stripRigSuffix(opts.riggedTitle)}-${opts.actionName}`,
      opts.userId
    );
    const glbUrl = perm.modelUrls.glb ?? task.animationGlbUrl;

    await threeDGenCol().doc(opts.genId).update({
      status: 'completed',
      animationGlbUrl: glbUrl,
      thumbnailUrl: perm.thumbnailUrl,
      completedAt: new Date(),
    });

    void publishToGallery({
      creatorUid: opts.userId,
      mediaUrl: glbUrl,
      mediaType: '3d',
      title: `${stripRigSuffix(opts.riggedTitle)} — ${opts.actionName}`,
      description: `${opts.actionName} animation applied to the rigged model.`,
      thumbnailUrl: perm.thumbnailUrl,
      universeId: opts.universeId,
      generationId: `anim:meshy:${opts.meshyTaskId}`,
      generationModel: `meshy-animation:${opts.actionRef}`,
      tags: ['character', '3d', 'animated', opts.actionName.toLowerCase()],
      parentGenerationId: opts.parentGenerationId,
    });
  } catch (error) {
    await refundCreditsAfterReconcile(opts.userId, opts.credits, opts.genId);
    await threeDGenCol()
      .doc(opts.genId)
      .update({
        status: 'failed',
        creditsRefunded: true,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      })
      .catch(() => {});
    console.error(`Meshy animation ${opts.genId} failed:`, error);
  }
}

async function completeTripoRiggingTask(opts: {
  genId: string;
  userId: string;
  tripoRigTaskId: string;
  sourceTitle: string;
  rigType: TripoRigType;
  universeId: string | null;
  parentGenerationId: string | null;
  credits: number;
}) {
  try {
    const { resolveProviderKey } = await import('../../lib/byok');
    const apiKey = await resolveProviderKey(opts.userId, 'tripo').catch(() => undefined);
    const task = await tripo3dService.waitForTask(
      opts.tripoRigTaskId,
      20 * 60 * 1000,
      5000,
      apiKey
    );
    const rawGlbUrl = task.output?.model_url || task.output?.model_urls?.[0];
    if (!rawGlbUrl) {
      throw new Error('Tripo rigging completed without a GLB output');
    }

    // Tripo3D output URLs are signed and expire — rehost before persisting.
    const perm = await rehostModelBundle(
      { modelUrls: { glb: rawGlbUrl } },
      `${opts.sourceTitle}-rigged-${opts.rigType}`,
      opts.userId
    );
    const glbUrl = perm.modelUrls.glb ?? rawGlbUrl;

    await threeDGenCol().doc(opts.genId).update({
      status: 'completed',
      riggedGlbUrl: glbUrl,
      completedAt: new Date(),
    });

    void publishToGallery({
      creatorUid: opts.userId,
      mediaUrl: glbUrl,
      mediaType: '3d',
      title: `${opts.sourceTitle} — rigged (${opts.rigType})`,
      description: `Auto-rigged ${opts.rigType} skeleton via Tripo3D, ready for animation presets.`,
      thumbnailUrl: null,
      universeId: opts.universeId,
      generationId: `rig:tripo:${opts.tripoRigTaskId}`,
      generationModel: 'tripo-rigging',
      tags: ['character', '3d', 'rigged', opts.rigType],
      parentGenerationId: opts.parentGenerationId,
    });
  } catch (error) {
    await refundCreditsAfterReconcile(opts.userId, opts.credits, opts.genId);
    await threeDGenCol()
      .doc(opts.genId)
      .update({
        status: 'failed',
        creditsRefunded: true,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      })
      .catch(() => {});
    console.error(`Tripo rigging ${opts.genId} failed:`, error);
  }
}

async function completeTripoAnimationTask(opts: {
  genId: string;
  userId: string;
  tripoAnimationTaskId: string;
  riggedTitle: string;
  actionRef: string;
  actionName: string;
  universeId: string | null;
  parentGenerationId: string | null;
  credits: number;
}) {
  try {
    const { resolveProviderKey } = await import('../../lib/byok');
    const apiKey = await resolveProviderKey(opts.userId, 'tripo').catch(() => undefined);
    const task = await tripo3dService.waitForTask(
      opts.tripoAnimationTaskId,
      20 * 60 * 1000,
      5000,
      apiKey
    );
    const rawGlbUrl = task.output?.model_url || task.output?.model_urls?.[0];
    if (!rawGlbUrl) {
      throw new Error('Tripo animation completed without a GLB output');
    }

    // Tripo3D output URLs are signed and expire — rehost before persisting.
    const perm = await rehostModelBundle(
      { modelUrls: { glb: rawGlbUrl } },
      `${stripRigSuffix(opts.riggedTitle)}-${opts.actionName}`,
      opts.userId
    );
    const glbUrl = perm.modelUrls.glb ?? rawGlbUrl;

    await threeDGenCol().doc(opts.genId).update({
      status: 'completed',
      animationGlbUrl: glbUrl,
      completedAt: new Date(),
    });

    void publishToGallery({
      creatorUid: opts.userId,
      mediaUrl: glbUrl,
      mediaType: '3d',
      title: `${stripRigSuffix(opts.riggedTitle)} — ${opts.actionName}`,
      description: `${opts.actionName} animation applied via Tripo3D.`,
      thumbnailUrl: null,
      universeId: opts.universeId,
      generationId: `anim:tripo:${opts.tripoAnimationTaskId}`,
      generationModel: `tripo-animation:${opts.actionRef}`,
      tags: ['character', '3d', 'animated', opts.actionName.toLowerCase()],
      parentGenerationId: opts.parentGenerationId,
    });
  } catch (error) {
    await refundCreditsAfterReconcile(opts.userId, opts.credits, opts.genId);
    await threeDGenCol()
      .doc(opts.genId)
      .update({
        status: 'failed',
        creditsRefunded: true,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      })
      .catch(() => {});
    console.error(`Tripo animation ${opts.genId} failed:`, error);
  }
}

const TRIPO_CONVERT_FORMAT: Record<(typeof REMESH_OUTPUT_FORMATS)[number], TripoConvertFormat> = {
  glb: 'GLTF',
  fbx: 'FBX',
  obj: 'OBJ',
  usdz: 'USDZ',
};

function tripoRemeshArgs(
  fileToken: string,
  format: (typeof REMESH_OUTPUT_FORMATS)[number],
  topology: 'quad' | 'triangle',
  targetPolycount: number,
  apiKey: string
) {
  return {
    input: fileToken,
    format: TRIPO_CONVERT_FORMAT[format],
    quad: topology === 'quad',
    faceLimit: targetPolycount,
    apiKey,
  };
}

/**
 * Tripo remesh = one `/models/convert` task per requested format. The first
 * was submitted by the procedure; the rest run here one at a time (Tripo
 * 429s accounts with many tasks in flight).
 */
async function completeTripoRemeshTask(opts: {
  genId: string;
  userId: string;
  apiKey: string;
  fileToken: string;
  firstTask: { format: (typeof REMESH_OUTPUT_FORMATS)[number]; taskId: string };
  remainingFormats: Array<(typeof REMESH_OUTPUT_FORMATS)[number]>;
  sourceTitle: string;
  topology: 'quad' | 'triangle';
  targetPolycount: number;
  universeId: string | null;
  parentGenerationId: string | null;
  credits: number;
}) {
  try {
    const raw: Partial<Record<(typeof REMESH_OUTPUT_FORMATS)[number], string>> = {};
    const taskIds: Record<string, string> = { [opts.firstTask.format]: opts.firstTask.taskId };
    let thumbnailUrl: string | undefined;
    const collect = async (format: (typeof REMESH_OUTPUT_FORMATS)[number], taskId: string) => {
      const task = await tripo3dService.waitForTask(taskId, 10 * 60 * 1000, 5000, opts.apiKey);
      const url = tripoTaskModelUrl(task);
      if (!url) throw new Error(`Tripo3D convert (${format}) finished without a model`);
      raw[format] = url;
      thumbnailUrl ??= task.output?.rendered_image_url;
    };
    await collect(opts.firstTask.format, opts.firstTask.taskId);
    for (const format of opts.remainingFormats) {
      const { taskId } = await tripo3dService.convertModel(
        tripoRemeshArgs(opts.fileToken, format, opts.topology, opts.targetPolycount, opts.apiKey)
      );
      taskIds[format] = taskId;
      await threeDGenCol().doc(opts.genId).update({ tripoTaskIds: taskIds });
      await collect(format, taskId);
    }

    // Tripo output URLs are signed and expire — rehost every format first.
    const perm = await rehostModelBundle(
      { modelUrls: raw, thumbnailUrl },
      `${opts.sourceTitle}-remesh`,
      opts.userId
    );

    await threeDGenCol().doc(opts.genId).update({
      status: 'completed',
      modelUrls: perm.modelUrls,
      thumbnailUrl: perm.thumbnailUrl,
      completedAt: new Date(),
    });

    const glbUrl = perm.modelUrls.glb;
    if (glbUrl) {
      void publishToGallery({
        creatorUid: opts.userId,
        mediaUrl: glbUrl,
        mediaType: '3d',
        title: `${opts.sourceTitle} — remeshed (${opts.topology}, ${opts.targetPolycount.toLocaleString('en-US')} polys)`,
        description: `Retopologized to ~${opts.targetPolycount.toLocaleString('en-US')} ${opts.topology === 'quad' ? 'quads' : 'triangles'} with Tripo3D.`,
        thumbnailUrl: perm.thumbnailUrl,
        universeId: opts.universeId,
        generationId: `remesh:tripo:${opts.firstTask.taskId}`,
        generationModel: 'tripo-remesh',
        tags: ['3d', 'remesh', opts.topology],
        parentGenerationId: opts.parentGenerationId,
      });
    }
  } catch (error) {
    await refundCreditsAfterReconcile(opts.userId, opts.credits, opts.genId);
    await threeDGenCol()
      .doc(opts.genId)
      .update({
        status: 'failed',
        creditsRefunded: true,
        failureReason: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      })
      .catch(() => {});
    console.error(`Tripo remesh ${opts.genId} failed:`, error);
  }
}

function stripRigSuffix(title: string): string {
  return title.replace(/ — rigged(?: \([^)]+\))?$/i, '');
}
