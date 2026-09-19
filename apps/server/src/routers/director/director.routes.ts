/**
 * LOAR Director Router — voice/text intent routing.
 *
 * Single entry point for the VOICE → LOAR DIRECTOR step: classifies an
 * utterance as a canon query or a story action and returns a response
 * shaped for the Character Voice → HUME leg (a short spoken-ready string
 * plus the structured data behind it).
 */
import { z } from 'zod';
import { protectedProcedure, router } from '../../lib/trpc';
import {
  classifyDirectorIntent,
  answerCanonQuery,
  planStoryAction,
} from '../../services/loar-director';

export const directorRouter = router({
  dispatch: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        entityId: z.string().optional(),
        utterance: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const classification = await classifyDirectorIntent({
        utterance: input.utterance,
        userId: ctx.user.uid,
      });

      if (classification.intent === 'story_action') {
        const plan = await planStoryAction({
          utterance: input.utterance,
          universeId: input.universeId,
          userId: ctx.user.uid,
        });
        return {
          intent: 'story_action' as const,
          confidence: classification.confidence,
          spokenResponse: plan.spokenAck,
          storyAction: plan,
        };
      }

      const result = await answerCanonQuery({
        utterance: input.utterance,
        universeId: input.universeId,
        entityId: input.entityId,
        userId: ctx.user.uid,
      });
      return {
        intent: 'canon_query' as const,
        confidence: classification.confidence,
        spokenResponse: result.answer,
        canonQuery: result,
      };
    }),
});
