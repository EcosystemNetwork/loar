/**
 * Clip Library Router
 *
 * A per-universe collection of standalone, reusable video clips — distinct
 * from `episodes.clips[]` (which are just the ordered list embedded in one
 * episode doc). A clip lands here when a user:
 *   - merges several clips into one bigger clip (`sourceType: 'merged'`)
 *   - trims a clip down and wants to keep the trimmed result on its own
 *     (`sourceType: 'trimmed'`), separate from just setting `trimStart`/
 *     `trimEnd` on an episode clip in place (which stays free/instant and
 *     doesn't touch this router — see episodes.routes.ts's `clipSchema`)
 *   - imports an outside clip (uploaded file, or an already-hosted URL)
 *     (`sourceType: 'imported'`)
 *
 * Library clips are plain `{ videoUrl, ... }` records — they slot directly
 * into an episode's `clips[]` array (any `nodeId` works; see clipSchema in
 * episodes.routes.ts) via the Episode Studio UI.
 *
 * Merge/trim reuse the exact same ffmpeg trim+concat pipeline that backs
 * `episodes.export` (see services/ffmpeg/clip-pipeline.ts) rather than
 * re-implementing it.
 *
 *   clipLibrary.list           — List a universe's clip library
 *   clipLibrary.importExternal — Register an uploaded/external clip
 *   clipLibrary.merge          — Concat N clips into one new library clip
 *   clipLibrary.trim           — Trim one clip into a new library clip
 *   clipLibrary.renderStatus   — Poll a merge/trim render job
 *   clipLibrary.delete         — Remove a clip from the library
 */
import { router, protectedProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { firebaseStorageService } from '../../services/firebase-storage';
import { isUniverseCollaborator } from '../../lib/safe-admin';

const clipAssetsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('clipAssets');
};

const renderJobsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('clipRenderJobs');
};

// A render input — the fields the ffmpeg pipeline actually needs. Mirrors
// `ClipTrimSpec` in services/ffmpeg/clip-pipeline.ts; kept as a separate
// zod schema here (not imported from episodes.routes.ts's `clipSchema`)
// since a render input has no `nodeId`/`label` of its own.
const renderClipInputSchema = z.object({
  videoUrl: z.string().url(),
  audioUrl: z.string().url().optional(),
  trimStart: z.number().min(0).default(0),
  trimEnd: z.number().min(0).default(0),
});

// ── Credit cost ─────────────────────────────────────────────────────────
// Mirrors episodes.routes.ts's EXPORT_BASE_CREDITS/EXPORT_PER_CLIP_CREDITS —
// a merge/trim render does the same ffmpeg download+normalize+concat work
// as an episode export, just producing a standalone clip instead.
const RENDER_BASE_CREDITS = 3;
const RENDER_PER_CLIP_CREDITS = 1;

async function deductCredits(uid: string, credits: number): Promise<void> {
  if (!db) return;
  const { assertGenerationAllowed } = await import('../../lib/generation-guards');
  await assertGenerationAllowed(uid, credits);
  const ref = db.collection('userCredits').doc(uid);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const balance = doc.exists ? doc.data()?.balance || 0 : 0;
    if (balance < credits) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Insufficient credits. Need ${credits}, have ${balance}.`,
      });
    }
    tx.update(ref, {
      balance: balance - credits,
      totalSpent: (doc.data()?.totalSpent || 0) + credits,
      updatedAt: new Date(),
    });
  });
}

async function refundCredits(uid: string, credits: number): Promise<void> {
  if (!db) return;
  const { FieldValue } = await import('firebase-admin/firestore');
  const ref = db.collection('userCredits').doc(uid);
  await ref.update({
    balance: FieldValue.increment(credits),
    totalSpent: FieldValue.increment(-credits),
    updatedAt: new Date(),
  });
}

async function requireCollaborator(
  universeId: string,
  ctx: { user: { uid: string; address?: string } }
) {
  const allowed = await isUniverseCollaborator(universeId, ctx.user.address ?? ctx.user.uid);
  if (!allowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a collaborator on this universe' });
  }
}

// ── Background render (merge or single-clip trim) ─────────────────────────

async function runClipRender(
  jobId: string,
  clips: z.infer<typeof renderClipInputSchema>[],
  opts: {
    universeId: string;
    ownerId: string;
    label: string;
    sourceType: 'merged' | 'trimmed';
    sourceClipIds?: string[];
  }
) {
  const jobRef = renderJobsCol().doc(jobId);

  try {
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { readFile, unlink, mkdir } = await import('fs/promises');
    const { downloadAndNormalizeClip, concatNormalizedClips } =
      await import('../../services/ffmpeg/clip-pipeline');

    const workDir = join(tmpdir(), `clip-render-${jobId}`);
    await mkdir(workDir, { recursive: true });

    await jobRef.update({ status: 'downloading', progress: 10 });

    const localPaths: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const processedPath = await downloadAndNormalizeClip(clips[i], workDir, i);
      localPaths.push(processedPath);
      const pct = Math.round(10 + (i / clips.length) * 60);
      await jobRef.update({ progress: pct });
    }

    let outputPath: string;
    if (localPaths.length > 1) {
      await jobRef.update({ status: 'concatenating', progress: 75 });
      outputPath = join(workDir, `clip-${jobId}.mp4`);
      await concatNormalizedClips(localPaths, outputPath);
    } else {
      // Single-clip trim — already normalized/trimmed, nothing to concat.
      outputPath = localPaths[0];
    }

    await jobRef.update({ status: 'uploading', progress: 90 });

    const outputBuffer = await readFile(outputPath);
    const storageKey = await firebaseStorageService.upload(
      outputBuffer,
      `clip-${opts.sourceType}-${jobId}-${Date.now()}.mp4`
    );
    const publicUrl = firebaseStorageService.getPublicUrl(storageKey);

    const clipAssetId = randomUUID();
    const now = new Date().toISOString();
    await clipAssetsCol()
      .doc(clipAssetId)
      .set({
        id: clipAssetId,
        universeId: opts.universeId,
        ownerId: opts.ownerId,
        label: opts.label,
        videoUrl: publicUrl,
        storageKey,
        sourceType: opts.sourceType,
        sourceClipIds: opts.sourceClipIds ?? null,
        createdAt: now,
        updatedAt: now,
      });

    await jobRef.update({
      status: 'completed',
      progress: 100,
      outputUrl: publicUrl,
      clipAssetId,
      completedAt: new Date().toISOString(),
    });

    for (const p of localPaths) unlink(p).catch(() => {});
    if (localPaths.length > 1) unlink(outputPath).catch(() => {});
  } catch (err: any) {
    console.error(`[clip-render] Job ${jobId} failed:`, err);
    await jobRef.update({
      status: 'failed',
      error: err.message?.slice(0, 500) || 'Unknown error',
      completedAt: new Date().toISOString(),
    });

    const credits = RENDER_BASE_CREDITS + clips.length * RENDER_PER_CLIP_CREDITS;
    try {
      await refundCredits(opts.ownerId, credits);
    } catch (refundErr) {
      console.error(`[clip-render] Refund failed for ${opts.ownerId}:`, refundErr);
    }
  }
}

export const clipLibraryRouter = router({
  /** List a universe's clip library (merged/trimmed/imported clips). */
  list: protectedProcedure
    .input(z.object({ universeId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      await requireCollaborator(input.universeId, ctx);
      const snap = await clipAssetsCol()
        .where('universeId', '==', input.universeId)
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();
      return snap.docs.map((d) => d.data());
    }),

  /**
   * Register an outside clip — either an already-hosted URL (pasted by the
   * user) or the URL returned by the existing `POST /api/upload` endpoint
   * after a device upload.
   */
  importExternal: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        videoUrl: z.string().url(),
        label: z.string().max(200).default('Imported clip'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireCollaborator(input.universeId, ctx);
      const { validateUploadUrl } = await import('../../lib/url-validator');
      await validateUploadUrl(input.videoUrl);

      const clipAssetId = randomUUID();
      const now = new Date().toISOString();
      await clipAssetsCol().doc(clipAssetId).set({
        id: clipAssetId,
        universeId: input.universeId,
        ownerId: ctx.user.uid,
        label: input.label,
        videoUrl: input.videoUrl,
        storageKey: null,
        sourceType: 'imported',
        sourceClipIds: null,
        createdAt: now,
        updatedAt: now,
      });

      return { id: clipAssetId };
    }),

  /** Concat 2+ clips into one new, persistent library clip. */
  merge: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        clips: z.array(renderClipInputSchema).min(2).max(50),
        sourceClipIds: z.array(z.string()).max(50).optional(),
        label: z.string().max(200).default('Merged clip'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireCollaborator(input.universeId, ctx);

      const credits = RENDER_BASE_CREDITS + input.clips.length * RENDER_PER_CLIP_CREDITS;
      await deductCredits(ctx.user.uid, credits);

      const jobId = randomUUID();
      await renderJobsCol().doc(jobId).set({
        id: jobId,
        universeId: input.universeId,
        userId: ctx.user.uid,
        kind: 'merge',
        status: 'queued',
        progress: 0,
        clipCount: input.clips.length,
        credits,
        createdAt: new Date().toISOString(),
      });

      runClipRender(jobId, input.clips, {
        universeId: input.universeId,
        ownerId: ctx.user.uid,
        label: input.label,
        sourceType: 'merged',
        sourceClipIds: input.sourceClipIds,
      }).catch((err) => console.error(`[clip-render] Uncaught error in job ${jobId}:`, err));

      return { jobId, credits };
    }),

  /** Trim one clip and keep the result as a new, standalone library clip. */
  trim: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        clip: renderClipInputSchema,
        label: z.string().max(200).default('Trimmed clip'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await requireCollaborator(input.universeId, ctx);
      if (input.clip.trimStart <= 0 && input.clip.trimEnd <= 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No trim range set' });
      }

      const credits = RENDER_BASE_CREDITS + RENDER_PER_CLIP_CREDITS;
      await deductCredits(ctx.user.uid, credits);

      const jobId = randomUUID();
      await renderJobsCol().doc(jobId).set({
        id: jobId,
        universeId: input.universeId,
        userId: ctx.user.uid,
        kind: 'trim',
        status: 'queued',
        progress: 0,
        clipCount: 1,
        credits,
        createdAt: new Date().toISOString(),
      });

      runClipRender(jobId, [input.clip], {
        universeId: input.universeId,
        ownerId: ctx.user.uid,
        label: input.label,
        sourceType: 'trimmed',
      }).catch((err) => console.error(`[clip-render] Uncaught error in job ${jobId}:`, err));

      return { jobId, credits };
    }),

  /** Poll a merge/trim render job. Owner-only, same rationale as episodes.exportStatus. */
  renderStatus: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const doc = await renderJobsCol().doc(input.jobId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      const data = doc.data()!;
      if (data.userId && data.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return {
        status: data.status as string,
        progress: data.progress as number,
        outputUrl: data.outputUrl as string | undefined,
        clipAssetId: data.clipAssetId as string | undefined,
        error: data.error as string | undefined,
      };
    }),

  /** Remove a clip from the library. Owner-only. */
  delete: protectedProcedure
    .input(z.object({ clipAssetId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const doc = await clipAssetsCol().doc(input.clipAssetId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      if (doc.data()?.ownerId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await clipAssetsCol().doc(input.clipAssetId).delete();
      return { ok: true };
    }),
});
