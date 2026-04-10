/**
 * Splits Router — Revenue split configuration for universes.
 * Defines how payments are distributed between content generators,
 * universe creators, and the platform when content is sold/licensed.
 *
 * Uses existing SplitRouter.sol on-chain for actual payment routing.
 * This router manages the Firestore config that feeds into it.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { computeSplitsForContent } from '../../services/split-orchestrator';

const splitConfigsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('splitConfigs');
};

const PLATFORM_BPS = 1000; // 10% platform fee — fixed
const MAX_UNIVERSE_CREATOR_BPS = 4000; // 40% max for universe creator
const TOTAL_BPS = 10000;

export const splitsRouter = router({
  getConfig: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await splitConfigsCol().doc(input.universeId.toLowerCase()).get();
      if (!doc.exists) {
        // Return defaults: 70% generator, 20% universe creator, 10% platform
        return {
          universeId: input.universeId,
          universeCreatorAddress: null,
          universeCreatorBps: 2000,
          platformBps: PLATFORM_BPS,
          generatorBps: TOTAL_BPS - 2000 - PLATFORM_BPS,
          isDefault: true,
        };
      }
      return { id: doc.id, ...doc.data(), isDefault: false };
    }),

  setConfig: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        universeCreatorBps: z.number().int().min(0).max(MAX_UNIVERSE_CREATOR_BPS),
        universeCreatorAddress: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const isAdmin = await isUniverseAdmin(input.universeId, ctx.user.uid);
      if (!isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe admin can configure splits',
        });
      }

      const generatorBps = TOTAL_BPS - input.universeCreatorBps - PLATFORM_BPS;
      if (generatorBps < 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid split: generator share cannot be negative',
        });
      }

      const config = {
        universeId: input.universeId.toLowerCase(),
        universeCreatorAddress: input.universeCreatorAddress || ctx.user.address || null,
        universeCreatorBps: input.universeCreatorBps,
        platformBps: PLATFORM_BPS,
        generatorBps,
        creatorUid: ctx.user.uid,
        updatedAt: new Date(),
      };

      const ref = splitConfigsCol().doc(input.universeId.toLowerCase());
      const existing = await ref.get();

      if (existing.exists) {
        await ref.update(config);
      } else {
        await ref.set({ ...config, createdAt: new Date() });
      }

      return { ok: true, ...config };
    }),

  computeSplits: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        generatorAddress: z.string(),
      })
    )
    .query(async ({ input }) => {
      return computeSplitsForContent(input.universeId, input.generatorAddress);
    }),
});
