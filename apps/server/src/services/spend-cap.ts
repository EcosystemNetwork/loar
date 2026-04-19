/**
 * Per-wallet monthly credit spend cap.
 *
 * Reads the rolling 30-day spend total from `creditTransactions` and compares
 * against `platformConfig.monthlySpendCapCredits`. Calls `assertSpendAllowed`
 * from generation + other credit-burning routes *before* `deductCredits`.
 *
 * Why a rolling window (not calendar month): calendar month creates an edge
 * where an attacker burns the cap on the 31st then again on the 1st. 30-day
 * rolling closes that.
 *
 * A small in-process cache smooths read pressure — Firestore reads are the
 * bottleneck at 10K users, not the math.
 */
import { db } from '../lib/firebase';
import { getPlatformConfig } from './platformConfig';

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 30_000;

interface SpendCacheEntry {
  totalCredits: number;
  computedAt: number;
}

const spendCache = new Map<string, SpendCacheEntry>();

/**
 * Sum credits a wallet has spent in the last 30 days.
 * Cached per-uid for 30s — safe because the cap only matters at the boundary,
 * and small overshoot is acceptable.
 */
export async function getMonthlySpend(uid: string): Promise<number> {
  const now = Date.now();
  const cached = spendCache.get(uid);
  if (cached && now - cached.computedAt < CACHE_TTL_MS) {
    return cached.totalCredits;
  }

  if (!db) {
    // Degraded mode: can't read Firestore — fail open.
    return 0;
  }

  const since = new Date(now - WINDOW_MS).toISOString();
  let total = 0;

  try {
    // Uses the existing (uid ASC, createdAt DESC) composite index.
    // Filter by `type == 'spend'` in memory — a normal user has ≤100 rows in
    // a 30-day window; adding a new composite index just for this is a waste.
    const snap = await db
      .collection('creditTransactions')
      .where('uid', '==', uid)
      .where('createdAt', '>=', since)
      .get();

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data?.type !== 'spend') continue;
      const c = data.credits;
      // Spend rows store credits as a negative number (see deductCredits
      // implementations). Normalise to the absolute magnitude spent.
      if (typeof c === 'number') total += Math.abs(c);
    }
  } catch {
    // Index missing or other read failure → fail open rather than block users.
    return 0;
  }

  spendCache.set(uid, { totalCredits: total, computedAt: now });
  return total;
}

/** Invalidate cache for one wallet (call after recording a spend). */
export function invalidateSpendCache(uid: string): void {
  spendCache.delete(uid);
}

export class MonthlySpendCapExceededError extends Error {
  readonly code = 'SPEND_CAP_EXCEEDED';
  readonly spent: number;
  readonly cap: number;
  readonly requested: number;
  constructor(spent: number, cap: number, requested: number) {
    super(
      `Monthly spend cap reached (${spent}/${cap} credits used, ` +
        `this job would add ${requested}). Caps reset on a 30-day rolling window.`
    );
    this.spent = spent;
    this.cap = cap;
    this.requested = requested;
    this.name = 'MonthlySpendCapExceededError';
  }
}

/**
 * Throws `MonthlySpendCapExceededError` when this charge would exceed the cap.
 * No-op when the cap is disabled in platformConfig.
 */
export async function assertSpendAllowed(uid: string, creditsToCharge: number): Promise<void> {
  const cfg = await getPlatformConfig();
  if (!cfg.monthlySpendCapEnabled) return;
  if (cfg.monthlySpendCapCredits <= 0) return;

  const spent = await getMonthlySpend(uid);
  if (spent + creditsToCharge > cfg.monthlySpendCapCredits) {
    throw new MonthlySpendCapExceededError(spent, cfg.monthlySpendCapCredits, creditsToCharge);
  }
}
