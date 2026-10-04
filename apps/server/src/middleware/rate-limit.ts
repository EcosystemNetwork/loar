import type { Context, Next } from 'hono';

// ── Backing store interface ─────────────────────────────────────────────

interface RateLimitStore {
  /** Returns remaining tokens and applies a decrement. */
  consume(
    key: string,
    windowMs: number,
    max: number
  ): Promise<{ remaining: number; blocked: boolean }>;
}

// ── In-memory store (default, single-process) ───────────────────────────

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const MAX_BUCKETS = 100_000;

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();

  constructor() {
    // Clean up stale buckets every 2 minutes
    setInterval(
      () => {
        const staleThreshold = Date.now() - 10 * 60 * 1000;
        for (const [key, bucket] of this.buckets.entries()) {
          if (bucket.lastRefill < staleThreshold) {
            this.buckets.delete(key);
          }
        }
      },
      2 * 60 * 1000
    );
  }

  private evictOldest() {
    if (this.buckets.size < MAX_BUCKETS) return;
    const lastRefills: number[] = [];
    for (const bucket of this.buckets.values()) lastRefills.push(bucket.lastRefill);
    lastRefills.sort((a, b) => a - b);
    const p10Index = Math.floor(lastRefills.length * 0.1);
    const cutoff = lastRefills[p10Index] ?? lastRefills[lastRefills.length - 1] ?? 0;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.lastRefill <= cutoff) this.buckets.delete(key);
    }
  }

  async consume(key: string, windowMs: number, max: number) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.lastRefill > windowMs) {
      bucket = { tokens: max, lastRefill: now };
    }

    if (bucket.tokens <= 0) {
      return { remaining: 0, blocked: true };
    }

    bucket.tokens--;
    if (!this.buckets.has(key) && this.buckets.size >= MAX_BUCKETS) {
      this.evictOldest();
    }
    this.buckets.set(key, bucket);
    return { remaining: bucket.tokens, blocked: false };
  }
}

// ── Redis store (multi-instance production) ─────────────────────────────

class RedisStore implements RateLimitStore {
  /** In-memory fallback used when Redis is unavailable (fail-closed, not fail-open) */
  private memoryFallback = new MemoryStore();

  /**
   * F9: INCR the window counter and set its expiry in the SAME atomic step.
   * The old `MULTI incr/ttl` + follow-up `EXPIRE` had a gap: a crash (or a
   * transient error) between the two left `rl:<key>` with no TTL, so once its
   * counter passed `max` that key blocked the client forever (the Redis store
   * has no stale-key sweep, unlike MemoryStore).
   *
   * The script also re-arms expiry if the key is somehow found without one
   * (PTTL < 0 covers both "-1 no expiry" and the "-2 vanished" race), so a
   * pre-existing wedged key self-heals on its next hit.
   *
   * Returns the post-increment counter value.
   */
  private static readonly CONSUME_LUA = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
else
  local t = redis.call('PTTL', KEYS[1])
  if t < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
end
return c
`;

  constructor() {
    // Client is managed by the shared redis.ts module
  }

  async consume(key: string, windowMs: number, max: number) {
    // Lazy-import shared client to avoid circular deps at module load time
    const { getRedisClient } = await import('../lib/redis');
    const client = getRedisClient();

    if (!client) {
      // Fail-closed: use in-memory rate limiting instead of allowing all requests
      return this.memoryFallback.consume(key, windowMs, max);
    }

    try {
      const redisKey = `rl:${key}`;

      const count = (await client.eval(
        RedisStore.CONSUME_LUA,
        1,
        redisKey,
        String(windowMs)
      )) as number;

      if (count > max) {
        return { remaining: 0, blocked: true };
      }

      return { remaining: max - count, blocked: false };
    } catch {
      // Redis error — fail-closed: fall back to in-memory limiting
      return this.memoryFallback.consume(key, windowMs, max);
    }
  }
}

// ── Store singleton ─────────────────────────────────────────────────────

let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  if (store) return store;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    store = new RedisStore();
  } else {
    store = new MemoryStore();
  }
  return store;
}

/**
 * Consume one token from a named bucket. Uses Redis when configured, in-memory
 * otherwise. Returns `blocked: true` when the bucket is exhausted.
 *
 * Intended for non-HTTP rate limiting (e.g. the public DMCA takedown form,
 * cron-triggered side-effects) that can't piggyback on the middleware. Keys
 * should be namespaced (e.g. `takedown:email:foo@bar.com`) to avoid
 * collisions with middleware buckets.
 */
export async function consumeRateLimit(
  key: string,
  windowMs: number,
  max: number
): Promise<{ remaining: number; blocked: boolean }> {
  return getStore().consume(key, windowMs, max);
}

// ── Client identification ───────────────────────────────────────────────

/**
 * Extract the client IP from trusted headers.
 *
 * Priority (when behind a trusted reverse proxy):
 *   1. x-forwarded-for — last entry (closest trusted proxy hop)
 *   2. x-real-ip — set by nginx / similar
 *   3. Connection remote address (always available)
 *
 * IMPORTANT: TRUST_PROXY must be set to 'true' for header-based extraction.
 * Without it, only the socket remote address is used — preventing IP spoofing
 * when no reverse proxy is configured. Your reverse proxy MUST strip/overwrite
 * x-forwarded-for and x-real-ip headers from the original client request.
 */
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/;
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

export function getClientKey(c: Context): string {
  // Only trust forwarding headers when explicitly behind a reverse proxy
  if (TRUST_PROXY) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      // Take the LAST entry — that's the IP your trusted proxy appended.
      const lastIp = xff.split(',').pop()?.trim();
      if (lastIp && IP_RE.test(lastIp)) return lastIp;
    }
    const realIp = c.req.header('x-real-ip');
    if (realIp && IP_RE.test(realIp)) return realIp;
  }
  // Fallback to connection-level IP — fail closed with a shared bucket rather than
  // creating a unique key per request (which would bypass rate limiting entirely)
  return (c.req.raw as any)?.socket?.remoteAddress || 'unknown-shared';
}

// ── Middleware ───────────────────────────────────────────────────────────

export function rateLimiter(opts: { windowMs: number; max: number; name: string }) {
  return async (c: Context, next: Next) => {
    // Don't rate-limit CORS preflight requests
    if (c.req.method === 'OPTIONS') return next();

    // Namespaced by bucket name so distinct mounts (blanket /*, /auth/*,
    // /api/ipfs/*, ...) each draw from their own bucket per IP instead of
    // silently colliding on bare getClientKey(c) — see index.ts call sites
    // for the "consumes from BOTH the per-route bucket AND the blanket"
    // layering this restores. Without this prefix every rateLimiter()
    // mount for the same client shared one bucket, so a single request
    // could burn 2-3 tokens across stacked mounts and the tighter/looser
    // per-route `max` values were meaningless (whichever mount initialized
    // the bucket first won).
    const key = `${opts.name}:${getClientKey(c)}`;
    const result = await getStore().consume(key, opts.windowMs, opts.max);

    c.header('X-RateLimit-Limit', String(opts.max));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    if (result.blocked) {
      c.header('Retry-After', String(Math.ceil(opts.windowMs / 1000)));
      return c.json(trpcRateLimitBody(c), 429);
    }

    await next();
  };
}

/**
 * 429 body for a blocked request. Plain `{ error: string }` for ordinary
 * routes, but /trpc/* needs a tRPC-envelope-shaped body instead: the batch
 * client (httpBatchLink) parses every response — success or error — as
 * either a single envelope or an array of them (one per batched procedure,
 * e.g. `/trpc/entities.list,universes.adminInfo,tokenGates.list?batch=1`).
 * A bare `{ error: string }` fails that parse and surfaces client-side as
 * an opaque "Unable to transform response from server" instead of a
 * legible rate-limit error. Mirrors the error shape aiRateLimiter already
 * uses for its (single-procedure) AI routes, replicated per batched
 * procedure here.
 */
function trpcRateLimitBody(c: Context): unknown {
  if (!c.req.path.startsWith('/trpc/')) {
    return { error: 'Too many requests' };
  }
  const envelope = {
    error: {
      message: 'Too many requests. Please wait before trying again.',
      code: -32029,
      data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 },
    },
  };
  const procedureCount = c.req.path.slice('/trpc/'.length).split(',').filter(Boolean).length || 1;
  return procedureCount > 1 ? Array(procedureCount).fill(envelope) : envelope;
}

/** One AI rate-limit tier: a tRPC router prefix (`generation.`) or exact procedure. */
export interface AiRateTier {
  match: string;
  windowMs: number;
  max: number;
}

/** Batches larger than this are rejected outright (audit R4-2). */
export const MAX_TRPC_BATCH = 64;
const WALLET_LIMIT_PER_MIN = 60;
const WALLET_DAILY_LIMIT = 200;

/** Procedure names in a tRPC request path (`/trpc/a.b,c.d` → `['a.b','c.d']`). */
export function trpcProcedures(path: string): string[] {
  let raw = path.startsWith('/trpc/') ? path.slice('/trpc/'.length) : path;
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // malformed escape — fall back to the raw path
  }
  return raw.split(',').filter(Boolean);
}

/** The tier a procedure falls under: an exact match wins, then the longest prefix. */
export function matchAiTier(procedure: string, tiers: AiRateTier[]): AiRateTier | undefined {
  let best: AiRateTier | undefined;
  for (const t of tiers) {
    if (t.match === procedure) return t;
    if (t.match.endsWith('.') && procedure.startsWith(t.match)) {
      if (!best || t.match.length > best.match.length) best = t;
    }
  }
  return best;
}

function aiLimitResponse(c: Context, message: string, retryAfterSec: number) {
  c.header('Retry-After', String(retryAfterSec));
  const envelope = {
    error: { message, code: -32029, data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 } },
  };
  const n = trpcProcedures(c.req.path).length || 1;
  return c.json(n > 1 ? Array(n).fill(envelope) : envelope, 429);
}

/**
 * Stricter rate limiter for expensive endpoints (AI generation). Mounted ONCE
 * on `/trpc/*` with a tier table rather than per router glob: tRPC batches
 * several procedures into one path (`/trpc/credits.getBalance,generation.x`),
 * so a per-prefix Hono mount only ever saw the first procedure and a batch
 * led by any cheap call skipped every AI limit (audit R4-2).
 *
 * Every AI mutation in a batch draws its own token from the per-IP
 * (per-procedure), per-wallet (60/min) and daily (200/24h) buckets. Queries
 * (GET) are left to the blanket limiter: provider spend happens in
 * mutations, and status polls must not share the tiny per-route budgets.
 * Batches over MAX_TRPC_BATCH are rejected for every method.
 */
export function aiRateLimiter(tiers: AiRateTier[]) {
  return async (c: Context, next: Next) => {
    if (c.req.method === 'OPTIONS') return next();
    const procedures = trpcProcedures(c.req.path);
    if (procedures.length > MAX_TRPC_BATCH) {
      return c.json(
        {
          error: {
            message: `tRPC batch too large (max ${MAX_TRPC_BATCH} procedures)`,
            code: -32600,
            data: { code: 'BAD_REQUEST', httpStatus: 400 },
          },
        },
        400
      );
    }
    if (c.req.method !== 'POST') return next();

    const hits: Array<{ procedure: string; tier: AiRateTier }> = [];
    for (const procedure of procedures) {
      const tier = matchAiTier(procedure, tiers);
      if (tier) hits.push({ procedure, tier });
    }
    if (hits.length === 0) return next();

    const ip = getClientKey(c);
    for (const { procedure, tier } of hits) {
      const ipResult = await getStore().consume(`ai:${ip}:${procedure}`, tier.windowMs, tier.max);
      c.header('X-RateLimit-Limit', String(tier.max));
      c.header('X-RateLimit-Remaining', String(ipResult.remaining));
      if (ipResult.blocked) {
        return aiLimitResponse(
          c,
          'AI generation rate limit exceeded. Please wait before trying again.',
          Math.ceil(tier.windowMs / 1000)
        );
      }
    }

    // Per-wallet limits — shared across ALL AI procedures, so they use fixed
    // values, never a tier's `max` (a 2/min tier would otherwise cap the
    // wallet bucket for every other AI route in that window).
    const authHeader = c.req.header('authorization');
    const { getCookie } = await import('hono/cookie');
    const tokenSource = authHeader
      ? authHeader.replace('Bearer ', '')
      : (getCookie(c, 'siwe-session') ?? null);
    if (tokenSource) {
      let wallet = '';
      try {
        // Cryptographic verification so a forged token can't pick its wallet bucket.
        const { verifySessionToken } = await import('../lib/siwe');
        const payload = await verifySessionToken(tokenSource);
        wallet = (payload?.sub || '').toLowerCase();
      } catch {
        // JWT parse failed — skip wallet rate limiting, IP limit still applies
      }
      if (wallet) {
        for (let i = 0; i < hits.length; i++) {
          const walletResult = await getStore().consume(
            `ai-wallet:${wallet}`,
            60_000,
            WALLET_LIMIT_PER_MIN
          );
          if (walletResult.blocked) {
            return aiLimitResponse(
              c,
              'Per-wallet AI generation rate limit exceeded. Please wait before trying again.',
              60
            );
          }
          const dailyResult = await getStore().consume(
            `ai-daily:${wallet}`,
            86_400_000,
            WALLET_DAILY_LIMIT
          );
          if (dailyResult.blocked) {
            return aiLimitResponse(
              c,
              `Daily generation limit reached (${WALLET_DAILY_LIMIT}/day). Try again tomorrow.`,
              3600
            );
          }
        }
      }
    }

    await next();
  };
}
