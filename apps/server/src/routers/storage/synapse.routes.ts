/**
 * Synapse Router — direct Filecoin Synapse operations.
 * Extracted from the root appRouter inline definition.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { getSynapseService } from '../../services/synapse';
import { wrapError } from '../../lib/errors';

export const synapseRouter = router({
  /** Upload a file from URL to Filecoin via Synapse. */
  uploadFromUrl: protectedProcedure
    .input(z.object({ url: z.string().min(1, 'URL is required') }))
    .mutation(async ({ input }) => {
      try {
        const service = await getSynapseService();
        return await service.uploadFromUrl(input.url);
      } catch (error) {
        throw wrapError(error, 'Synapse upload failed');
      }
    }),

  /** Download content by PieceCID from Filecoin (base64, max 5MB). */
  download: publicProcedure.input(z.object({ pieceCid: z.string() })).query(async ({ input }) => {
    try {
      const service = await getSynapseService();
      const data = await service.download(input.pieceCid);

      if (data.length > 5 * 1024 * 1024) {
        throw new Error(
          `File too large for tRPC: ${Math.round(data.length / 1024 / 1024)}MB (max 5MB). Use HTTP gateway instead.`
        );
      }

      const base64Data = Buffer.from(data).toString('base64');
      return {
        data: base64Data,
        pieceCid: input.pieceCid,
        originalSize: data.length,
        encodedSize: base64Data.length,
      };
    } catch (error) {
      throw wrapError(error, 'Failed to download from Filecoin');
    }
  }),

  /** Get the HTTP gateway URL for a PieceCID. */
  getHttpUrl: publicProcedure.input(z.object({ pieceCid: z.string() })).query(({ input }) => {
    const baseUrl =
      process.env.NODE_ENV === 'production' ? 'https://your-domain.com' : 'http://localhost:3000';
    return { url: `${baseUrl}/api/filecoin/${input.pieceCid}` };
  }),
});
