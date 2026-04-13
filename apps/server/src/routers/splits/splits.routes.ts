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
import {
  computeSplitsForContent,
  computeEntityHash,
  buildSetSplitsCalldata,
  recordContentSplit,
} from '../../services/split-orchestrator';

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

  /**
   * Configure splits for a content piece AND persist the on-chain calldata.
   * Returns the ABI-encoded calldata for the client to sign via SplitRouter.
   * After the TX is confirmed, call `confirmSplits` with the txHash.
   */
  prepareSplits: protectedProcedure
    .input(
      z.object({
        contentId: z.string(),
        universeId: z.string(),
        generatorAddress: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const splits = await computeSplitsForContent(input.universeId, input.generatorAddress);
      const entityHash = computeEntityHash(input.contentId);
      const calldata = buildSetSplitsCalldata(entityHash, splits.splits);

      // Record pending split in Firestore
      await recordContentSplit(
        input.contentId,
        input.universeId,
        input.generatorAddress,
        splits.splits,
        entityHash
      );

      const splitRouterAddress = process.env.SPLIT_ROUTER_ADDRESS ?? null;

      return {
        entityHash,
        splits: splits.splits,
        calldata,
        splitRouterAddress,
        configured: false,
      };
    }),

  /**
   * Confirm that a setSplits TX was executed on-chain.
   * Verifies the TX receipt and marks the split as configured.
   */
  confirmSplits: protectedProcedure
    .input(
      z.object({
        contentId: z.string(),
        txHash: z.string(),
        chainId: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      // Verify on-chain
      const { createPublicClient: createClient, http: httpTransport } = await import('viem');
      const { sepolia: sep, baseSepolia: baseSep } = await import('viem/chains');
      const client = createClient({
        chain: input.chainId === 84532 ? baseSep : sep,
        transport: httpTransport(
          input.chainId === 84532
            ? (process.env.RPC_URL_BASE_SEPOLIA ?? '')
            : (process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? '')
        ),
      });

      try {
        const receipt = await client.getTransactionReceipt({
          hash: input.txHash as `0x${string}`,
        });
        if (receipt.status !== 'success') {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'setSplits TX was reverted' });
        }
      } catch (err: any) {
        if (err?.code) throw err;
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'TX not found on-chain' });
      }

      // Mark as configured
      const ref = splitConfigsCol().doc(input.contentId);
      const contentSplitRef = db.collection('contentSplits').doc(input.contentId);
      const doc = await contentSplitRef.get();
      if (doc.exists) {
        await contentSplitRef.update({
          configured: true,
          txHash: input.txHash,
          confirmedAt: new Date(),
        });
      }

      return { ok: true, configured: true };
    }),
});
