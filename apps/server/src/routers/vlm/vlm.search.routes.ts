/**
 * vlm.search — multimodal search over scene tags, captions, and (optional) embeddings.
 * Public read — canon-aware search is a discovery feature.
 */

import { z } from 'zod';
import { router, publicProcedure } from '../../lib/trpc';
import { searchScenes } from '../../services/vlm';

export const vlmSearchRouter = router({
  query: publicProcedure
    .input(
      z.object({
        q: z.string().min(1).max(500),
        universeAddress: z.string().nullish(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const hits = await searchScenes({
        query: input.q,
        universeAddress: input.universeAddress ?? null,
        limit: input.limit,
      });
      return hits;
    }),
});
