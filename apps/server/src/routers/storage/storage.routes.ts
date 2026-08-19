/**
 * Storage router — tRPC procedures for uploading files to the unified
 * decentralized storage layer (Pinata/IPFS, Lighthouse, Firebase) and
 * resolving content hashes to URLs. Supports sync and async uploads.
 * Includes cost ledger queries (PRD 9).
 */
import { adminProcedure, protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { getStorageManager } from '../../services/storage';
import { getUploadQueue } from '../../lib/queue';
import { getCostLedger } from '../../services/storage/cost-ledger';
import type { StorageManifest } from '../../services/storage';

function ownsManifest(manifest: StorageManifest, userId: string): boolean {
  return !!manifest.ownerIds?.includes(userId);
}

async function serializeUploadJob(job: any) {
  const state = await job.getState();
  return {
    id: job.id,
    userId: job.data.userId,
    status:
      state === 'completed'
        ? 'completed'
        : state === 'failed'
          ? 'failed'
          : state === 'active'
            ? 'uploading'
            : 'pending',
    progress: typeof job.progress === 'number' ? job.progress : 0,
    filename: job.data.filename,
    mimeType: job.data.mimeType || 'application/octet-stream',
    sourceUrl: job.data.videoUrl,
    manifest: job.returnvalue?.manifest,
    error: job.failedReason || undefined,
    createdAt: job.timestamp,
    updatedAt: job.finishedOn || job.processedOn || job.timestamp,
    retryCount: job.attemptsMade,
  };
}

export const storageRouter = router({
  /** Upload a file from URL via the unified StorageManager. Returns manifest immediately. */
  upload: protectedProcedure
    .input(
      z.object({
        url: z.string().url('A valid URL is required'),
        filename: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }): Promise<StorageManifest> => {
      const manager = getStorageManager();
      const manifest = await manager.uploadFromUrl(input.url, input.filename, ctx.user.uid);
      return manifest;
    }),

  /** Upload base64-encoded data directly via tRPC (for smaller files). */
  uploadDirect: protectedProcedure
    .input(
      z.object({
        data: z.string().min(1, 'Data is required'), // base64-encoded
        filename: z.string(),
        mimeType: z.string(),
      })
    )
    .mutation(async ({ input, ctx }): Promise<StorageManifest> => {
      const buffer = Buffer.from(input.data, 'base64');

      if (buffer.length > 10 * 1024 * 1024) {
        throw new Error(
          'File too large for tRPC upload (max 10MB). Use /api/upload for larger files.'
        );
      }

      const manager = getStorageManager();
      return manager.upload(buffer, input.filename, input.mimeType, ctx.user.uid);
    }),

  /** Resolve a contentHash to the best available URL. */
  resolve: publicProcedure.input(z.object({ contentHash: z.string() })).query(async ({ input }) => {
    const manager = getStorageManager();
    const url = await manager.resolve(input.contentHash);
    return { url };
  }),

  remove: adminProcedure
    .input(z.object({ contentHash: z.string().regex(/^[a-f0-9]{64}$/i) }))
    .mutation(async ({ input }) => getStorageManager().remove(input.contentHash.toLowerCase())),

  /** Get the full storage manifest for a contentHash. */
  getManifest: protectedProcedure
    .input(z.object({ contentHash: z.string() }))
    .query(async ({ input, ctx }) => {
      const manager = getStorageManager();
      const manifest = await manager.getManifest(input.contentHash);
      return manifest && ownsManifest(manifest, ctx.user.uid) ? manifest : null;
    }),

  // ─── Async Upload Queue ─────────────────────────────────

  /** Enqueue an upload (returns job ID immediately, processes in background). */
  uploadAsync: protectedProcedure
    .input(
      z.object({
        url: z.string().url(),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const queue = getUploadQueue();
      const job = await queue.add('persist', {
        generationId: crypto.randomUUID(),
        videoUrl: input.url,
        userId: ctx.user.uid,
        filename: input.filename || `file-${Date.now()}`,
        mimeType: input.mimeType || 'application/octet-stream',
      } as any);
      return { jobId: job.id };
    }),

  /** Poll the status of an upload job. */
  uploadStatus: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ input, ctx }) => {
      const queue = getUploadQueue();
      const job = await queue.getJob(input.jobId);
      if (!job) return null;
      // IDOR guard: jobIds leaked via logs/Sentry/URL surfaces must not
      // expose another user's source URL, error payload, or manifest.
      if (job.data.userId !== ctx.user.uid) return null;
      return serializeUploadJob(job);
    }),

  /** Get all active uploads for the current user. */
  activeUploads: protectedProcedure.query(async ({ ctx }) => {
    const queue = getUploadQueue();
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed'], 0, 999, true);
    return Promise.all(
      jobs.filter((job) => job.data.userId === ctx.user.uid).map(serializeUploadJob)
    );
  }),

  /** Get recent uploads (active + completed + failed). */
  recentUploads: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const queue = getUploadQueue();
      const limit = input?.limit ?? 20;
      const jobs = await queue.getJobs(
        ['waiting', 'active', 'delayed', 'completed', 'failed'],
        0,
        Math.max(limit * 5, limit) - 1,
        false
      );
      return Promise.all(
        jobs
          .filter((job) => job.data.userId === ctx.user.uid)
          .slice(0, limit)
          .map(serializeUploadJob)
      );
    }),

  /** Retry a failed upload job. */
  retryUpload: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const queue = getUploadQueue();
      const job = await queue.getJob(input.jobId);
      if (!job || job.data.userId !== ctx.user.uid || (await job.getState()) !== 'failed') {
        return { success: false };
      }
      await job.retry();
      return { success: true };
    }),

  // ─── Cost Ledger (PRD 9) ────────────────────────────────

  /**
   * Full cost breakdown for a single asset.
   * Covers both storage and AI generation costs linked to a contentHash.
   */
  assetCost: protectedProcedure
    .input(z.object({ contentHash: z.string() }))
    .query(async ({ input, ctx }) => {
      const manifest = await getStorageManager().getManifest(input.contentHash);
      if (!manifest || !ownsManifest(manifest, ctx.user.uid)) return null;
      const ledger = getCostLedger();
      const [entries, summary] = await Promise.all([
        ledger.getByContentHash(input.contentHash),
        ledger.summarizeByContentHash(input.contentHash),
      ]);
      return { entries, summary };
    }),

  /** Aggregated cost summary for the authenticated user. */
  myCosts: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(1000).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const ledger = getCostLedger();
      const [entries, summary] = await Promise.all([
        ledger.getByUser(ctx.user.uid, input?.limit ?? 50),
        ledger.summarizeByUser(ctx.user.uid),
      ]);
      return { entries, summary };
    }),

  /**
   * Get the upload trace for a stored asset.
   * Shows exactly which providers were tried, in what order, and whether
   * the content was verified post-upload.
   */
  uploadTrace: protectedProcedure
    .input(z.object({ contentHash: z.string() }))
    .query(async ({ input, ctx }) => {
      const manager = getStorageManager();
      const manifest = await manager.getManifest(input.contentHash);
      if (!manifest || !ownsManifest(manifest, ctx.user.uid)) return null;
      return {
        trace: manifest.trace ?? null,
        providers: manifest.uploads.map((u) => ({
          provider: u.provider,
          contentId: u.contentId,
          url: u.url,
          size: u.size,
        })),
      };
    }),
});
