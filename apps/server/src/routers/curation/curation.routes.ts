/**
 * Curation tRPC router.
 *
 * `endorse` and `revoke` are protected — only authenticated wallets may
 * endorse. `scoreFor`, `leaderboard`, `myEndorsement` are cheap reads.
 * `myEndorsement` is protected since it's caller-scoped; the other reads
 * are public.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { CURATION_TARGET_TYPES } from './curation.types';
import {
  upsertEndorsement,
  revokeEndorsement,
  getScoreFor,
  getMyEndorsements,
  getMyEndorsementFor,
  getLeaderboard,
} from './curation.handlers';

const ethereumAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');
const targetTypeSchema = z.enum(CURATION_TARGET_TYPES as [string, ...string[]]);

export const curationRouter = router({
  /** Create or update an endorsement. One per (curator, target). */
  endorse: protectedProcedure
    .input(
      z.object({
        targetType: targetTypeSchema,
        targetId: z.string().min(1).max(200),
        weight: z.number().int().min(1).max(5),
        note: z.string().max(500).optional(),
        universeAddress: ethereumAddress.nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) throw new Error('Wallet address required');
      const endorsement = await upsertEndorsement({
        curator: ctx.user.address,
        targetType: input.targetType as any,
        targetId: input.targetId,
        weight: input.weight,
        note: input.note,
        universeAddress:
          input.universeAddress === undefined ? undefined : (input.universeAddress ?? null),
      });
      return { success: true, endorsement };
    }),

  /** Revoke your own endorsement on a target. */
  revoke: protectedProcedure
    .input(
      z.object({
        targetType: targetTypeSchema,
        targetId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) throw new Error('Wallet address required');
      await revokeEndorsement(
        {
          curator: ctx.user.address,
          targetType: input.targetType as any,
          targetId: input.targetId,
        },
        ctx.user.address
      );
      return { success: true };
    }),

  /** Aggregate endorsement score for a target. Public. */
  scoreFor: publicProcedure
    .input(
      z.object({
        targetType: targetTypeSchema,
        targetId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const score = await getScoreFor(input.targetType as any, input.targetId);
      return score;
    }),

  /** Current viewer's endorsement on a specific target, if any. */
  myEndorsement: protectedProcedure
    .input(
      z.object({
        targetType: targetTypeSchema,
        targetId: z.string().min(1),
      })
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.user.address) return { endorsement: null };
      const endorsement = await getMyEndorsementFor(
        ctx.user.address,
        input.targetType as any,
        input.targetId
      );
      return { endorsement };
    }),

  /** Endorsements by the current viewer. */
  myEndorsements: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().positive().max(200).default(100),
        })
        .default({ limit: 100 })
    )
    .query(async ({ input, ctx }) => {
      if (!ctx.user.address) return { endorsements: [] };
      const endorsements = await getMyEndorsements(ctx.user.address, input.limit);
      return { endorsements };
    }),

  /** Top targets by endorsement weight. */
  leaderboard: publicProcedure
    .input(
      z
        .object({
          targetType: targetTypeSchema.optional(),
          universeAddress: ethereumAddress.nullish(),
          limit: z.number().int().positive().max(100).default(25),
        })
        .default({ limit: 25 })
    )
    .query(async ({ input }) => {
      const leaderboard = await getLeaderboard({
        targetType: input.targetType as any,
        universeAddress:
          input.universeAddress === undefined ? undefined : (input.universeAddress ?? null),
        limit: input.limit,
      });
      return { leaderboard };
    }),
});

export type CurationRouter = typeof curationRouter;
