/**
 * Staking Router
 *
 * Reads staking state from the on-chain LaunchpadStaking contract and
 * caches it in Firestore for fast platform queries.
 *
 * On-chain contract provides: stakes(address), getUserTier, getFeeDiscount,
 * getCurationBoost, hasPriorityAccess, totalStaked.
 *
 * syncStake now reads directly from the contract instead of trusting client input.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createPublicClient, http, formatUnits } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';

const getStakingCol = () => (firebaseAvailable ? db.collection('stakingProfiles') : null);
const getCurationCol = () => (firebaseAvailable ? db.collection('curationRewards') : null);

const TIER_NAMES = ['NONE', 'BRONZE', 'SILVER', 'GOLD', 'DIAMOND'] as const;

/// Fallback tier table. Only used when the LaunchpadStaking contract is not
/// configured/reachable (e.g. local dev without a deployment). Once the
/// contract responds, on-chain `tierConfigs` become authoritative so server
/// and chain cannot drift after an admin reconfiguration.
const FALLBACK_TIER_THRESHOLDS = [0, 1_000, 10_000, 100_000, 500_000];
const FALLBACK_TIER_FEE_DISCOUNTS = [0, 100, 250, 500, 1000]; // bps
const FALLBACK_TIER_CURATION_BOOSTS = [100, 100, 150, 200, 300]; // 100 = 1x
const FALLBACK_TIER_PRIORITY = [false, false, true, true, true];

// ── On-chain clients ───────────────────────────────────────────────
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});
const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
});
function getChainClient(chainId?: number) {
  if (chainId === baseSepolia.id) return baseSepoliaClient;
  return sepoliaClient;
}

const STAKING_CONTRACT_ADDRESS = process.env.LAUNCHPAD_STAKING_ADDRESS as `0x${string}` | undefined;

// Minimal ABI for the on-chain read functions we need
const STAKING_ABI = [
  {
    name: 'stakes',
    type: 'function',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'stakedAt', type: 'uint256' },
      { name: 'lastClaimAt', type: 'uint256' },
      { name: 'tier', type: 'uint8' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getUserTier',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    name: 'getFeeDiscount',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    name: 'getCurationBoost',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    name: 'hasPriorityAccess',
    type: 'function',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'totalStaked',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'tierConfigs',
    type: 'function',
    inputs: [{ name: '', type: 'uint8' }],
    outputs: [
      { name: 'minStake', type: 'uint256' },
      { name: 'weight', type: 'uint16' },
      { name: 'feeDiscountBps', type: 'uint16' },
      { name: 'curationBoost', type: 'uint16' },
      { name: 'priorityQueue', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const;

/**
 * Read staking state directly from the LaunchpadStaking contract.
 * Returns null if the contract is not configured.
 */
async function readOnChainStake(address: string, chainId?: number) {
  if (!STAKING_CONTRACT_ADDRESS) return null;

  const client = getChainClient(chainId);
  const addr = address.toLowerCase() as `0x${string}`;

  try {
    const [stakeData, tierIndex, feeDiscount, curationBoost, priorityQueue] = await Promise.all([
      client.readContract({
        address: STAKING_CONTRACT_ADDRESS,
        abi: STAKING_ABI,
        functionName: 'stakes',
        args: [addr],
      }),
      client.readContract({
        address: STAKING_CONTRACT_ADDRESS,
        abi: STAKING_ABI,
        functionName: 'getUserTier',
        args: [addr],
      }),
      client.readContract({
        address: STAKING_CONTRACT_ADDRESS,
        abi: STAKING_ABI,
        functionName: 'getFeeDiscount',
        args: [addr],
      }),
      client.readContract({
        address: STAKING_CONTRACT_ADDRESS,
        abi: STAKING_ABI,
        functionName: 'getCurationBoost',
        args: [addr],
      }),
      client.readContract({
        address: STAKING_CONTRACT_ADDRESS,
        abi: STAKING_ABI,
        functionName: 'hasPriorityAccess',
        args: [addr],
      }),
    ]);

    const stakedAmount = Number(formatUnits(stakeData[0], 18));
    const tier = TIER_NAMES[tierIndex] ?? 'NONE';

    return {
      stakedAmount,
      stakedAtTimestamp: Number(stakeData[1]),
      tier,
      feeDiscountBps: Number(feeDiscount),
      curationBoost: Number(curationBoost),
      priorityQueue,
    };
  } catch (err) {
    console.error('[staking] Failed to read on-chain stake:', err);
    return null;
  }
}

export const stakingRouter = router({
  // ── Get user staking profile ───────────────────────────────
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.address) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Wallet address required for staking' });
    }
    const col = getStakingCol();
    if (!col) return null;
    const doc = await col.doc(ctx.user.address.toLowerCase()).get();
    if (!doc.exists) {
      return {
        address: ctx.user.address,
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

  // ── Sync staking state from on-chain contract ──────────────
  // Reads directly from LaunchpadStaking contract — no client-supplied amounts.
  // Falls back to client-supplied data only if contract is not configured.
  syncStake: protectedProcedure
    .input(
      z.object({
        txHash: z.string().optional(),
        chainId: z.number().optional(),
        // Legacy fallback: only used when contract is not deployed yet
        stakedAmount: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.address) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Wallet address required for staking',
        });
      }
      const col = getStakingCol();
      if (!col)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      const address = ctx.user.address.toLowerCase();

      // Try reading from on-chain contract first
      const onChainData = await readOnChainStake(address, input.chainId);

      let profile;
      if (onChainData) {
        // On-chain verified data — authoritative
        profile = {
          address,
          tier: onChainData.tier,
          stakedAmount: onChainData.stakedAmount,
          feeDiscountBps: onChainData.feeDiscountBps,
          curationBoost: onChainData.curationBoost,
          priorityQueue: onChainData.priorityQueue,
          stakedAtTimestamp: onChainData.stakedAtTimestamp,
          lastSyncTxHash: input.txHash || null,
          onChainVerified: true,
          updatedAt: new Date().toISOString(),
        };
      } else {
        // Fallback: use client-supplied amount (pre-deployment).
        // Only reachable when the LaunchpadStaking contract isn't configured —
        // once deployed, readOnChainStake returns authoritative data above.
        const stakedAmount = input.stakedAmount ?? 0;
        const tier = fallbackCalculateTier(stakedAmount);
        const tierIndex = TIER_NAMES.indexOf(tier);

        profile = {
          address,
          tier,
          stakedAmount,
          feeDiscountBps: FALLBACK_TIER_FEE_DISCOUNTS[tierIndex],
          curationBoost: FALLBACK_TIER_CURATION_BOOSTS[tierIndex],
          priorityQueue: FALLBACK_TIER_PRIORITY[tierIndex],
          lastSyncTxHash: input.txHash || null,
          onChainVerified: false,
          updatedAt: new Date().toISOString(),
        };
      }

      await col.doc(address).set(profile, { merge: true });
      return profile;
    }),

  // ── Read on-chain stake without syncing to Firestore ──────
  // Useful for real-time display without persisting
  getOnChainStake: protectedProcedure
    .input(z.object({ chainId: z.number().optional() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.user.address) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Wallet address required for staking',
        });
      }
      const address = ctx.user.address;
      const onChain = await readOnChainStake(address, input.chainId);
      if (!onChain) {
        return { available: false, message: 'Staking contract not configured' };
      }
      return { available: true, ...onChain };
    }),

  // ── Get tier benefits info (public) ────────────────────────
  // Reads tierConfigs from the LaunchpadStaking contract so the displayed
  // thresholds match what `stake()` will actually honor. Falls back to the
  // hardcoded defaults only when the contract is not configured.
  tiers: publicProcedure
    .input(z.object({ chainId: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const onChain = await readTierConfigsFromChain(input?.chainId);
      return TIER_NAMES.map((name, i) => {
        if (i === 0) {
          return {
            name,
            minStake: 0,
            feeDiscountBps: 0,
            curationBoost: 100,
            priorityQueue: false,
            feeDiscountPct: '0.0%',
            curationBoostPct: '1.0x',
          };
        }
        const cfg = onChain?.[i];
        const minStake = cfg ? cfg.minStake : FALLBACK_TIER_THRESHOLDS[i];
        const feeDiscountBps = cfg ? cfg.feeDiscountBps : FALLBACK_TIER_FEE_DISCOUNTS[i];
        const curationBoost = cfg ? cfg.curationBoost : FALLBACK_TIER_CURATION_BOOSTS[i];
        const priorityQueue = cfg ? cfg.priorityQueue : FALLBACK_TIER_PRIORITY[i];
        return {
          name,
          minStake,
          feeDiscountBps,
          curationBoost,
          priorityQueue,
          feeDiscountPct: `${(feeDiscountBps / 100).toFixed(1)}%`,
          curationBoostPct: `${(curationBoost / 100).toFixed(1)}x`,
        };
      });
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
      if (!ctx.user.address) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Wallet address required for staking',
        });
      }
      const curationCol = getCurationCol();
      const stakingCol = getStakingCol();
      if (!curationCol || !stakingCol)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      // Get user's curation boost from staking tier
      const profileDoc = await stakingCol.doc(ctx.user.address.toLowerCase()).get();
      const boost = profileDoc.exists ? profileDoc.data()?.curationBoost || 100 : 100;
      const boostedReward = (input.rewardLoar * boost) / 100;

      const record = {
        address: ctx.user.address.toLowerCase(),
        contentId: input.contentId,
        universeId: input.universeId || null,
        baseReward: input.rewardLoar,
        boost,
        finalReward: boostedReward,
        reason: input.reason,
        createdAt: new Date().toISOString(),
      };

      await curationCol.add(record);

      // Atomically update lifetime total to prevent race conditions
      const { FieldValue } = await import('firebase-admin/firestore');
      await stakingCol.doc(ctx.user.address!.toLowerCase()).set(
        {
          totalCurationEarned: FieldValue.increment(boostedReward),
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
      if (!ctx.user.address) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Wallet address required for staking',
        });
      }
      const col = getCurationCol();
      if (!col) return [];
      const snap = await col
        .where('address', '==', ctx.user.address.toLowerCase())
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

/// Fallback tier classification. Only reachable when the LaunchpadStaking
/// contract is unreachable — on-chain `getUserTier()` is authoritative
/// otherwise.
function fallbackCalculateTier(amount: number): (typeof TIER_NAMES)[number] {
  if (amount >= FALLBACK_TIER_THRESHOLDS[4]) return 'DIAMOND';
  if (amount >= FALLBACK_TIER_THRESHOLDS[3]) return 'GOLD';
  if (amount >= FALLBACK_TIER_THRESHOLDS[2]) return 'SILVER';
  if (amount >= FALLBACK_TIER_THRESHOLDS[1]) return 'BRONZE';
  return 'NONE';
}

/// Per-request cache: avoid N round-trips when `tiers` query is called often.
/// Keyed by chainId; 60s TTL so admin edits propagate within a minute.
const TIER_CACHE_TTL_MS = 60_000;
const tierConfigCache = new Map<
  number,
  {
    expiresAt: number;
    configs: Array<{
      minStake: number;
      weight: number;
      feeDiscountBps: number;
      curationBoost: number;
      priorityQueue: boolean;
    } | null>;
  }
>();

async function readTierConfigsFromChain(chainId?: number) {
  if (!STAKING_CONTRACT_ADDRESS) return null;
  const cacheKey = chainId ?? 0;
  const cached = tierConfigCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.configs;

  const client = getChainClient(chainId);
  try {
    // Tier enum: 0=NONE, 1=BRONZE, 2=SILVER, 3=GOLD, 4=DIAMOND.
    // NONE is not configured on-chain, so we query 1..4.
    const reads = await Promise.all(
      [1, 2, 3, 4].map((tierIdx) =>
        client.readContract({
          address: STAKING_CONTRACT_ADDRESS,
          abi: STAKING_ABI,
          functionName: 'tierConfigs',
          args: [tierIdx],
        })
      )
    );
    const configs: Array<{
      minStake: number;
      weight: number;
      feeDiscountBps: number;
      curationBoost: number;
      priorityQueue: boolean;
    } | null> = [null];
    for (const r of reads) {
      const [minStake, weight, feeDiscountBps, curationBoost, priorityQueue] = r as readonly [
        bigint,
        number,
        number,
        number,
        boolean,
      ];
      configs.push({
        minStake: Number(formatUnits(minStake, 18)),
        weight: Number(weight),
        feeDiscountBps: Number(feeDiscountBps),
        curationBoost: Number(curationBoost),
        priorityQueue,
      });
    }
    tierConfigCache.set(cacheKey, {
      expiresAt: Date.now() + TIER_CACHE_TTL_MS,
      configs,
    });
    return configs;
  } catch (err) {
    console.error('[staking] Failed to read tierConfigs from chain:', err);
    return null;
  }
}
