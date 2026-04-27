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
import { getStorageManager } from '../../services/storage/manager';
import { getEditingModelById } from '../../services/editing-models';
import { editOpSchema, layerStateSchema, type EditJobRecord, type EditOp } from './editJobs.types';
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
  setCapturedFrame,
  setCurrentVersion as setCurrentVersionHandler,
  updateSession,
} from './editJobs.handlers';
import {
  dispatchInpaint,
  dispatchOutpaint,
  dispatchRelight,
  dispatchRetexture,
  getOutpaintCreditCost,
} from './dispatchers';

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
// In-process throttle (L15). Same caveat as editing.routes.ts: on horizontal
// deployments the authoritative guard is the spend-cap in generation-guards;
// this map only guards against accidental double-clicks from the canvas UI.

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
      // H9: reject before we decode. base64 is ~4/3× the raw bytes, so a 5MB
      // limit on decoded mask ⇒ ~7.0MB of encoded string. Giving a tiny bit of
      // headroom (8MB) to accommodate padding + whitespace without over-rejecting.
      if (stripped.length > 8 * 1024 * 1024) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Mask larger than 5MB' });
      }
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

  /**
   * Capture a still from a video asset into the session so the user can edit
   * a single frame. The frame is uploaded to storage and its URL becomes the
   * working surface for image-based ops until cleared or replaced.
   */
  captureFrame: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        /** data: URL (image/jpeg or image/png) */
        frameDataUrl: z.string().min(32),
        /** seconds offset in the source video */
        time: z.number().min(0).default(0),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await assertSessionOwner(ctx.user.uid, input.sessionId);
      const match = /^data:(image\/(?:jpeg|png));base64,(.+)$/i.exec(input.frameDataUrl);
      if (!match) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'frameDataUrl must be a JPEG/PNG data URL',
        });
      }
      const mime = match[1];
      // H9-style pre-decode guard: 15MB raw cap ⇒ ~20MB base64 payload.
      if (match[2].length > 22 * 1024 * 1024) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Frame exceeds 15MB' });
      }
      const buffer = Buffer.from(match[2], 'base64');
      if (buffer.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Empty frame payload' });
      }
      if (buffer.length > 15 * 1024 * 1024) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Frame exceeds 15MB' });
      }
      const filename = `frame-${session.id}-${Date.now()}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`;
      const manifest = await getStorageManager().upload(buffer, filename, mime, ctx.user.uid);
      const url = manifest.uploads[0]?.url;
      if (!url)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Frame upload failed' });

      await setCapturedFrame(session.id, { url, time: input.time });

      return { url, time: input.time };
    }),

  /** Clear the captured frame (go back to editing the source). */
  clearCapturedFrame: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await assertSessionOwner(ctx.user.uid, input.sessionId);
      await setCapturedFrame(session.id, null);
      return { ok: true };
    }),

  /**
   * Dispatch an edit job. One op per job. Routes to the right service per
   * op kind (inpaint/outpaint/relight/retexture).
   */
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

      // Image-based ops run against the captured frame when the base is video.
      const baseIsVideo = baseVersion.mediaType === 'video' || baseVersion.mediaType === 'ai-video';
      const workingUrl = session.capturedFrameUrl ?? baseVersion.mediaUrl;
      if (baseIsVideo && !session.capturedFrameUrl) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Capture a frame from the video before running an edit.',
        });
      }

      // Resolve credit cost + operation label for persistence before dispatch.
      const { creditCost, operation } = resolveOpCostAndLabel(op);
      await deductCredits(ctx.user.uid, creditCost, operation);
      const startTime = Date.now();

      let record: EditJobRecord = {
        id: jobId,
        userId: ctx.user.uid,
        status: 'running',
        operation,
        modelId: 'modelId' in op ? op.modelId : 'nano-banana-pro-preview',
        contentId: session.contentId,
        sessionId: session.id,
        baseVersionId: baseVersion.id,
        resultVersionId: null,
        inputUrl: workingUrl,
        outputUrl: null,
        prompt: 'prompt' in op ? (op.prompt ?? null) : null,
        negativePrompt: 'negativePrompt' in op ? (op.negativePrompt ?? null) : null,
        maskUrl: null,
        seed: 'seed' in op && typeof op.seed === 'number' ? op.seed : null,
        providerCostUsd: 0,
        creditsCharged: 0,
        latencyMs: null,
        failureReason: null,
        opsPlan: input.ops,
        aspectRatio: op.kind === 'outpaint' ? op.targetAspect : session.aspectRatio,
        createdAt: new Date(),
        completedAt: null,
      };
      await saveJob(record);

      const result = await runDispatcher(op, {
        session,
        workingUrl,
        userId: ctx.user.uid,
        jobId,
        creditCost,
      });

      if (result.status !== 'ok') {
        await refundCredits(ctx.user.uid, result.creditsToRefund);
        record = {
          ...record,
          status: 'failed',
          failureReason: result.error,
          completedAt: new Date(),
          latencyMs: Date.now() - startTime,
        };
        await saveJob(record);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: result.error,
        });
      }

      record = {
        ...record,
        status: 'completed',
        modelId: result.modelId,
        outputUrl: result.outputUrl,
        prompt: result.prompt,
        negativePrompt: result.negativePrompt,
        maskUrl: result.maskUrl,
        seed: result.seed,
        providerCostUsd: result.providerCostUsd,
        creditsCharged: result.creditsCharged,
        latencyMs: Date.now() - startTime,
        completedAt: new Date(),
      };
      await saveJob(record);

      return {
        jobId,
        status: 'completed' as const,
        outputUrl: result.outputUrl,
        model: result.modelDisplayName,
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

// ── Op routing helpers ─────────────────────────────────────────────────

type OpOperationLabel = EditJobRecord['operation'];

function resolveOpCostAndLabel(op: EditOp): {
  creditCost: number;
  operation: OpOperationLabel;
} {
  switch (op.kind) {
    case 'inpaint': {
      const model = getEditingModelById(op.modelId);
      if (!model || model.operation !== 'inpaint')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid inpaint model' });
      return { creditCost: model.creditCost, operation: 'inpaint' };
    }
    case 'outpaint': {
      return { creditCost: getOutpaintCreditCost(), operation: 'outpaint' };
    }
    case 'relight': {
      const model = getEditingModelById(op.modelId);
      if (!model || model.operation !== 'relight')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid relight model' });
      return { creditCost: model.creditCost, operation: 'relight' };
    }
    case 'retexture': {
      const model = getEditingModelById(op.modelId);
      if (!model || model.operation !== 'retexture')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid retexture model' });
      return { creditCost: model.creditCost, operation: 'retexture' };
    }
  }
}

async function runDispatcher(
  op: EditOp,
  ctx: {
    session: { id: string; maskUploads: Array<{ id: string; url: string }> };
    workingUrl: string;
    userId: string;
    jobId: string;
    creditCost: number;
  }
) {
  switch (op.kind) {
    case 'inpaint': {
      const mask = ctx.session.maskUploads.find((m) => m.id === op.maskId);
      if (!mask) {
        return {
          status: 'error' as const,
          error: 'Mask not found on session — upload it first',
          creditsToRefund: ctx.creditCost,
        };
      }
      if (op.mode === 'replace' && !op.prompt.trim()) {
        return {
          status: 'error' as const,
          error: 'Replace mode requires a prompt describing what to fill in.',
          creditsToRefund: ctx.creditCost,
        };
      }
      return dispatchInpaint({
        op,
        inputUrl: ctx.workingUrl,
        maskUrl: mask.url,
        userId: ctx.userId,
        creditCost: ctx.creditCost,
      });
    }
    case 'outpaint':
      return dispatchOutpaint({
        op,
        inputUrl: ctx.workingUrl,
        userId: ctx.userId,
        jobId: ctx.jobId,
        creditCost: ctx.creditCost,
      });
    case 'relight': {
      let tonePack = null;
      if (op.tonePackId && db) {
        try {
          const packDoc = await db.collection('universeTonePacks').doc(op.tonePackId).get();
          if (packDoc.exists) {
            const data = packDoc.data()!;
            tonePack = {
              presetIds: Array.isArray(data.presetIds) ? data.presetIds : [],
              customPromptFragment: data.customPromptFragment,
              customNegativeFragment: data.customNegativeFragment,
            };
          }
        } catch (err) {
          console.warn('[editJobs relight] tone pack load failed:', err);
        }
      }
      return dispatchRelight({
        op,
        inputUrl: ctx.workingUrl,
        userId: ctx.userId,
        tonePack,
        creditCost: ctx.creditCost,
      });
    }
    case 'retexture':
      return dispatchRetexture({
        op,
        inputUrl: ctx.workingUrl,
        userId: ctx.userId,
        creditCost: ctx.creditCost,
      });
  }
}
