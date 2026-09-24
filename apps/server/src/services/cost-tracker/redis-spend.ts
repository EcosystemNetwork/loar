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
 * Storage is in **micro-dollars** (integers, 1e-6 USD) to avoid float drift
 * across many small INCRBY's. Whole cents would silently drop every
 * sub-cent call (most LLM/TTS calls cost < $0.01), so those never counted
 * toward a cap. Conversion happens at the public API boundary.
 *
 * On top of the spent counters sits an atomic **reservation** ("hold")
 * primitive — `reserveRedisSpend`. Spend is only recorded once a paid call
 * finishes, which for video/3D can be minutes; without a hold, every call in
 * that window sees the cap as unspent. A hold books the *estimated* cost
 * up-front, in one Lua script across every scope that has a cap, so
 * `spent + held + estimate > cap` is rejected atomically and all-or-nothing.
 * Holds are released by the caller after the actual cost is recorded, and
 * carry an expiry so a crashed process can't leak budget forever.
 *
 * Failure mode: any Redis error degrades to "Redis unavailable" and the
 * caller falls back to the Firestore aggregate path. Caps remain soft
 * during Redis outages but never harder than the previous behavior.
 */

import { randomUUID } from 'node:crypto';
import { getRedisClient } from '../../lib/redis';
import { db, firebaseAvailable } from '../../lib/firebase';

const MICROS_PER_USD = 1_000_000;
const DAY_SECONDS = 24 * 60 * 60;
const KEY_TTL_SEC = DAY_SECONDS + 6 * 3600; // expires ~6h after the day rolls over

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// `usd6` (micro-dollars) — deliberately a new namespace from the old whole-cent
// `cost:spent:` keys, which just expire; counters re-hydrate from Firestore.
function spendKey(scope: string, key: string): string {
  return `cost:usd6:spent:${scope}:${key}:${dayKey()}`;
}

function heldKey(scope: string, key: string): string {
  return `cost:usd6:held:${scope}:${key}:${dayKey()}`;
}

export function usdToMicros(usd: number): number {
  return Number.isFinite(usd) && usd > 0 ? Math.floor(usd * MICROS_PER_USD) : 0;
}

// Per-process memo of which keys have been hydrated from Firestore in
// this runtime. Once hydrated, subsequent reads stay on the Redis hot
// path. Reset on process restart — that's the intended scope.
const hydrated = new Set<string>();

async function readFirestoreAggregateMicros(scope: string, key: string): Promise<number> {
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
      '[redis-spend] hydrate from Firestore failed, treating as 0:',
      (err as Error).message
    );
    return 0;
  }
  return Math.max(0, Math.round(totalUsd * MICROS_PER_USD));
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
  const micros = usdToMicros(costUsd);
  if (micros <= 0) return;
  const k = spendKey(scope, key);
  try {
    await client.eval(INCR_SCRIPT, 1, k, String(micros), String(KEY_TTL_SEC));
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
    if (raw !== null) return Number(raw) / MICROS_PER_USD;
    // Cold counter — hydrate atomically. SETNX guarantees only one
    // hydration write wins; concurrent callers all converge to the same
    // value because they all read the same Firestore total.
    if (hydrated.has(k)) return 0; // already hydrated to zero in this runtime
    hydrated.add(k);
    const micros = await readFirestoreAggregateMicros(scope, key);
    try {
      // ioredis: set(key, value, 'EX', seconds, 'NX')
      await client.set(k, String(micros), 'EX', KEY_TTL_SEC, 'NX');
    } catch {
      // Race or transient — treat as zero this read; next read will see
      // the value some other instance wrote.
    }
    return micros / MICROS_PER_USD;
  } catch (err) {
    console.warn('[redis-spend] read failed, returning null for fallback:', (err as Error).message);
    return null;
  }
}

// ── Reservations (holds) ──────────────────────────────────────────────

/** Default lifetime of a hold — a safety net for crashed callers, not a timeout on the call. */
export const DEFAULT_HOLD_TTL_SEC = 15 * 60;

export interface HoldTarget {
  scope: string;
  key: string;
  /** Daily cap for this scope, in USD. */
  capUsd: number;
}

export interface RedisHold {
  id: string;
  micros: number;
  targets: Array<{ scope: string; key: string }>;
}

export type ReserveOutcome =
  | { status: 'reserved'; hold: RedisHold }
  | {
      status: 'denied';
      scope: string;
      capUsd: number;
      /** spent + already-held for the denying scope, in USD (excludes this request). */
      committedUsd: number;
    }
  // Redis absent/erroring — caller degrades to the soft Firestore-aggregate check.
  | { status: 'unavailable' };

/**
 * Check-and-hold across every target in one atomic script.
 *
 * KEYS  = [spent_1, held_1, spent_2, held_2, ...]
 * ARGV  = [now_ms, member, expire_at_ms, key_ttl_sec, micros, cap_1, cap_2, ...]
 *
 * Held members are `<holdId>|<micros>` in a ZSET scored by expiry, so expired
 * holds are purged (ZREMRANGEBYSCORE) inside the same script that sums the
 * live ones. Nothing is written unless EVERY scope has room.
 *
 * Multi-key script: fine on a single Redis instance (Railway). On Redis
 * Cluster the keys would need a shared hash tag.
 */
const RESERVE_SCRIPT = `
  local now = tonumber(ARGV[1])
  local micros = tonumber(ARGV[5])
  local n = #KEYS / 2
  for i = 1, n do
    local held = KEYS[2 * i]
    redis.call('ZREMRANGEBYSCORE', held, '-inf', now)
    local heldSum = 0
    for _, m in ipairs(redis.call('ZRANGE', held, 0, -1)) do
      heldSum = heldSum + (tonumber(string.match(m, '|(%d+)$')) or 0)
    end
    local raw = redis.call('GET', KEYS[2 * i - 1])
    local spent = raw and tonumber(raw) or 0
    if spent + heldSum + micros > tonumber(ARGV[5 + i]) then
      return {0, i, spent, heldSum}
    end
  end
  for i = 1, n do
    redis.call('ZADD', KEYS[2 * i], ARGV[3], ARGV[2])
    redis.call('EXPIRE', KEYS[2 * i], ARGV[4])
  end
  return {1}
`;

export async function reserveRedisSpend(
  targets: HoldTarget[],
  estimatedUsd: number,
  ttlSec: number = DEFAULT_HOLD_TTL_SEC
): Promise<ReserveOutcome> {
  const client = getRedisClient();
  if (!client || targets.length === 0) return { status: 'unavailable' };
  // Round UP: a hold must never under-book the call it protects.
  const micros = Math.max(1, Math.ceil(estimatedUsd * MICROS_PER_USD));
  try {
    // Warm each spent counter so a cold key reads as the Firestore total, not 0.
    for (const t of targets) {
      if ((await readRedisSpend(t.scope, t.key)) === null) return { status: 'unavailable' };
    }
    const id = randomUUID();
    const now = Date.now();
    const keys = targets.flatMap((t) => [spendKey(t.scope, t.key), heldKey(t.scope, t.key)]);
    const caps = targets.map((t) => String(Math.floor(t.capUsd * MICROS_PER_USD)));
    const res = (await client.eval(
      RESERVE_SCRIPT,
      keys.length,
      ...keys,
      String(now),
      `${id}|${micros}`,
      String(now + ttlSec * 1000),
      String(KEY_TTL_SEC),
      String(micros),
      ...caps
    )) as number[];
    if (res[0] === 1) {
      return {
        status: 'reserved',
        hold: { id, micros, targets: targets.map(({ scope, key }) => ({ scope, key })) },
      };
    }
    const denying = targets[res[1] - 1];
    return {
      status: 'denied',
      scope: denying.scope,
      capUsd: denying.capUsd,
      committedUsd: (Number(res[2]) + Number(res[3])) / MICROS_PER_USD,
    };
  } catch (err) {
    console.warn('[redis-spend] reserve failed, degrading to soft check:', (err as Error).message);
    return { status: 'unavailable' };
  }
}

/** Drop a hold. Idempotent; best-effort (the hold's expiry is the backstop). */
export async function releaseRedisHold(hold: RedisHold): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  const member = `${hold.id}|${hold.micros}`;
  try {
    await Promise.all(hold.targets.map((t) => client.zrem(heldKey(t.scope, t.key), member)));
  } catch (err) {
    console.warn('[redis-spend] release failed (hold will expire):', (err as Error).message);
  }
}
