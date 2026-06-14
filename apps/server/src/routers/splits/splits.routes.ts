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
import { assertContentOperable } from '../../lib/content-status';
import { verifyAndClaimTx } from '../../services/tx-verify';
import { SplitRouter, type SplitRouterChainId } from '@loar/abis/addresses';
import { sepolia, mainnet } from 'viem/chains';

const ALLOWED_CHAIN_IDS: Set<number> = new Set([sepolia.id, mainnet.id]);

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
      // SRV-2: splits decide who receives every future payment for this
      // content, so it's a monetization decision on par with listing the
      // content for sale. Enforce the moderation gate before persisting.
      await assertContentOperable(input.contentId);

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
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user.address) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Connected wallet required to confirm splits',
        });
      }

      // Reject unsupported chains up-front (mirror tx-verify allowlist).
      if (input.chainId !== undefined && !ALLOWED_CHAIN_IDS.has(input.chainId)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Chain ID ${input.chainId} is not supported.`,
        });
      }

      // Load the pending split record to learn which universe this content
      // belongs to, then authorize the caller as that universe's admin.
      const contentSplitRef = db.collection('contentSplits').doc(input.contentId);
      const doc = await contentSplitRef.get();
      if (!doc.exists) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No pending split found for this content. Call prepareSplits first.',
        });
      }
      const splitDoc = doc.data()!;
      const universeId = splitDoc.universeId as string | undefined;
      if (universeId) {
        const isAdmin = await isUniverseAdmin(universeId, ctx.user.uid);
        if (!isAdmin) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the universe admin can configure splits',
          });
        }
      }

      // Resolve the SplitRouter the setSplits TX must target for this chain.
      const chainKey = String(input.chainId ?? sepolia.id) as SplitRouterChainId;
      const expectedTo = SplitRouter[chainKey] as string | undefined;

      // Verify the TX: sender must be the authenticated caller and recipient
      // must be the SplitRouter. verifyAndClaimTx also atomically claims the
      // txHash, preventing an unrelated/replayed tx from being credited.
      await verifyAndClaimTx(
        input.txHash,
        `splits:${splitDoc.entityHash ?? input.contentId}`,
        ctx.user.uid,
        {
          expectedFrom: ctx.user.address,
          expectedTo,
          chainId: input.chainId,
        }
      );

      // Mark as configured
      await contentSplitRef.update({
        configured: true,
        txHash: input.txHash,
        confirmedAt: new Date(),
      });

      return { ok: true, configured: true };
    }),
});
