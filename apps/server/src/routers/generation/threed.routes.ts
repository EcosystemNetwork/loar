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
import { router, protectedProcedure, publicProcedure, requirePermission } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { meshyService } from '../../services/meshy';
import { trackQuests } from '../../services/quest-tracker';
import { FieldValue } from 'firebase-admin/firestore';
import { createAttachment } from '../media/media.handlers';
import { logFailedRefund } from '../../lib/refund-audit';
import { publishToGallery } from '../../lib/gallery-publish';
import type { MeshyTaskOutput } from '../../services/meshy';

// ── Pricing — loaded from platform config (admin-configurable) ────────

import { getPlatformConfig } from '../../services/platformConfig';
import { sanitizePrompt } from '../../lib/prompt-sanitize';
import { reserveClientToken } from '../../lib/jobIdempotency';
import { fireJobWebhook, validateWebhookUrl, webhookUrlSchema } from '../../lib/webhooks';
import { TRPCError } from '@trpc/server';

const clientTokenSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'clientToken must match [A-Za-z0-9_-]{16,128}')
  .optional();

const LOAR_TO_USD = 0.01;

const COSTS = {
  text_preview: 0.05,
  text_refine: 0.2,
  image_to_3d: 0.15,
};

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

// ── Credit helpers ────────────────────────────────────────────────────

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

async function completeThreeDTask(opts: {
  genId: string;
  userId: string;
  entityId: string | null;
  meshyTaskId: string;
  meshyTaskType: 'text-to-3d' | 'image-to-3d';
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
    const task = await meshyService.waitForTask(
      opts.meshyTaskId,
      opts.meshyTaskType,
      opts.timeoutMs
    );

    trackQuests(opts.userId, [{ questId: 'first_3d_generation' }]);

    await threeDGenCol().doc(opts.genId).update({
      status: 'completed',
      meshyTaskId: opts.meshyTaskId,
      modelUrls: task.modelUrls,
      thumbnailUrl: task.thumbnailUrl,
      videoUrl: task.videoUrl,
      completedAt: new Date(),
    });

    await autoAttach3DModel({
      creator: opts.userId,
      entityId: opts.entityId,
      generationId: opts.genId,
      modelUrls: task.modelUrls ?? ({} as MeshyTaskOutput),
      thumbnailUrl: task.thumbnailUrl,
      type: opts.generationType,
    });

    // Gallery publish — use GLB as the canonical model URL. Skipped silently
    // if GLB is missing (provider occasionally omits it for failed textures).
    const glbUrl = task.modelUrls?.glb;
    if (glbUrl) {
      const title = opts.prompt?.slice(0, 100) || 'Generated 3D Model';
      void publishToGallery({
        creatorUid: opts.userId,
        mediaUrl: glbUrl,
        mediaType: '3d',
        title,
        description: opts.prompt ?? '',
        thumbnailUrl: task.thumbnailUrl ?? null,
        universeId: opts.universeId ?? null,
        generationId: opts.genId,
        generationModel: `meshy:${opts.generationType}`,
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
        modelUrls: task.modelUrls ?? null,
        thumbnailUrl: task.thumbnailUrl ?? null,
        videoUrl: task.videoUrl ?? null,
        generationType: opts.generationType,
        creditsCharged: opts.credits,
      },
    });
  } catch (error) {
    await refundCredits(opts.userId, opts.credits, opts.genId);
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

  textTo3DPreview: protectedProcedure
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
            meshyTaskId: (d.meshyTaskId ?? null) as string | null,
            creditsCharged: (d.creditsCharged ?? 0) as number,
            fiatPriceUsd: (d.fiatPriceUsd ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      const { fiatMargin, loarMargin } = await getMargins();
      const cost = COSTS.text_preview;
      const credits = toCredits(cost, fiatMargin);

      await threeDGenCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          universeId: input.universeId || null,
          type: 'text_preview',
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

      await deductCredits(ctx.user.uid, credits);

      try {
        await threeDGenCol().doc(genId).update({ status: 'running' });

        const { taskId } = await meshyService.textTo3DPreview({
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          artStyle: input.artStyle,
          seed: input.seed,
          targetPolycount: input.targetPolycount,
        });

        await threeDGenCol().doc(genId).update({ meshyTaskId: taskId });

        // Fire-and-forget: complete in background, client polls via getTask.
        // Webhook fires from completeThreeDTask on terminal state.
        completeThreeDTask({
          genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          meshyTaskId: taskId,
          meshyTaskType: 'text-to-3d',
          generationType: 'text_preview',
          credits,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          timeoutMs: 10 * 60 * 1000,
          prompt: input.prompt,
          universeId: input.universeId || null,
        }).catch((err) => console.error(`Background 3D preview ${genId} error:`, err));

        return {
          generationId: genId,
          status: 'running' as const,
          meshyTaskId: taskId as string | null,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(cost, fiatMargin),
          idempotentReplay: false as const,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, genId);
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

  textTo3DRefine: protectedProcedure
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
      if (previewData.status !== 'completed' || !previewData.meshyTaskId) {
        throw new Error('Preview generation must be completed before refining');
      }

      const genId = randomUUID();
      const cost = COSTS.text_refine;
      const credits = toCredits(cost, fiatMargin);

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

      await deductCredits(ctx.user.uid, credits);

      try {
        await threeDGenCol().doc(genId).update({ status: 'running' });

        const { taskId } = await meshyService.textTo3DRefine({
          previewTaskId: previewData.meshyTaskId,
          textureRichness: input.textureRichness,
        });

        await threeDGenCol().doc(genId).update({ meshyTaskId: taskId });

        // Fire-and-forget: complete in background, client polls via getTask
        completeThreeDTask({
          genId,
          userId: ctx.user.uid,
          entityId: input.entityId || previewData.entityId || null,
          meshyTaskId: taskId,
          meshyTaskType: 'text-to-3d',
          generationType: 'text_refine',
          credits,
          timeoutMs: 15 * 60 * 1000,
          prompt: previewData.prompt ?? null,
          universeId: previewData.universeId ?? null,
          parentGenerationId: input.previewGenerationId,
        }).catch((err) => console.error(`Background 3D refine ${genId} error:`, err));

        return {
          generationId: genId,
          status: 'running' as const,
          meshyTaskId: taskId,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(cost, fiatMargin),
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, genId);
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

  imageTo3D: protectedProcedure
    .input(
      z.object({
        imageUrls: z.array(z.string().url()).min(1).max(4),
        enablePbr: z.boolean().optional().default(true),
        targetPolycount: z.number().optional(),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
        clientToken: clientTokenSchema,
        webhookUrl: webhookUrlSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
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
          procedure: 'threed.imageTo3D',
        });
        if (reservation?.existing) {
          const existingSnap = await threeDGenCol().doc(reservation.existing.jobId).get();
          const d = existingSnap.exists ? (existingSnap.data() as any) : {};
          return {
            generationId: reservation.existing.jobId,
            status: (d.status ?? 'queued') as 'queued' | 'running' | 'completed' | 'failed',
            meshyTaskId: (d.meshyTaskId ?? null) as string | null,
            creditsCharged: (d.creditsCharged ?? 0) as number,
            fiatPriceUsd: (d.fiatPriceUsd ?? 0) as number,
            idempotentReplay: true as const,
          };
        }
      }

      const { fiatMargin, loarMargin } = await getMargins();
      const cost = COSTS.image_to_3d;
      const credits = toCredits(cost, fiatMargin);
      const isMulti = input.imageUrls.length > 1;

      await threeDGenCol()
        .doc(genId)
        .set({
          id: genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          universeId: input.universeId || null,
          type: isMulti ? 'multi_image_to_3d' : 'image_to_3d',
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

      await deductCredits(ctx.user.uid, credits);

      try {
        await threeDGenCol().doc(genId).update({ status: 'running' });

        let taskId: string;
        if (isMulti) {
          const result = await meshyService.multiImageTo3D({
            imageUrls: input.imageUrls,
            enablePbr: input.enablePbr,
            targetPolycount: input.targetPolycount,
          });
          taskId = result.taskId;
        } else {
          const result = await meshyService.imageTo3D({
            imageUrl: input.imageUrls[0],
            enablePbr: input.enablePbr,
            targetPolycount: input.targetPolycount,
          });
          taskId = result.taskId;
        }

        await threeDGenCol().doc(genId).update({ meshyTaskId: taskId });

        // Fire-and-forget: complete in background, client polls via getTask
        completeThreeDTask({
          genId,
          userId: ctx.user.uid,
          entityId: input.entityId || null,
          meshyTaskId: taskId,
          meshyTaskType: 'image-to-3d',
          generationType: isMulti ? 'multi_image_to_3d' : 'image_to_3d',
          credits,
          webhookUrl: validatedWebhookUrl,
          clientToken: input.clientToken,
          timeoutMs: 15 * 60 * 1000,
          universeId: input.universeId || null,
          sourceImageUrl: input.imageUrls[0] ?? null,
        }).catch((err) => console.error(`Background 3D image-to-3d ${genId} error:`, err));

        return {
          generationId: genId,
          status: 'running' as const,
          meshyTaskId: taskId as string | null,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(cost, fiatMargin),
          idempotentReplay: false as const,
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits, genId);
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
      let query = threeDGenCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.entityId) {
        query = threeDGenCol()
          .where('userId', '==', ctx.user.uid)
          .where('entityId', '==', input.entityId)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      }

      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
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
});
