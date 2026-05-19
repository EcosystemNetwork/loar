/**
 * Royalty Split Policy — how rewards flow up the lineage tree.
 *
 * Every monetized event (mint, license, sale, derivative resale) needs to
 * answer: who gets paid, and what percentage? The lineage graph
 * (`assetEvents` collection) tells us *who created what*. This module
 * codifies the rules that turn that graph into a list of recipients.
 *
 * Four policies cover the territory we care about for testnet:
 *
 *   current_only       100% to whoever currently owns the asset.
 *                      Default for "fan" content — no upstream attribution.
 *
 *   decay_7030         70% to current creator, 30% split across ancestors
 *                      with exponential decay (each step up halves the prior
 *                      slice). The right default for "original" content
 *                      where the most recent remixer did the most work but
 *                      upstream still gets paid.
 *
 *   split_50_30_20     50% current, 30% direct parent, 20% root.
 *                      Three-bucket flat split — easy to reason about and
 *                      matches how editorial newsrooms historically credit
 *                      a source.
 *
 *   equal_share        Equal split across all unique creators in the chain.
 *                      Most generous to ancestors — use for community
 *                      remix campaigns where attribution dominates economics.
 *
 * Policies are per-universe with a platform-wide fallback. A universe can
 * pick a different policy per rights class (fan / original / licensed).
 */

export type RoyaltyPolicyId = 'current_only' | 'decay_7030' | 'split_50_30_20' | 'equal_share';

export type RightsClass = 'fan' | 'original' | 'licensed';

export interface RoyaltyPolicyConfig {
  /** Policy applied to each rights class. */
  byRightsClass: Record<RightsClass, RoyaltyPolicyId>;
  /** Hard cap on lineage depth walked. Beyond this, ancestors get zero. */
  maxDepth: number;
  /** Floor below which a recipient is dropped (bps; 1 bp = 0.01%). */
  minShareBps: number;
}

export const DEFAULT_POLICY: RoyaltyPolicyConfig = {
  byRightsClass: {
    fan: 'current_only',
    original: 'decay_7030',
    licensed: 'split_50_30_20',
  },
  maxDepth: 8,
  minShareBps: 100, // 1% — drop ancestors who'd get less than this
};

/** All shares are in basis points (10_000 = 100%). */
export const TOTAL_BPS = 10_000;

/**
 * Pure math: given a policy + a lineage chain (root → self, inclusive),
 * return the bps allocation for each entry in the chain by index.
 *
 * The returned array is the SAME LENGTH as `chain` — indexes that get
 * dropped (sub-floor share, or beyond maxDepth) get 0.
 */
export function allocateShares(
  policy: RoyaltyPolicyId,
  chainLength: number,
  config: RoyaltyPolicyConfig = DEFAULT_POLICY
): number[] {
  if (chainLength <= 0) return [];

  // `chain` is root → self. The last index is the current creator.
  const currentIdx = chainLength - 1;
  const shares = new Array<number>(chainLength).fill(0);

  // Single-entry chain → 100% current, regardless of policy.
  if (chainLength === 1) {
    shares[0] = TOTAL_BPS;
    return shares;
  }

  switch (policy) {
    case 'current_only': {
      shares[currentIdx] = TOTAL_BPS;
      break;
    }

    case 'decay_7030': {
      const currentShare = 7000;
      const ancestorPool = TOTAL_BPS - currentShare; // 3000
      shares[currentIdx] = currentShare;

      // Walk ancestors back-to-front (parent → root) and halve each step.
      // Distribute the 3000 pool over a geometric series, then normalize
      // so it sums exactly to ancestorPool (correcting rounding drift).
      const ancestorIdxs: number[] = [];
      for (let i = currentIdx - 1; i >= 0; i--) ancestorIdxs.push(i);

      const weights = ancestorIdxs.map((_, i) => Math.pow(0.5, i)); // 1, 0.5, 0.25…
      const weightSum = weights.reduce((a, b) => a + b, 0);
      let allocated = 0;
      ancestorIdxs.forEach((idx, i) => {
        const share = Math.floor((weights[i]! / weightSum) * ancestorPool);
        shares[idx] = share;
        allocated += share;
      });
      // Hand any rounding remainder to the direct parent.
      const remainder = ancestorPool - allocated;
      if (remainder > 0 && ancestorIdxs.length > 0) {
        shares[ancestorIdxs[0]!]! += remainder;
      }
      break;
    }

    case 'split_50_30_20': {
      // Current = 50%. Direct parent = 30%. Root = 20%.
      // If chain length is 2 (current + root only), parent and root merge.
      shares[currentIdx] = 5000;
      if (chainLength === 2) {
        shares[0] = 5000; // root gets the combined 30+20
      } else {
        shares[currentIdx - 1]! = 3000; // direct parent
        shares[0] = 2000; // root
      }
      break;
    }

    case 'equal_share': {
      const per = Math.floor(TOTAL_BPS / chainLength);
      for (let i = 0; i < chainLength; i++) shares[i] = per;
      // Hand remainder to current creator.
      const remainder = TOTAL_BPS - per * chainLength;
      if (remainder > 0) shares[currentIdx]! += remainder;
      break;
    }

    default: {
      // Unknown policy — fail safe to current-only.
      shares[currentIdx] = TOTAL_BPS;
    }
  }

  // Enforce maxDepth — anything beyond is dropped, then re-normalize.
  if (chainLength > config.maxDepth) {
    const trim = chainLength - config.maxDepth;
    let dropped = 0;
    for (let i = 0; i < trim; i++) {
      dropped += shares[i]!;
      shares[i] = 0;
    }
    if (dropped > 0) shares[currentIdx]! += dropped;
  }

  // Enforce minShareBps floor — anyone below the floor (except current
  // creator) gets dropped and their share rolls up to current.
  for (let i = 0; i < currentIdx; i++) {
    if (shares[i]! > 0 && shares[i]! < config.minShareBps) {
      shares[currentIdx]! += shares[i]!;
      shares[i] = 0;
    }
  }

  return shares;
}

/**
 * Sanity-check that a derived split adds to exactly TOTAL_BPS.
 * Used in tests + as a guardrail on persisted policies.
 */
export function assertTotalsToHundredPercent(shares: number[]): void {
  const sum = shares.reduce((a, b) => a + b, 0);
  if (sum !== TOTAL_BPS) {
    throw new Error(`Royalty shares sum to ${sum}, expected ${TOTAL_BPS}`);
  }
}
