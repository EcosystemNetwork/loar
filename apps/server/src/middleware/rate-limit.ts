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
      const windowSec = Math.ceil(windowMs / 1000);

      // Atomic increment + TTL via MULTI
      const results = await client.multi().incr(redisKey).ttl(redisKey).exec();

      const count = results[0][1] as number;
      const ttl = results[1][1] as number;

      // Set expiry on first request in window
      if (ttl === -1) {
        await client.expire(redisKey, windowSec);
      }

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

export function rateLimiter(opts: { windowMs: number; max: number }) {
  return async (c: Context, next: Next) => {
    // Don't rate-limit CORS preflight requests
    if (c.req.method === 'OPTIONS') return next();

    const key = getClientKey(c);
    const result = await getStore().consume(key, opts.windowMs, opts.max);

    c.header('X-RateLimit-Limit', String(opts.max));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    if (result.blocked) {
      c.header('Retry-After', String(Math.ceil(opts.windowMs / 1000)));
      return c.json({ error: 'Too many requests' }, 429);
    }

    await next();
  };
}

/**
 * Stricter rate limiter for expensive endpoints (AI generation).
 * Uses a composite key of IP + tRPC procedure path for per-endpoint limits.
 * Also enforces per-wallet limits when a user is authenticated.
 */
export function aiRateLimiter(opts: { windowMs: number; max: number }) {
  return async (c: Context, next: Next) => {
    const ip = getClientKey(c);
    // Extract tRPC procedure name from the URL path (e.g. /trpc/generation.generate)
    const procedurePath = c.req.path.replace('/trpc/', '');

    // Per-IP rate limit
    const ipKey = `ai:${ip}:${procedurePath}`;
    const ipResult = await getStore().consume(ipKey, opts.windowMs, opts.max);

    c.header('X-RateLimit-Limit', String(opts.max));
    c.header('X-RateLimit-Remaining', String(ipResult.remaining));

    if (ipResult.blocked) {
      c.header('Retry-After', String(Math.ceil(opts.windowMs / 1000)));
      return c.json(
        {
          error: {
            message: 'AI generation rate limit exceeded. Please wait before trying again.',
            code: -32029,
            data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 },
          },
        },
        429
      );
    }

    // Per-wallet rate limit — fixed at 60 req/min per wallet across ALL AI
    // endpoints. Must NOT use opts.max: that field is per-route (2..30) and the
    // wallet bucket is shared, so the first AI route a wallet hits in a window
    // would otherwise cap their wallet bucket at that route's tiny limit (e.g.
    // 2 from `episodes.generateFromScript`), 429ing every subsequent AI call —
    // and any tRPC error toast persists in the React Query cache, which is why
    // it can surface on later page loads with unrelated errors. The per-route
    // bucket above already enforces route-specific budgets.
    const WALLET_LIMIT_PER_MIN = 60;
    const authHeader = c.req.header('authorization');
    const { getCookie } = await import('hono/cookie');
    const cookieToken = getCookie(c, 'siwe-session');
    const tokenSource = authHeader
      ? authHeader.replace('Bearer ', '')
      : cookieToken
        ? cookieToken
        : null;
    if (tokenSource) {
      // Extract wallet address from JWT via cryptographic verification.
      // Using verifySessionToken ensures attackers cannot forge wallet addresses
      // to bypass per-wallet rate limits.
      try {
        const { verifySessionToken } = await import('../lib/siwe');
        const payload = await verifySessionToken(tokenSource);
        const wallet = (payload?.sub || '').toLowerCase();
        if (wallet) {
          const walletKey = `ai-wallet:${wallet}`;
          const walletResult = await getStore().consume(walletKey, 60_000, WALLET_LIMIT_PER_MIN);
          if (walletResult.blocked) {
            c.header('Retry-After', String(Math.ceil(opts.windowMs / 1000)));
            return c.json(
              {
                error: {
                  message:
                    'Per-wallet AI generation rate limit exceeded. Please wait before trying again.',
                  code: -32029,
                  data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 },
                },
              },
              429
            );
          }

          // Daily cost ceiling: 200 generations per wallet per 24h
          const dailyKey = `ai-daily:${wallet}`;
          const dailyResult = await getStore().consume(dailyKey, 86_400_000, 200);
          if (dailyResult.blocked) {
            return c.json(
              {
                error: {
                  message: 'Daily generation limit reached (200/day). Try again tomorrow.',
                  code: -32029,
                  data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429 },
                },
              },
              429
            );
          }
        }
      } catch {
        // JWT parse failed — skip wallet rate limiting, IP limit still applies
      }
    }

    await next();
  };
}
