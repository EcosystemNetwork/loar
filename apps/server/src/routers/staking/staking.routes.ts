/**
 * Staking Router
 *
 * Off-chain tracking of staking tiers and benefits.
 * On-chain staking happens via LaunchpadStaking contract;
 * this router reads state and manages platform-side benefits.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';

const getStakingCol = () => (firebaseAvailable ? db.collection('stakingProfiles') : null);
const getCurationCol = () => (firebaseAvailable ? db.collection('curationRewards') : null);

const TIER_NAMES = ['NONE', 'BRONZE', 'SILVER', 'GOLD', 'DIAMOND'] as const;
const TIER_THRESHOLDS = [0, 1_000, 10_000, 100_000, 500_000];
const TIER_FEE_DISCOUNTS = [0, 100, 250, 500, 1000]; // bps
const TIER_CURATION_BOOSTS = [100, 100, 150, 200, 300]; // 100 = 1x

export const stakingRouter = router({
  // ── Get user staking profile ───────────────────────────────
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const col = getStakingCol();
    if (!col) return null;
    const doc = await col.doc(ctx.user.address!.toLowerCase()).get();
    if (!doc.exists) {
      return {
        address: ctx.user.address!,
        tier: 'NONE',
        stakedAmount: 0,
        feeDiscountBps: 0,
        curationBoost: 100,
        priorityQueue: false,
        totalCurationEarned: 0,
      };
    }
    return { id: doc.id, ...doc.data() };
  }),

  // ── Sync staking state from on-chain event ─────────────────
  syncStake: protectedProcedure
    .input(
      z.object({
        stakedAmount: z.number().min(0),
        txHash: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const col = getStakingCol();
      if (!col)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      const tier = calculateTier(input.stakedAmount);
      const tierIndex = TIER_NAMES.indexOf(tier);

      const profile = {
        address: ctx.user.address!.toLowerCase(),
        tier,
        stakedAmount: input.stakedAmount,
        feeDiscountBps: TIER_FEE_DISCOUNTS[tierIndex],
        curationBoost: TIER_CURATION_BOOSTS[tierIndex],
        priorityQueue: tierIndex >= 2, // Silver+
        lastSyncTxHash: input.txHash || null,
        updatedAt: new Date().toISOString(),
      };

      await col.doc(ctx.user.address!.toLowerCase()).set(profile, { merge: true });
      return profile;
    }),

  // ── Get tier benefits info (public) ────────────────────────
  tiers: publicProcedure.query(() => {
    return TIER_NAMES.map((name, i) => ({
      name,
      minStake: TIER_THRESHOLDS[i],
      feeDiscountBps: TIER_FEE_DISCOUNTS[i],
      curationBoost: TIER_CURATION_BOOSTS[i],
      priorityQueue: i >= 2,
      feeDiscountPct: `${(TIER_FEE_DISCOUNTS[i] / 100).toFixed(1)}%`,
      curationBoostPct: `${(TIER_CURATION_BOOSTS[i] / 100).toFixed(1)}x`,
    }));
  }),

  // ── Curation rewards ───────────────────────────────────────
  // Record a curation reward (platform backend calls this when content trends)
  recordCuration: protectedProcedure
    .input(
      z.object({
        contentId: z.string(),
        universeId: z.string().optional(),
        rewardLoar: z.number().min(0),
        reason: z.string(), // 'early_discovery' | 'upvote_trending' | 'quality_vote'
      })
    )
    .mutation(async ({ ctx, input }) => {
      const curationCol = getCurationCol();
      const stakingCol = getStakingCol();
      if (!curationCol || !stakingCol)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      // Get user's curation boost from staking tier
      const profileDoc = await stakingCol.doc(ctx.user.address!.toLowerCase()).get();
      const boost = profileDoc.exists ? profileDoc.data()?.curationBoost || 100 : 100;
      const boostedReward = (input.rewardLoar * boost) / 100;

      const record = {
        address: ctx.user.address!.toLowerCase(),
        contentId: input.contentId,
        universeId: input.universeId || null,
        baseReward: input.rewardLoar,
        boost,
        finalReward: boostedReward,
        reason: input.reason,
        createdAt: new Date().toISOString(),
      };

      await curationCol.add(record);

      // Update lifetime total
      await stakingCol.doc(ctx.user.address!.toLowerCase()).set(
        {
          totalCurationEarned: (profileDoc.data()?.totalCurationEarned || 0) + boostedReward,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return record;
    }),

  // ── Get curation history ───────────────────────────────────
  curationHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const col = getCurationCol();
      if (!col) return [];
      const snap = await col
        .where('address', '==', ctx.user.address!.toLowerCase())
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  // ── Leaderboard ────────────────────────────────────────────
  leaderboard: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const col = getStakingCol();
      if (!col) return [];
      const snap = await col.orderBy('stakedAmount', 'desc').limit(input.limit).get();
      return snap.docs.map((d) => ({
        address: d.id,
        tier: d.data().tier,
        stakedAmount: d.data().stakedAmount,
        totalCurationEarned: d.data().totalCurationEarned || 0,
      }));
    }),
});

function calculateTier(amount: number): (typeof TIER_NAMES)[number] {
  if (amount >= 500_000) return 'DIAMOND';
  if (amount >= 100_000) return 'GOLD';
  if (amount >= 10_000) return 'SILVER';
  if (amount >= 1_000) return 'BRONZE';
  return 'NONE';
}
