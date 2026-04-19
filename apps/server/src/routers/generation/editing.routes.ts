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
} from '../../services/editing-models';
import { FieldValue } from 'firebase-admin/firestore';

// ── Collections ─────────────────────────────────────────────────────────

const editingJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('editingJobs');
};

// ── Credit helpers (same pattern as generation router) ──────────────────

async function deductCredits(uid: string, cost: number, operation: string): Promise<void> {
  if (!db) return;
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(uid, cost);
  const userRef = db.collection('userCredits').doc(uid);

  await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    const balance = userDoc.data()?.balance || 0;

    if (balance < cost) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Insufficient credits. Need ${cost}, have ${balance}. Purchase more credits to continue.`,
      });
    }

    transaction.update(userRef, {
      balance: balance - cost,
      totalSpent: (userDoc.data()?.totalSpent || 0) + cost,
      updatedAt: new Date(),
    });

    const txRef = db.collection('creditTransactions').doc();
    transaction.set(txRef, {
      uid,
      type: 'spend',
      generationType: `editing_${operation}`,
      credits: -cost,
      source: 'editing',
      createdAt: new Date(),
    });
  });
}

async function refundCredits(uid: string, cost: number): Promise<void> {
  if (!db) return;
  try {
    await db
      .collection('userCredits')
      .doc(uid)
      .update({
        balance: FieldValue.increment(cost),
        totalSpent: FieldValue.increment(-cost),
        updatedAt: new Date(),
      });
  } catch (err) {
    console.error(`[editing refund] Failed to refund ${cost} to ${uid}:`, err);
  }
}

async function saveJobRecord(record: EditingJobRecord): Promise<void> {
  await editingJobsCol()
    .doc(record.id)
    .set({ ...record, createdAt: record.createdAt, completedAt: record.completedAt || null });
}

// ── Throttle ────────────────────────────────────────────────────────────

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
]);

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
        prompt: z.string().optional(),
        scale: z.number().min(2).max(4).default(4),
        sourceGenerationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'upscale') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid upscale model' });
      }

      const jobId = randomUUID();
      await deductCredits(ctx.user.uid, model.creditCost, 'upscale');

      const startTime = Date.now();
      const result = await falService.upscaleImage({
        imageUrl: input.imageUrl,
        model: model.falModelId,
        prompt: input.prompt,
        scale: input.scale,
      });

      if (result.status === 'failed' || !result.imageUrl) {
        await refundCredits(ctx.user.uid, model.creditCost);
        const record: EditingJobRecord = {
          id: jobId,
          userId: ctx.user.uid,
          operation: 'upscale',
          modelId: model.id,
          status: 'failed',
          inputUrl: input.imageUrl,
          providerCostUsd: 0,
          creditsCharged: 0,
          failureReason: result.error || 'Upscale failed',
          createdAt: new Date(),
          completedAt: new Date(),
          sourceGenerationId: input.sourceGenerationId,
        };
        saveJobRecord(record).catch(console.error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Upscale failed',
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

      return { jobId, imageUrl: result.imageUrl, model: model.displayName };
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
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'interpolate') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid interpolation model' });
      }

      const jobId = randomUUID();
      await deductCredits(ctx.user.uid, model.creditCost, 'interpolate');

      const startTime = Date.now();
      const result = await falService.interpolateFrames({
        videoUrl: input.videoUrl,
        model: model.falModelId,
        multiplier: input.multiplier,
      });

      if (result.status === 'failed' || !result.videoUrl) {
        await refundCredits(ctx.user.uid, model.creditCost);
        const record: EditingJobRecord = {
          id: jobId,
          userId: ctx.user.uid,
          operation: 'interpolate',
          modelId: model.id,
          status: 'failed',
          inputUrl: input.videoUrl,
          providerCostUsd: 0,
          creditsCharged: 0,
          failureReason: result.error || 'Interpolation failed',
          createdAt: new Date(),
          completedAt: new Date(),
          sourceGenerationId: input.sourceGenerationId,
        };
        saveJobRecord(record).catch(console.error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Interpolation failed',
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

      return { jobId, videoUrl: result.videoUrl, model: model.displayName };
    }),

  // ── Video-to-Video Restyle ──────────────────────────────────────────

  restyle: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        prompt: z.string().min(1, 'Describe the new style'),
        modelId: z.string().default('restyle-wan-v2v'),
        strength: z.number().min(0).max(1).default(0.65),
        negativePrompt: z.string().optional(),
        sourceGenerationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'restyle') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid restyle model' });
      }

      const jobId = randomUUID();
      await deductCredits(ctx.user.uid, model.creditCost, 'restyle');

      const startTime = Date.now();
      const result = await falService.restyleVideo({
        videoUrl: input.videoUrl,
        prompt: input.prompt,
        model: model.falModelId,
        strength: input.strength,
        negativePrompt: input.negativePrompt,
      });

      if (result.status === 'failed' || !result.videoUrl) {
        await refundCredits(ctx.user.uid, model.creditCost);
        const record: EditingJobRecord = {
          id: jobId,
          userId: ctx.user.uid,
          operation: 'restyle',
          modelId: model.id,
          status: 'failed',
          inputUrl: input.videoUrl,
          prompt: input.prompt,
          providerCostUsd: 0,
          creditsCharged: 0,
          failureReason: result.error || 'Restyle failed',
          createdAt: new Date(),
          completedAt: new Date(),
          sourceGenerationId: input.sourceGenerationId,
        };
        saveJobRecord(record).catch(console.error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Restyle failed',
        });
      }

      const record: EditingJobRecord = {
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
      };
      saveJobRecord(record).catch(console.error);

      return { jobId, videoUrl: result.videoUrl, model: model.displayName };
    }),

  // ── Inpainting ──────────────────────────────────────────────────────

  inpaint: protectedProcedure
    .input(
      z.object({
        imageUrl: z.string().url(),
        maskUrl: z.string().url(),
        prompt: z.string().min(1, 'Describe what to fill in'),
        modelId: z.string().default('inpaint-flux'),
        negativePrompt: z.string().optional(),
        sourceGenerationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'inpaint') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid inpaint model' });
      }

      const jobId = randomUUID();
      await deductCredits(ctx.user.uid, model.creditCost, 'inpaint');

      const startTime = Date.now();
      const result = await falService.inpaintImage({
        imageUrl: input.imageUrl,
        maskUrl: input.maskUrl,
        prompt: input.prompt,
        model: model.falModelId,
        negativePrompt: input.negativePrompt,
      });

      if (result.status === 'failed' || !result.imageUrl) {
        await refundCredits(ctx.user.uid, model.creditCost);
        const record: EditingJobRecord = {
          id: jobId,
          userId: ctx.user.uid,
          operation: 'inpaint',
          modelId: model.id,
          status: 'failed',
          inputUrl: input.imageUrl,
          maskUrl: input.maskUrl,
          prompt: input.prompt,
          providerCostUsd: 0,
          creditsCharged: 0,
          failureReason: result.error || 'Inpaint failed',
          createdAt: new Date(),
          completedAt: new Date(),
          sourceGenerationId: input.sourceGenerationId,
        };
        saveJobRecord(record).catch(console.error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Inpaint failed',
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
        providerCostUsd: model.providerCostUsd,
        creditsCharged: model.creditCost,
        latencyMs: Date.now() - startTime,
        createdAt: new Date(),
        completedAt: new Date(),
        sourceGenerationId: input.sourceGenerationId,
      };
      saveJobRecord(record).catch(console.error);

      return { jobId, imageUrl: result.imageUrl, model: model.displayName };
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
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'remove_bg') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid background removal model' });
      }

      const jobId = randomUUID();
      await deductCredits(ctx.user.uid, model.creditCost, 'remove_bg');

      const startTime = Date.now();
      const result = await falService.removeBackground({
        imageUrl: input.imageUrl,
        model: model.falModelId,
      });

      if (result.status === 'failed' || !result.imageUrl) {
        await refundCredits(ctx.user.uid, model.creditCost);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Background removal failed',
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

      return { jobId, imageUrl: result.imageUrl, model: model.displayName };
    }),

  // ── Video Extension ─────────────────────────────────────────────────

  extend: protectedProcedure
    .input(
      z.object({
        videoUrl: z.string().url(),
        prompt: z.string().min(1, 'Describe what happens next'),
        durationSec: z.number().min(2).max(10).default(5),
        modelId: z.string().default('extend-wan'),
        sourceGenerationId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      checkEditThrottle(ctx.user.uid);

      const model = getEditingModelById(input.modelId);
      if (!model || model.operation !== 'extend') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid extend model' });
      }

      const jobId = randomUUID();
      await deductCredits(ctx.user.uid, model.creditCost, 'extend');

      // Extract last frame from the video using ffmpeg, then use image-to-video
      const startTime = Date.now();

      let lastFrameUrl = input.videoUrl;
      try {
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
          ['-y', '-sseof', '-0.5', '-i', input.videoUrl, '-frames:v', '1', '-q:v', '2', outPath],
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
      const result = await falService.generateVideo({
        prompt: input.prompt,
        model: model.falModelId as any,
        imageUrl: lastFrameUrl,
        duration: input.durationSec,
      });

      if (result.status === 'failed' || !result.videoUrl) {
        await refundCredits(ctx.user.uid, model.creditCost);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Video extension failed',
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

      return { jobId, videoUrl: result.videoUrl, model: model.displayName };
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
