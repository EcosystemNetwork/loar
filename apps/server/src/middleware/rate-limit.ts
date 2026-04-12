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

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();

  constructor() {
    // Clean up stale buckets every 10 minutes
    setInterval(
      () => {
        const staleThreshold = Date.now() - 10 * 60 * 1000;
        for (const [key, bucket] of this.buckets.entries()) {
          if (bucket.lastRefill < staleThreshold) {
            this.buckets.delete(key);
          }
        }
      },
      10 * 60 * 1000
    );
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
    this.buckets.set(key, bucket);
    return { remaining: bucket.tokens, blocked: false };
  }
}

// ── Redis store (multi-instance production) ─────────────────────────────

class RedisStore implements RateLimitStore {
  private client: any;
  private ready = false;
  /** In-memory fallback used when Redis is unavailable (fail-closed, not fail-open) */
  private memoryFallback = new MemoryStore();

  constructor(redisUrl: string) {
    this.init(redisUrl);
  }

  private async init(redisUrl: string) {
    try {
      // Dynamic import — ioredis is an optional dependency
      const Redis = (await import('ioredis')).default;
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
        enableOfflineQueue: false,
      });
      await this.client.connect();
      this.ready = true;
      console.log('[RateLimit] Redis store connected');
    } catch (err) {
      console.warn('[RateLimit] Redis unavailable, falling back to in-memory store:', err);
      this.ready = false;
    }
  }

  async consume(key: string, windowMs: number, max: number) {
    if (!this.ready || !this.client) {
      // Fail-closed: use in-memory rate limiting instead of allowing all requests
      return this.memoryFallback.consume(key, windowMs, max);
    }

    try {
      const redisKey = `rl:${key}`;
      const windowSec = Math.ceil(windowMs / 1000);

      // Atomic increment + TTL via MULTI
      const results = await this.client.multi().incr(redisKey).ttl(redisKey).exec();

      const count = results[0][1] as number;
      const ttl = results[1][1] as number;

      // Set expiry on first request in window
      if (ttl === -1) {
        await this.client.expire(redisKey, windowSec);
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
    store = new RedisStore(redisUrl);
  } else {
    store = new MemoryStore();
  }
  return store;
}

// ── Client identification ───────────────────────────────────────────────

/**
 * Extract the client IP from trusted headers.
 *
 * Priority:
 *   1. x-forwarded-for — last entry (closest trusted proxy hop)
 *   2. x-real-ip — set by nginx / similar
 *   3. Connection remote address
 *
 * IMPORTANT: Configure your reverse proxy to strip/overwrite these headers
 * from the original client request. If the proxy passes client-supplied
 * headers through, clients can spoof their IP to bypass rate limits.
 */
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/;

function getClientKey(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    // Take the LAST entry — that's the IP your trusted proxy appended.
    const lastIp = xff.split(',').pop()?.trim();
    if (lastIp && IP_RE.test(lastIp)) return lastIp;
  }
  const realIp = c.req.header('x-real-ip');
  if (realIp && IP_RE.test(realIp)) return realIp;
  // Fallback to connection-level IP — never share a single bucket for all unknowns
  return (c.req.raw as any)?.socket?.remoteAddress || 'unknown-' + Date.now();
}

// ── Middleware ───────────────────────────────────────────────────────────

export function rateLimiter(opts: { windowMs: number; max: number }) {
  return async (c: Context, next: Next) => {
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

    // Per-wallet rate limit (10 req/min per wallet across all AI endpoints)
    const authHeader = c.req.header('authorization');
    if (authHeader) {
      // Extract wallet address from JWT via cryptographic verification.
      // Using verifySessionToken ensures attackers cannot forge wallet addresses
      // to bypass per-wallet rate limits.
      try {
        const { verifySessionToken } = await import('../lib/siwe');
        const token = authHeader.replace('Bearer ', '');
        const payload = await verifySessionToken(token);
        const wallet = (payload?.sub || '').toLowerCase();
        if (wallet) {
          const walletKey = `ai-wallet:${wallet}`;
          const walletResult = await getStore().consume(walletKey, opts.windowMs, opts.max);
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
