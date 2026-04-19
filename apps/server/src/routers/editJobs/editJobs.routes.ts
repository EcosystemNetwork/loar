/**
 * Edit Canvas — tRPC router.
 *
 * Thin asset-scoped + versioned wrapper around the existing `editing`
 * router's FAL-backed models. Owns the non-destructive version chain so
 * gallery/wiki/entity surfaces can surface the current version without
 * losing history.
 *
 * Phase 1 scope: inpaint only (the existing `editing.inpaint` path, wired
 * through `falService.inpaintImage`). More ops light up as registry
 * entries become available.
 */

import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { falService } from '../../services/fal';
import { getStorageManager } from '../../services/storage/manager';
import { getEditingModelById } from '../../services/editing-models';
import { editOpSchema, layerStateSchema, type EditJobRecord } from './editJobs.types';
import {
  appendMaskUpload,
  getJob,
  getOrCreateRootVersion,
  getSession,
  getVersion,
  listJobsByContent,
  listVersionsByContent,
  normalizeLayers,
  openSession,
  promoteJobToVersion,
  saveJob,
  setCurrentVersion as setCurrentVersionHandler,
  updateSession,
} from './editJobs.handlers';

// ── Auth / ownership ────────────────────────────────────────────────────

async function assertContentAccess(
  uid: string,
  contentId: string
): Promise<FirebaseFirestore.DocumentData> {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  const doc = await db.collection('content').doc(contentId).get();
  if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Content not found' });
  const data = doc.data()!;
  if (data.creatorUid !== uid) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to edit this asset' });
  }
  const status = data.contentStatus ?? 'active';
  if (
    status === 'flagged' ||
    status === 'under_review' ||
    status === 'hidden' ||
    status === 'removed'
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This asset cannot be edited while it is under moderation review.',
    });
  }
  return data;
}

async function assertSessionOwner(uid: string, sessionId: string) {
  const session = await getSession(sessionId);
  if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Edit session not found' });
  if (session.userId !== uid)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Session belongs to another user' });
  return session;
}

// ── Credits (mirrors editing.routes.ts pattern) ─────────────────────────

async function deductCredits(uid: string, cost: number, op: string) {
  if (!db) return;
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(uid, cost);
  const userRef = db.collection('userCredits').doc(uid);
  await db.runTransaction(async (tx) => {
    const userDoc = await tx.get(userRef);
    const balance = userDoc.data()?.balance || 0;
    if (balance < cost) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Insufficient credits. Need ${cost}, have ${balance}.`,
      });
    }
    tx.update(userRef, {
      balance: balance - cost,
      totalSpent: (userDoc.data()?.totalSpent || 0) + cost,
      updatedAt: new Date(),
    });
    const txRef = db.collection('creditTransactions').doc();
    tx.set(txRef, {
      uid,
      type: 'spend',
      generationType: `editCanvas_${op}`,
      credits: -cost,
      source: 'editCanvas',
      createdAt: new Date(),
    });
  });
}

async function refundCredits(uid: string, cost: number) {
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
    console.error(`[editJobs refund] Failed to refund ${cost} to ${uid}:`, err);
  }
}

// ── Throttle ────────────────────────────────────────────────────────────

const lastOpByUser = new Map<string, number>();
function throttle(uid: string, minMs = 2_000) {
  const now = Date.now();
  const last = lastOpByUser.get(uid);
  if (last && now - last < minMs) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Please wait before submitting another edit.',
    });
  }
  lastOpByUser.set(uid, now);
}
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [k, v] of lastOpByUser) if (v < cutoff) lastOpByUser.delete(k);
}, 5 * 60_000);

// ── Router ──────────────────────────────────────────────────────────────

export const editJobsRouter = router({
  /**
   * Open an edit session against an asset. Creates a v1 assetVersions doc
   * the first time a legacy content doc is opened in the canvas.
   */
  openSession: protectedProcedure
    .input(
      z.object({
        contentId: z.string().min(1),
        baseVersionId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertContentAccess(ctx.user.uid, input.contentId);
      const base = input.baseVersionId
        ? await getVersion(input.baseVersionId)
        : await getOrCreateRootVersion(input.contentId, ctx.user.uid);
      if (!base) throw new TRPCError({ code: 'NOT_FOUND', message: 'Base version not found' });
      if (base.contentId !== input.contentId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Version does not belong to asset' });
      }

      const session = await openSession({
        contentId: input.contentId,
        baseVersionId: base.id,
        userUid: ctx.user.uid,
      });

      return {
        sessionId: session.id,
        baseVersion: base,
      };
    }),

  /** Persist client-side canvas state (layers, aspect) so reload is safe. */
  saveSessionState: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        layers: z.array(layerStateSchema).max(16).optional(),
        aspectRatio: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await assertSessionOwner(ctx.user.uid, input.sessionId);
      const patch: Record<string, unknown> = {};
      if (input.layers) patch.layers = normalizeLayers(input.layers);
      if (typeof input.aspectRatio !== 'undefined') patch.aspectRatio = input.aspectRatio;
      await updateSession(session.id, patch as any);
      return { ok: true, lastSavedAt: new Date() };
    }),

  /**
   * Upload a mask PNG (base64-encoded) to storage and attach it to the
   * session. The returned `maskId` is referenced by `create(ops[].maskId)`.
   */
  uploadMask: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        pngBase64: z.string().min(8),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await assertSessionOwner(ctx.user.uid, input.sessionId);
      throttle(ctx.user.uid, 500);

      const stripped = input.pngBase64.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(stripped, 'base64');
      if (buffer.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Empty mask payload' });
      }
      if (buffer.length > 5 * 1024 * 1024) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mask larger than 5MB' });
      }

      const filename = `mask-${session.id}-${Date.now()}.png`;
      const manifest = await getStorageManager().upload(
        buffer,
        filename,
        'image/png',
        ctx.user.uid
      );
      const url = manifest.uploads[0]?.url;
      if (!url)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Mask upload failed' });

      const maskId = randomUUID();
      await appendMaskUpload(session.id, { id: maskId, contentHash: manifest.contentHash, url });

      return { maskId, url, contentHash: manifest.contentHash };
    }),

  /** Dispatch an edit job. Phase 1: one op per job (inpaint only). */
  create: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        ops: z.array(editOpSchema).min(1).max(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await assertSessionOwner(ctx.user.uid, input.sessionId);
      await assertContentAccess(ctx.user.uid, session.contentId);
      throttle(ctx.user.uid);

      const baseVersion = session.baseVersionId ? await getVersion(session.baseVersionId) : null;
      if (!baseVersion) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Session has no base version' });
      }

      const op = input.ops[0];
      const jobId = randomUUID();

      if (op.kind !== 'inpaint') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only inpaint ops are supported in Phase 1',
        });
      }

      const model = getEditingModelById(op.modelId);
      if (!model || model.operation !== 'inpaint') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid inpaint model' });
      }

      const mask = (session.maskUploads || []).find((m) => m.id === op.maskId);
      if (!mask) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Mask not found on session — upload it first',
        });
      }

      if (op.mode === 'replace' && !op.prompt.trim()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Replace mode requires a prompt describing what to fill in.',
        });
      }

      await deductCredits(ctx.user.uid, model.creditCost, 'inpaint');
      const startTime = Date.now();

      // Compose prompts exactly like the existing editing router so behavior
      // is consistent across /editor and /studio/edit.
      const { prompt, negativePrompt } = composeInpaintPrompt(op.mode, op.prompt);
      const finalNegative = op.negativePrompt
        ? `${negativePrompt}, ${op.negativePrompt}`
        : negativePrompt;

      let record: EditJobRecord = {
        id: jobId,
        userId: ctx.user.uid,
        status: 'running',
        operation: 'inpaint',
        modelId: model.id,
        contentId: session.contentId,
        sessionId: session.id,
        baseVersionId: baseVersion.id,
        resultVersionId: null,
        inputUrl: baseVersion.mediaUrl,
        outputUrl: null,
        prompt: op.prompt,
        negativePrompt: op.negativePrompt ?? null,
        maskUrl: mask.url,
        seed: op.seed ?? null,
        providerCostUsd: 0,
        creditsCharged: 0,
        latencyMs: null,
        failureReason: null,
        opsPlan: input.ops,
        aspectRatio: session.aspectRatio,
        createdAt: new Date(),
        completedAt: null,
      };
      await saveJob(record);

      const result = await falService.inpaintImage({
        imageUrl: baseVersion.mediaUrl,
        maskUrl: mask.url,
        prompt,
        model: model.falModelId,
        negativePrompt: finalNegative,
        seed: op.seed,
        strength: op.strength,
        guidanceScale: op.guidanceScale,
      });

      if (result.status === 'failed' || !result.imageUrl) {
        await refundCredits(ctx.user.uid, model.creditCost);
        record = {
          ...record,
          status: 'failed',
          failureReason: result.error || 'Inpaint failed',
          completedAt: new Date(),
          latencyMs: Date.now() - startTime,
        };
        await saveJob(record);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error || 'Inpaint failed',
        });
      }

      record = {
        ...record,
        status: 'completed',
        outputUrl: result.imageUrl,
        seed: result.seed ?? op.seed ?? null,
        providerCostUsd: model.providerCostUsd,
        creditsCharged: model.creditCost,
        latencyMs: Date.now() - startTime,
        completedAt: new Date(),
      };
      await saveJob(record);

      return {
        jobId,
        status: 'completed' as const,
        outputUrl: result.imageUrl,
        model: model.displayName,
      };
    }),

  /** Read a job by id (polling). */
  get: protectedProcedure.input(z.object({ jobId: z.string() })).query(async ({ ctx, input }) => {
    const job = await getJob(input.jobId);
    if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
    if (job.userId !== ctx.user.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed' });
    }
    return job;
  }),

  /** Edit-history for an asset, newest first. */
  listByContent: publicProcedure
    .input(
      z.object({
        contentId: z.string(),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      return listJobsByContent(input.contentId, input.limit, input.cursor);
    }),

  /**
   * Promote a completed job to a new version and flip `isCurrent`. This is
   * what the user hits after reviewing the preview inside the canvas.
   */
  submit: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        jobId: z.string(),
        label: z.string().max(80).optional(),
        rightsDeclaration: z.enum(['fan', 'original', 'licensed']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await assertSessionOwner(ctx.user.uid, input.sessionId);
      await assertContentAccess(ctx.user.uid, session.contentId);

      const job = await getJob(input.jobId);
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
      if (job.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not allowed to submit this job' });
      }
      if (job.status !== 'completed' || !job.outputUrl) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Job must complete before it can be submitted as a version.',
        });
      }
      if (job.resultVersionId) {
        const existing = await getVersion(job.resultVersionId);
        if (existing)
          return {
            versionId: existing.id,
            versionNumber: existing.versionNumber,
            mediaUrl: existing.mediaUrl,
          };
      }

      const version = await promoteJobToVersion({
        job,
        label: input.label ?? '',
        userUid: ctx.user.uid,
        rightsDeclarationOverride: input.rightsDeclaration ?? null,
      });

      return {
        versionId: version.id,
        versionNumber: version.versionNumber,
        mediaUrl: version.mediaUrl,
      };
    }),

  /** Version chain for an asset. */
  listVersions: publicProcedure
    .input(z.object({ contentId: z.string() }))
    .query(async ({ input }) => {
      const versions = await listVersionsByContent(input.contentId);
      const current = versions.find((v) => v.isCurrent) ?? null;
      return {
        versions,
        currentVersionId: current?.id ?? null,
        rootVersionId:
          current?.rootVersionId ?? versions[versions.length - 1]?.rootVersionId ?? null,
      };
    }),

  /** Fast-forward / revert. Non-destructive — just flips `isCurrent`. */
  setCurrentVersion: protectedProcedure
    .input(z.object({ contentId: z.string(), versionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertContentAccess(ctx.user.uid, input.contentId);
      await setCurrentVersionHandler(input.contentId, input.versionId);
      return { ok: true };
    }),
});

// ── Prompt composition (mirrors editing.routes.ts) ─────────────────────

const UNIVERSAL_NEGATIVE =
  'blurry, low quality, watermark, jpeg artifacts, extra limbs, deformed, seams, halo';

function composeInpaintPrompt(
  mode: 'replace' | 'remove' | 'add' | 'fix',
  userPrompt: string
): { prompt: string; negativePrompt: string } {
  const trimmed = (userPrompt || '').trim();
  switch (mode) {
    case 'remove':
      return {
        prompt: trimmed
          ? `clean background, seamless fill matching surroundings, ${trimmed}, photorealistic, no object, empty space`
          : 'clean background, seamless fill matching surroundings, photorealistic, no object, empty space',
        negativePrompt: `${UNIVERSAL_NEGATIVE}, any object, figure, text, logo, character`,
      };
    case 'add':
      return {
        prompt: trimmed
          ? `${trimmed}, seamlessly integrated, matching lighting and perspective, photorealistic detail`
          : 'new object, seamlessly integrated, matching lighting and perspective',
        negativePrompt: UNIVERSAL_NEGATIVE,
      };
    case 'fix':
      return {
        prompt: trimmed
          ? `${trimmed}, highly detailed, anatomically correct, sharp focus, high quality`
          : 'highly detailed, anatomically correct, sharp focus, high quality, natural proportions',
        negativePrompt: `${UNIVERSAL_NEGATIVE}, malformed, mutated, bad anatomy, bad hands, extra fingers, fused fingers, disfigured`,
      };
    case 'replace':
    default:
      return { prompt: trimmed, negativePrompt: UNIVERSAL_NEGATIVE };
  }
}
