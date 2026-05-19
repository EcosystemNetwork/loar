/**
 * Redis-backed atomic daily-spend counter.
 *
 * Solves the "cap stampede" race in cost-controls.assertProviderAllowed:
 * the previous design read an eventually-consistent Firestore aggregate
 * for cap checks, which lagged real spend by seconds. Under burst load
 * 100 concurrent callers could all see spent=$0 against a $5 cap and
 * pass preflight, then each fire, blowing the cap by 50×.
 *
 * Redis INCRBY is atomic and microsecond-fast, so the read-vs-write
 * window closes to the duration of a single network round-trip. We
 * write-through:
 *
 *   1. recordProviderCost commits the Firestore aggregate batch (auth
 *      ledger; survives Redis loss).
 *   2. Then increments the Redis counter (fast read path for caps).
 *
 * The Firestore aggregate remains the source of truth. Redis is a
 * fast-read cache that's hydrated lazily on first cap-check via SETNX
 * from the canonical Firestore total.
 *
 * Storage is in **cents** (integers) to avoid float drift across many
 * small INCRBY's. Conversion happens at the public API boundary.
 *
 * Failure mode: any Redis error degrades to "Redis unavailable" and the
 * caller falls back to the Firestore aggregate path. Caps remain soft
 * during Redis outages but never harder than the previous behavior.
 */

import { getRedisClient } from '../../lib/redis';
import { db, firebaseAvailable } from '../../lib/firebase';

const DAY_SECONDS = 24 * 60 * 60;
const KEY_TTL_SEC = DAY_SECONDS + 6 * 3600; // expires ~6h after the day rolls over

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function spendKey(scope: string, key: string): string {
  return `cost:spent:${scope}:${key}:${dayKey()}`;
}

// Per-process memo of which keys have been hydrated from Firestore in
// this runtime. Once hydrated, subsequent reads stay on the Redis hot
// path. Reset on process restart — that's the intended scope.
const hydrated = new Set<string>();

async function readFirestoreAggregateCents(scope: string, key: string): Promise<number> {
  if (!firebaseAvailable) return 0;
  let totalUsd = 0;
  try {
    if (scope === 'platform') {
      const { PLATFORM_SHARD_COUNT } = await import('./record');
      const refs = Array.from({ length: PLATFORM_SHARD_COUNT }, (_, i) =>
        db.collection('costAggregates').doc(`${dayKey()}__platform__${key}__shard${i}`)
      );
      const snaps = await db.getAll(...refs);
      totalUsd = snaps.reduce((s, doc) => s + Number(doc.data()?.costUsd ?? 0), 0);
    } else {
      const doc = await db.collection('costAggregates').doc(`${dayKey()}__${scope}__${key}`).get();
      totalUsd = Number(doc.data()?.costUsd ?? 0);
    }
  } catch (err) {
    console.warn(
      '[redis-spend] hydrate from Firestore failed, treating as 0 cents:',
      (err as Error).message
    );
    return 0;
  }
  return Math.max(0, Math.floor(totalUsd * 100));
}

const INCR_SCRIPT = `
  local v = redis.call('INCRBY', KEYS[1], ARGV[1])
  redis.call('EXPIRE', KEYS[1], ARGV[2])
  return v
`;

/**
 * Atomically increment the daily spend counter for (scope, key) by the
 * given cost. No-op if Redis is unavailable.
 */
export async function incrementRedisSpend(
  scope: string,
  key: string,
  costUsd: number
): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  const cents = Math.floor(costUsd * 100);
  if (cents <= 0) return;
  const k = spendKey(scope, key);
  try {
    await client.eval(INCR_SCRIPT, 1, k, String(cents), String(KEY_TTL_SEC));
  } catch (err) {
    // Best-effort — the Firestore aggregate write is authoritative.
    console.warn('[redis-spend] increment failed:', (err as Error).message);
  }
}

/**
 * Read the daily spend in USD for (scope, key). Returns:
 *   - the Redis counter's value (in USD) when Redis is available
 *   - hydrates from Firestore on first cache miss per (key, runtime)
 *   - `null` when Redis is unavailable (caller falls back to Firestore)
 */
export async function readRedisSpend(scope: string, key: string): Promise<number | null> {
  const client = getRedisClient();
  if (!client) return null;
  const k = spendKey(scope, key);
  try {
    const raw = await client.get(k);
    if (raw !== null) return Number(raw) / 100;
    // Cold counter — hydrate atomically. SETNX guarantees only one
    // hydration write wins; concurrent callers all converge to the same
    // value because they all read the same Firestore total.
    if (hydrated.has(k)) return 0; // already hydrated to zero in this runtime
    hydrated.add(k);
    const cents = await readFirestoreAggregateCents(scope, key);
    try {
      // ioredis: set(key, value, 'EX', seconds, 'NX')
      await client.set(k, String(cents), 'EX', KEY_TTL_SEC, 'NX');
    } catch {
      // Race or transient — treat as zero this read; next read will see
      // the value some other instance wrote.
    }
    return cents / 100;
  } catch (err) {
    console.warn('[redis-spend] read failed, returning null for fallback:', (err as Error).message);
    return null;
  }
}
