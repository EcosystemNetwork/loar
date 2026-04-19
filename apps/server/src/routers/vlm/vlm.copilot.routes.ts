/**
 * vlm.copilot — reference-aware generation copilot.
 *
 *   improvePrompt     — user idea + reference images → detailed prompt
 *   extractStyleBible — moodboard → style pack fields
 *   scoreOutput       — evaluate a generated image/video against intent
 */

import { z } from 'zod';
import { router, protectedProcedure } from '../../lib/trpc';
import {
  improvePromptFromReferences,
  extractStyleBibleFromMoodboard,
  scoreOutput,
} from '../../services/vlm';

export const vlmCopilotRouter = router({
  improvePrompt: protectedProcedure
    .input(
      z.object({
        userPrompt: z.string().min(1).max(4000),
        references: z
          .array(z.object({ url: z.string().url(), note: z.string().max(400).optional() }))
          .max(6)
          .default([]),
        houseStyle: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { prompt } = await improvePromptFromReferences(input);
      // Cost lives only in the admin ledger (admin.cost.*); not returned to callers.
      return { prompt };
    }),

  extractStyleBible: protectedProcedure
    .input(z.object({ imageUrls: z.array(z.string().url()).min(1).max(8) }))
    .mutation(async ({ input }) => {
      const { styleBible } = await extractStyleBibleFromMoodboard(input);
      return { styleBible };
    }),

  scoreOutput: protectedProcedure
    .input(
      z.object({
        outputUrl: z.string().url(),
        outputType: z.enum(['image', 'video']).default('image'),
        intent: z.string().min(1).max(2000),
        prompt: z.string().min(1).max(4000),
        referenceUrls: z.array(z.string().url()).max(4).default([]),
      })
    )
    .mutation(async ({ input }) => {
      const { score } = await scoreOutput(input);
      return { score };
    }),
});
