import { protectedProcedure, publicProcedure, router } from "../../lib/trpc";
import { z } from "zod";
import { getStorageManager } from "../../services/storage";
import { getUploadQueue } from "../../services/storage/upload-queue";
import type { StorageManifest } from "../../services/storage";

export const storageRouter = router({
  /** Upload a file from URL via the unified StorageManager. Returns manifest immediately. */
  upload: protectedProcedure
    .input(
      z.object({
        url: z.string().min(1, "URL is required"),
        filename: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<StorageManifest> => {
      const manager = getStorageManager();
      const manifest = await manager.uploadFromUrl(input.url, input.filename);
      return manifest;
    }),

  /** Upload base64-encoded data directly via tRPC (for smaller files). */
  uploadDirect: protectedProcedure
    .input(
      z.object({
        data: z.string().min(1, "Data is required"), // base64-encoded
        filename: z.string(),
        mimeType: z.string(),
      })
    )
    .mutation(async ({ input }): Promise<StorageManifest> => {
      const buffer = Buffer.from(input.data, "base64");

      if (buffer.length > 10 * 1024 * 1024) {
        throw new Error(
          "File too large for tRPC upload (max 10MB). Use /api/upload for larger files."
        );
      }

      const manager = getStorageManager();
      return manager.upload(buffer, input.filename, input.mimeType);
    }),

  /** Resolve a contentHash to the best available URL. */
  resolve: publicProcedure
    .input(z.object({ contentHash: z.string() }))
    .query(async ({ input }) => {
      const manager = getStorageManager();
      const url = await manager.resolve(input.contentHash);
      return { url };
    }),

  /** Get the full storage manifest for a contentHash. */
  getManifest: publicProcedure
    .input(z.object({ contentHash: z.string() }))
    .query(async ({ input }) => {
      const manager = getStorageManager();
      return manager.getManifest(input.contentHash);
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
      const jobId = await queue.enqueue(
        input.url,
        input.filename || `file-${Date.now()}`,
        input.mimeType || "application/octet-stream",
        ctx.user.uid
      );
      return { jobId };
    }),

  /** Poll the status of an upload job. */
  uploadStatus: publicProcedure
    .input(z.object({ jobId: z.string() }))
    .query(({ input }) => {
      const queue = getUploadQueue();
      const job = queue.getStatus(input.jobId);
      if (!job) return null;
      return job;
    }),

  /** Get all active uploads for the current user. */
  activeUploads: protectedProcedure.query(({ ctx }) => {
    const queue = getUploadQueue();
    return queue.getActiveJobs(ctx.user.uid);
  }),

  /** Get recent uploads (active + completed + failed). */
  recentUploads: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).optional() }).optional())
    .query(({ ctx, input }) => {
      const queue = getUploadQueue();
      return queue.getRecentJobs(ctx.user.uid, input?.limit ?? 20);
    }),

  /** Retry a failed upload job. */
  retryUpload: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ input }) => {
      const queue = getUploadQueue();
      const success = await queue.retry(input.jobId);
      return { success };
    }),
});
