/**
 * Firebase Storage Router — direct operations on Google Cloud Storage.
 * Extracted from the root appRouter inline definition.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { firebaseStorageService } from '../../services/firebase-storage';
import { wrapError } from '../../lib/errors';

export const firebaseStorageRouter = router({
  /** Upload a file from URL to Firebase Storage. */
  uploadFromUrl: protectedProcedure
    .input(
      z.object({
        url: z.string().min(1, 'URL is required'),
        filename: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await firebaseStorageService.uploadFromUrl(input.url, input.filename);
        return {
          key: result,
          url: firebaseStorageService.getPublicUrl(result),
        };
      } catch (error) {
        throw wrapError(error, 'Firebase Storage upload failed');
      }
    }),

  /** Download a file from Firebase Storage (base64, max 5MB). */
  download: protectedProcedure.input(z.object({ key: z.string() })).query(async ({ input }) => {
    try {
      const data = await firebaseStorageService.download(input.key);

      if (data.length > 5 * 1024 * 1024) {
        throw new Error(
          `File too large for tRPC: ${Math.round(data.length / 1024 / 1024)}MB (max 5MB). Use public URL instead.`
        );
      }

      const base64Data = Buffer.from(data).toString('base64');
      return {
        data: base64Data,
        key: input.key,
        originalSize: data.length,
        encodedSize: base64Data.length,
      };
    } catch (error) {
      throw wrapError(error, 'Failed to download from Firebase Storage');
    }
  }),

  /** Get the public URL for a Firebase Storage key. */
  getPublicUrl: publicProcedure.input(z.object({ key: z.string() })).query(({ input }) => {
    return { url: firebaseStorageService.getPublicUrl(input.key) };
  }),
});
