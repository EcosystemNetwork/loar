/**
 * Per-provider concurrency limiter with cross-instance coordination.
 *
 * Two modes, picked automatically at runtime:
 *
 *   1. **Redis mode** (REDIS_URL set + reachable): uses a per-provider sorted
 *      set keyed `llm:inflight:{provider}`. Each in-flight call adds a token
 *      with the current timestamp as score; stale entries (>60s) are swept
 *      on each acquire so a crashed process can't permanently consume slots.
 *      A 5-call Lua script makes the check-and-add atomic.
 *
 *   2. **In-process mode** (no Redis): plain semaphore + FIFO queue, sized
 *      from the same env caps. Adequate for single-instance deploys but
 *      under-caps the fleet when you scale horizontally.
 *
 * If Redis is configured but a command fails, we degrade to in-process
 * mode for that call rather than blocking the dispatch. The next call
 * retries Redis.
 *
 * Defaults (per-instance for in-process; fleet-wide when Redis-backed):
 *   openai:    50    gemini:    50
 *   groq:      15    zai:       30
 *   bytedance: 30    default:   20
 *
 * Override per-provider:
 *   LLM_CONCURRENCY_OPENAI=100  LLM_CONCURRENCY_GROQ=10  …
 *
 * Disable the limiter entirely with `LLM_CONCURRENCY_OFF=1` (testing only).
 */

import { randomUUID } from 'node:crypto';
import { getRedisClient } from './redis';

const DEFAULT_LIMITS: Record<string, number> = {
  openai: 50,
  gemini: 50,
  groq: 15,
  zai: 30,
  bytedance: 30,
  default: 20,
};

const STALE_TTL_MS = 60_000;
const REDIS_RETRY_BACKOFF_MS = 50;
const REDIS_RETRY_JITTER_MS = 100;
const REDIS_KEY_TTL_SEC = 120;

function envCap(provider: string): number | undefined {
  const key = `LLM_CONCURRENCY_${provider.toUpperCase()}`;
  const raw = process.env[key];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function limitFor(provider: string): number {
  return envCap(provider) ?? DEFAULT_LIMITS[provider] ?? DEFAULT_LIMITS.default;
}

// ── In-process gate ────────────────────────────────────────────────────

interface ProviderGate {
  active: number;
  cap: number;
  queue: Array<() => void>;
}

const localGates = new Map<string, ProviderGate>();

function localGateFor(provider: string): ProviderGate {
  let g = localGates.get(provider);
  if (!g) {
    g = { active: 0, cap: limitFor(provider), queue: [] };
    localGates.set(provider, g);
  } else {
    // Re-sample env cap so runtime tuning works.
    g.cap = limitFor(provider);
  }
  return g;
}

async function acquireLocal(g: ProviderGate): Promise<void> {
  if (g.active < g.cap) {
    g.active += 1;
    return;
  }
  await new Promise<void>((resolve) => g.queue.push(resolve));
}

function releaseLocal(g: ProviderGate): void {
  g.active = Math.max(0, g.active - 1);
  const next = g.queue.shift();
  if (next) {
    g.active += 1;
    next();
  }
}

// ── Redis-backed gate ──────────────────────────────────────────────────

// Atomic: sweep stale entries, count, and (if under cap) add ourselves.
// Returns 1 if we won a slot, 0 if we should retry.
const ACQUIRE_SCRIPT = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[1])
  local count = redis.call('ZCARD', KEYS[1])
  if count < tonumber(ARGV[2]) then
    redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
    redis.call('EXPIRE', KEYS[1], ARGV[5])
    return 1
  end
  return 0
`;

interface RedisAcquireResult {
  token: string;
  key: string;
}

async function acquireRedis(client: any, provider: string): Promise<RedisAcquireResult | null> {
  const cap = limitFor(provider);
  const key = `llm:inflight:${provider}`;
  const token = randomUUID();
  const deadline = Date.now() + 30_000; // 30s safety bound on the wait

  while (Date.now() < deadline) {
    const now = Date.now();
    const cutoff = now - STALE_TTL_MS;
    try {
      const r = await client.eval(
        ACQUIRE_SCRIPT,
        1,
        key,
        String(cutoff),
        String(cap),
        String(now),
        token,
        String(REDIS_KEY_TTL_SEC)
      );
      if (r === 1) return { token, key };
    } catch (err) {
      console.warn(
        `[rate-limit] Redis acquire failed for ${provider}, falling back to in-process:`,
        (err as Error).message
      );
      return null;
    }
    // Back off with jitter to avoid synchronized retry storms.
    const backoff = REDIS_RETRY_BACKOFF_MS + Math.random() * REDIS_RETRY_JITTER_MS;
    await new Promise((r) => setTimeout(r, backoff));
  }
  console.warn(
    `[rate-limit] Redis acquire timeout (30s) for ${provider} cap=${cap}, falling back to in-process`
  );
  return null;
}

async function releaseRedis(client: any, acquired: RedisAcquireResult): Promise<void> {
  try {
    await client.zrem(acquired.key, acquired.token);
  } catch (err) {
    // Stale token will be swept by the next acquire's ZREMRANGEBYSCORE.
    console.warn('[rate-limit] Redis release failed (will self-heal):', (err as Error).message);
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Run `fn` under the per-provider concurrency cap. Uses Redis for fleet-wide
 * coordination when available; otherwise per-process semaphore.
 *
 * Excess callers wait FIFO (in-process) or poll with jittered backoff
 * (Redis). Stale slots from crashed processes self-heal after STALE_TTL_MS.
 */
export async function withProviderRateLimit<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.LLM_CONCURRENCY_OFF === '1') {
    return fn();
  }

  const client = getRedisClient();
  if (client) {
    const acquired = await acquireRedis(client, provider);
    if (acquired) {
      try {
        return await fn();
      } finally {
        await releaseRedis(client, acquired);
      }
    }
    // Redis path failed; fall through to in-process.
  }

  const g = localGateFor(provider);
  await acquireLocal(g);
  try {
    return await fn();
  } finally {
    releaseLocal(g);
  }
}

/** Test-only: in-process gate snapshot. */
export function _rateLimitSnapshot(provider: string): {
  active: number;
  cap: number;
  queued: number;
} {
  const g = localGates.get(provider);
  if (!g) return { active: 0, cap: limitFor(provider), queued: 0 };
  return { active: g.active, cap: g.cap, queued: g.queue.length };
}
