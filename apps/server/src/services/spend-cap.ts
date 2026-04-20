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
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = 30_000;

interface SpendCacheEntry {
  totalCredits: number;
  computedAt: number;
}

const spendCache = new Map<string, SpendCacheEntry>();
const dailySpendCache = new Map<string, SpendCacheEntry>();

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

  // `createdAt` is written as `new Date()` and serialises to a Firestore
  // Timestamp; comparing against an ISO string never matches (Timestamp <
  // String in Firestore's type ordering), so the query must pass a Date.
  const since = new Date(now - WINDOW_MS);
  let total = 0;

  // Uses the existing (uid ASC, createdAt DESC) composite index.
  // Filter by `type == 'spend'` in memory — a normal user has ≤100 rows in
  // a 30-day window; adding a new composite index just for this is a waste.
  // No try/catch wrapper: a Firestore read failure must NOT silently disable
  // the spend cap. Bubble the error so the request 500s and the operator
  // sees it; flip the kill switch in /admin/ops if a wider outage requires it.
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

  spendCache.set(uid, { totalCredits: total, computedAt: now });
  return total;
}

/** Rolling 24h spend, cached 30s. Mirrors the 30d helper; separate cache so the
 *  two windows don't fight over the same key. */
export async function getDailySpend(uid: string): Promise<number> {
  const now = Date.now();
  const cached = dailySpendCache.get(uid);
  if (cached && now - cached.computedAt < CACHE_TTL_MS) return cached.totalCredits;
  if (!db) return 0;

  const since = new Date(now - DAILY_WINDOW_MS);
  let total = 0;
  const snap = await db
    .collection('creditTransactions')
    .where('uid', '==', uid)
    .where('createdAt', '>=', since)
    .get();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data?.type !== 'spend') continue;
    const c = data.credits;
    if (typeof c === 'number') total += Math.abs(c);
  }
  dailySpendCache.set(uid, { totalCredits: total, computedAt: now });
  return total;
}

/** Invalidate cache for one wallet (call after recording a spend). */
export function invalidateSpendCache(uid: string): void {
  spendCache.delete(uid);
  dailySpendCache.delete(uid);
}

export class MonthlySpendCapExceededError extends Error {
  readonly code = 'SPEND_CAP_EXCEEDED';
  readonly spent: number;
  readonly cap: number;
  readonly requested: number;
  readonly window: 'daily' | 'monthly';
  constructor(
    spent: number,
    cap: number,
    requested: number,
    window: 'daily' | 'monthly' = 'monthly'
  ) {
    super(
      `${window === 'daily' ? 'Daily' : 'Monthly'} spend cap reached (${spent}/${cap} credits used, ` +
        `this job would add ${requested}). Caps reset on a rolling ${window === 'daily' ? '24-hour' : '30-day'} window.`
    );
    this.spent = spent;
    this.cap = cap;
    this.requested = requested;
    this.window = window;
    this.name = 'MonthlySpendCapExceededError';
  }
}

/**
 * Throws `MonthlySpendCapExceededError` when this charge would exceed the cap.
 * Both the 24h and 30d windows are checked; the daily cap is a second-layer
 * backstop against bursty abuse even when users have plenty of monthly headroom.
 * No-op when both caps are disabled in platformConfig.
 */
export async function assertSpendAllowed(uid: string, creditsToCharge: number): Promise<void> {
  const cfg = await getPlatformConfig();

  if (cfg.dailySpendCapEnabled && cfg.dailySpendCapCredits > 0) {
    const dailySpent = await getDailySpend(uid);
    if (dailySpent + creditsToCharge > cfg.dailySpendCapCredits) {
      throw new MonthlySpendCapExceededError(
        dailySpent,
        cfg.dailySpendCapCredits,
        creditsToCharge,
        'daily'
      );
    }
  }

  if (cfg.monthlySpendCapEnabled && cfg.monthlySpendCapCredits > 0) {
    const spent = await getMonthlySpend(uid);
    if (spent + creditsToCharge > cfg.monthlySpendCapCredits) {
      throw new MonthlySpendCapExceededError(
        spent,
        cfg.monthlySpendCapCredits,
        creditsToCharge,
        'monthly'
      );
    }
  }
}
