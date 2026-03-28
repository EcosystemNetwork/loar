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
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { meshyService } from '../../services/meshy';
import { trackQuests } from '../../services/quest-tracker';

// ── Pricing ───────────────────────────────────────────────────────────

const FIAT_MARGIN = 1.35;
const LOAR_MARGIN = 1.25;
const LOAR_TO_USD = 0.01;

const COSTS = {
  text_preview: 0.05,
  text_refine: 0.20,
  image_to_3d: 0.15,
};

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

const threeDGenCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('threeDGenerations');
};

// ── Credit helpers ────────────────────────────────────────────────────

async function deductCredits(userId: string, credits: number): Promise<void> {
  const ref = db.collection('userCredits').doc(userId);
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
  const ref = db.collection('userCredits').doc(userId);
  try {
    const doc = await ref.get();
    if (doc.exists) {
      await ref.update({ balance: (doc.data()?.balance || 0) + credits, updatedAt: new Date() });
    }
  } catch (err) {
    console.error(`CRITICAL: 3D credit refund failed for ${userId}:`, err);
  }
}

// ── Router ────────────────────────────────────────────────────────────

const artStyleSchema = z.enum(['realistic', 'cartoon', 'low-poly', 'sculpture', 'pbr']);

export const threedRouter = router({
  // ── Text-to-3D preview ────────────────────────────────────────────────

  textTo3DPreview: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(1000),
        negativePrompt: z.string().optional(),
        artStyle: artStyleSchema.optional(),
        seed: z.number().optional(),
        targetPolycount: z.number().optional(),
        entityId: z.string().optional(),
        universeId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const genId = randomUUID();
      const cost = COSTS.text_preview;
      const credits = toCredits(cost);

      await threeDGenCol().doc(genId).set({
        id: genId,
        userId: ctx.user.uid,
        entityId: input.entityId || null,
        universeId: input.universeId || null,
        type: 'text_preview',
        prompt: input.prompt,
        artStyle: input.artStyle || 'realistic',
        providerCostUsd: cost,
        fiatPriceUsd: withFiat(cost),
        loarPriceUsd: withLoar(cost),
        creditsCharged: credits,
        status: 'queued',
        createdAt: new Date(),
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

        // Poll for completion (max 10 min for preview)
        const task = await meshyService.waitForTask(taskId, 'text-to-3d', 10 * 60 * 1000);

        trackQuests(ctx.user.uid, [{ questId: 'first_3d_generation' }]);

        await threeDGenCol().doc(genId).update({
          status: 'completed',
          meshyTaskId: taskId,
          modelUrls: task.modelUrls,
          thumbnailUrl: task.thumbnailUrl,
          videoUrl: task.videoUrl,
          completedAt: new Date(),
        });

        return {
          generationId: genId,
          status: 'completed' as const,
          meshyTaskId: taskId,
          modelUrls: task.modelUrls,
          thumbnailUrl: task.thumbnailUrl,
          videoUrl: task.videoUrl,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(cost),
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits);
        await threeDGenCol().doc(genId).update({
          status: 'failed',
          failureReason: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
        });
        throw error;
      }
    }),

  // ── Text-to-3D refine ─────────────────────────────────────────────────

  textTo3DRefine: protectedProcedure
    .input(
      z.object({
        previewGenerationId: z.string().min(1), // LOAR generation ID from textTo3DPreview
        textureRichness: z.enum(['high', 'medium', 'low']).optional(),
        entityId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
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
      const credits = toCredits(cost);

      await threeDGenCol().doc(genId).set({
        id: genId,
        userId: ctx.user.uid,
        entityId: input.entityId || previewData.entityId || null,
        type: 'text_refine',
        previewGenerationId: input.previewGenerationId,
        previewMeshyTaskId: previewData.meshyTaskId,
        providerCostUsd: cost,
        fiatPriceUsd: withFiat(cost),
        loarPriceUsd: withLoar(cost),
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

        // Refine can take up to 15 min
        const task = await meshyService.waitForTask(taskId, 'text-to-3d', 15 * 60 * 1000);

        await threeDGenCol().doc(genId).update({
          status: 'completed',
          meshyTaskId: taskId,
          modelUrls: task.modelUrls,
          thumbnailUrl: task.thumbnailUrl,
          videoUrl: task.videoUrl,
          completedAt: new Date(),
        });

        return {
          generationId: genId,
          status: 'completed' as const,
          meshyTaskId: taskId,
          modelUrls: task.modelUrls,
          thumbnailUrl: task.thumbnailUrl,
          videoUrl: task.videoUrl,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(cost),
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits);
        await threeDGenCol().doc(genId).update({
          status: 'failed',
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
      })
    )
    .mutation(async ({ input, ctx }) => {
      const genId = randomUUID();
      const cost = COSTS.image_to_3d;
      const credits = toCredits(cost);
      const isMulti = input.imageUrls.length > 1;

      await threeDGenCol().doc(genId).set({
        id: genId,
        userId: ctx.user.uid,
        entityId: input.entityId || null,
        universeId: input.universeId || null,
        type: isMulti ? 'multi_image_to_3d' : 'image_to_3d',
        imageUrls: input.imageUrls,
        providerCostUsd: cost,
        fiatPriceUsd: withFiat(cost),
        loarPriceUsd: withLoar(cost),
        creditsCharged: credits,
        status: 'queued',
        createdAt: new Date(),
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

        const task = await meshyService.waitForTask(taskId, 'image-to-3d', 15 * 60 * 1000);

        await threeDGenCol().doc(genId).update({
          status: 'completed',
          meshyTaskId: taskId,
          modelUrls: task.modelUrls,
          thumbnailUrl: task.thumbnailUrl,
          videoUrl: task.videoUrl,
          completedAt: new Date(),
        });

        return {
          generationId: genId,
          status: 'completed' as const,
          meshyTaskId: taskId,
          modelUrls: task.modelUrls,
          thumbnailUrl: task.thumbnailUrl,
          videoUrl: task.videoUrl,
          creditsCharged: credits,
          fiatPriceUsd: withFiat(cost),
        };
      } catch (error) {
        await refundCredits(ctx.user.uid, credits);
        await threeDGenCol().doc(genId).update({
          status: 'failed',
          failureReason: error instanceof Error ? error.message : 'Unknown error',
          completedAt: new Date(),
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
    .query(({ input }) => {
      const cost = COSTS[input.type];
      return {
        providerCostUsd: cost,
        fiatPriceUsd: withFiat(cost),
        loarPriceUsd: withLoar(cost),
        credits: toCredits(cost),
      };
    }),
});
