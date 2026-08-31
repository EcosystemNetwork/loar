/**
 * Points ledger — a gamification score, deliberately separate from the
 * credits/points *spend* ledger (`userCredits`, services/credits). This one
 * only ever goes up. It rewards activity:
 *
 *   - Universe creation : POINTS_PER_UNIVERSE   (awarded once per universe)
 *   - Each generation   : POINTS_PER_GENERATION (awarded once per request)
 *
 * Storage:
 *   userPoints/{userId}      — materialized totals for fast leaderboard reads
 *                              { userId, points, universeCount, generationCount,
 *                                updatedAt }
 *   pointsEvents/{dedupeKey} — append-only; doubles as the idempotency guard
 *                              and an audit trail
 *                              { userId, kind, amount, route, meta, createdAt }
 *
 * Design rules (mirrors services/prompt-log):
 *   - NEVER throw. Awarding points must not break the path that earned them.
 *   - `awardPoints()` is a Firestore transaction keyed on `dedupeKey`; a
 *     replay is a no-op, so callers can fire it more than once safely.
 *   - Generation awards read attribution from the ambient cost scope
 *     (AsyncLocalStorage) and reuse prompt-log's generation-route gating, so
 *     one call site in `sanitizePrompt()` covers every generation path.
 *
 * Disable entirely with POINTS_ENABLED=false.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { db, firebaseAvailable } from '../../lib/firebase';
import { getCostScope } from '../cost-tracker/scope';
import { isGenerationRoute } from '../prompt-log';

const ENABLED = (process.env.POINTS_ENABLED ?? 'true').toLowerCase() !== 'false';

export const POINTS_PER_UNIVERSE = 10;
export const POINTS_PER_GENERATION = 10;

export type PointsKind = 'universe' | 'generation';

/** Which materialized counter a kind bumps alongside `points`. */
const COUNTER_FIELD: Record<PointsKind, string> = {
  universe: 'universeCount',
  generation: 'generationCount',
};

// ── In-process fallback dedupe ──────────────────────────────────────────
// Used only when a caller has no stable request id. A single generate
// request calls sanitizePrompt() several times (prompt + negativePrompt,
// per-message LLM content); collapse those to one award per (user, route)
// for a short window. Bounded map with lazy sweep — same shape as
// prompt-log's isFreshCapture().

const FALLBACK_TTL_MS = 90_000;
const seen = new Map<string, number>();

function isFreshAward(key: string): boolean {
  const now = Date.now();
  if (seen.size > 10_000) {
    for (const [k, exp] of seen) if (exp <= now) seen.delete(k);
  }
  const exp = seen.get(key);
  if (exp && exp > now) return false;
  seen.set(key, now + FALLBACK_TTL_MS);
  return true;
}

// ── Award ──────────────────────────────────────────────────────────────

export interface AwardPointsOpts {
  userId: string;
  kind: PointsKind;
  amount: number;
  /** Deterministic key — one award per key, replays are no-ops. */
  dedupeKey: string;
  route?: string | null;
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * Idempotently credit `amount` points to a user. Safe to call from any
 * path — no-ops when Firestore / the feature is unavailable, when the key
 * was already awarded, or on any error. Never throws.
 */
export async function awardPoints(opts: AwardPointsOpts): Promise<void> {
  try {
    if (!ENABLED || !firebaseAvailable || !db) return;
    const userId = opts.userId?.toLowerCase?.();
    if (!userId || !Number.isFinite(opts.amount) || opts.amount <= 0) return;

    const eventRef = db.collection('pointsEvents').doc(opts.dedupeKey);
    const totalsRef = db.collection('userPoints').doc(userId);
    const counter = COUNTER_FIELD[opts.kind];
    const now = new Date();

    await db.runTransaction(async (tx) => {
      const existing = await tx.get(eventRef);
      if (existing.exists) return; // already awarded — replay
      tx.set(eventRef, {
        userId,
        kind: opts.kind,
        amount: opts.amount,
        route: opts.route ?? null,
        meta: opts.meta ?? null,
        createdAt: now,
      });
      tx.set(
        totalsRef,
        {
          userId,
          points: FieldValue.increment(opts.amount),
          [counter]: FieldValue.increment(1),
          updatedAt: now,
        },
        { merge: true }
      );
    });
  } catch (err) {
    console.error('[points] award failed:', (err as Error)?.message ?? err);
  }
}

/**
 * Award the flat universe-creation bonus. Call after the universe row is
 * persisted. Idempotent per universe address.
 */
export async function awardUniverseCreationPoints(
  userId: string | null | undefined,
  universeAddress: string
): Promise<void> {
  if (!userId || !universeAddress) return;
  const addr = universeAddress.toLowerCase();
  await awardPoints({
    userId,
    kind: 'universe',
    amount: POINTS_PER_UNIVERSE,
    dedupeKey: `universe:${addr}`,
    route: getCostScope().route ?? null,
    meta: { universeAddress: addr },
  });
}

/**
 * Award the per-generation bonus for the current request. Reads userId /
 * route / requestId from the ambient cost scope and reuses prompt-log's
 * generation-route gating, so it no-ops for system calls, non-generation
 * routes, and anonymous requests. Fire-and-forget — do not await upstream.
 */
export function awardGenerationPoints(): void {
  try {
    if (!ENABLED || !firebaseAvailable || !db) return;
    const scope = getCostScope();
    const userId = scope.userId;
    if (!userId) return;
    if (!isGenerationRoute(scope.route)) return;

    const dedupeKey = scope.requestId ? `gen:${scope.requestId}` : null;

    // No request id — fall back to a short in-process window so the
    // several sanitize() calls in one request still award only once.
    if (!dedupeKey) {
      if (!isFreshAward(`gen:${userId}:${scope.route ?? ''}`)) return;
      void awardPoints({
        userId,
        kind: 'generation',
        amount: POINTS_PER_GENERATION,
        dedupeKey: `gen:${userId}:${scope.route ?? ''}:${Date.now()}`,
        route: scope.route ?? null,
      });
      return;
    }

    void awardPoints({
      userId,
      kind: 'generation',
      amount: POINTS_PER_GENERATION,
      dedupeKey,
      route: scope.route ?? null,
    });
  } catch (err) {
    console.error('[points] generation award error:', (err as Error)?.message ?? err);
  }
}

// ── Read side ──────────────────────────────────────────────────────────

export interface LeaderboardRow {
  rank: number;
  userId: string;
  points: number;
  universeCount: number;
  generationCount: number;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

/**
 * Top users by points, desc. Joins `profiles/{uid}` for display fields.
 * `userPoints` is ordered by a single field so no composite index is
 * needed.
 */
export async function getLeaderboard(limit = 50): Promise<LeaderboardRow[]> {
  if (!firebaseAvailable || !db) return [];
  const snap = await db
    .collection('userPoints')
    .orderBy('points', 'desc')
    .limit(Math.min(Math.max(limit, 1), 100))
    .get();

  const rows = snap.docs.map((d, i) => {
    const data = d.data();
    return {
      rank: i + 1,
      userId: String(data.userId ?? d.id),
      points: Number(data.points ?? 0),
      universeCount: Number(data.universeCount ?? 0),
      generationCount: Number(data.generationCount ?? 0),
      username: null as string | null,
      displayName: null as string | null,
      avatarUrl: null as string | null,
    };
  });

  // Hydrate profile fields in one batched read.
  await Promise.all(
    rows.map(async (row) => {
      try {
        const p = await db!.collection('profiles').doc(row.userId).get();
        if (!p.exists) return;
        const pd = p.data()!;
        row.username = (pd.username as string) ?? null;
        row.displayName = (pd.displayName as string) ?? null;
        row.avatarUrl = (pd.avatarUrl as string) || null;
      } catch {
        /* profile hydrate is best-effort */
      }
    })
  );

  return rows;
}

export interface MyPoints {
  userId: string;
  points: number;
  universeCount: number;
  generationCount: number;
  rank: number | null;
}

/** Current user's totals + rank (1-based; null if they have no points). */
export async function getMyPoints(userId: string): Promise<MyPoints> {
  const uid = userId.toLowerCase();
  const empty: MyPoints = {
    userId: uid,
    points: 0,
    universeCount: 0,
    generationCount: 0,
    rank: null,
  };
  if (!firebaseAvailable || !db) return empty;

  const doc = await db.collection('userPoints').doc(uid).get();
  if (!doc.exists) return empty;
  const data = doc.data()!;
  const points = Number(data.points ?? 0);

  let rank: number | null = null;
  if (points > 0) {
    try {
      const ahead = await db.collection('userPoints').where('points', '>', points).count().get();
      rank = ahead.data().count + 1;
    } catch {
      /* rank is best-effort */
    }
  }

  return {
    userId: uid,
    points,
    universeCount: Number(data.universeCount ?? 0),
    generationCount: Number(data.generationCount ?? 0),
    rank,
  };
}
