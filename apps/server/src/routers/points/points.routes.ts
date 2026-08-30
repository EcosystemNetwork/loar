/**
 * Points tRPC router — read side of the gamification score.
 *
 * Points are earned automatically (universe creation, generations); there
 * is no mutation to grant them here. `leaderboard` is public; `me` is
 * caller-scoped.
 *
 * See services/points for the ledger and award rules.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import {
  getLeaderboard,
  getMyPoints,
  POINTS_PER_GENERATION,
  POINTS_PER_UNIVERSE,
} from '../../services/points';

export const pointsRouter = router({
  /** Award amounts, for UI copy. */
  config: publicProcedure.query(() => ({
    perUniverse: POINTS_PER_UNIVERSE,
    perGeneration: POINTS_PER_GENERATION,
  })),

  /** Top users by points, desc. */
  leaderboard: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).default({ limit: 50 }))
    .query(async ({ input }) => {
      const rows = await getLeaderboard(input.limit);
      return { leaderboard: rows };
    }),

  /** Current viewer's totals + rank. */
  me: protectedProcedure.query(async ({ ctx }) => {
    return getMyPoints(ctx.user.uid);
  }),
});

export type PointsRouter = typeof pointsRouter;
