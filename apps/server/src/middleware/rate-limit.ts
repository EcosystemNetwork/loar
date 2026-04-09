import type { Context, Next } from 'hono';

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

// Clean up stale buckets every 10 minutes
setInterval(
  () => {
    const staleThreshold = Date.now() - 10 * 60 * 1000;
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.lastRefill < staleThreshold) {
        buckets.delete(key);
      }
    }
  },
  10 * 60 * 1000
);

export function rateLimiter(opts: { windowMs: number; max: number }) {
  return async (c: Context, next: Next) => {
    // Use the last IP in x-forwarded-for (closest proxy), or fall back to 'anonymous'.
    // NOTE: In production, configure your reverse proxy to set a trusted header.
    const xff = c.req.header('x-forwarded-for');
    const key = xff ? xff.split(',').pop()!.trim() : c.req.header('x-real-ip') || 'anonymous';
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now - bucket.lastRefill > opts.windowMs) {
      bucket = { tokens: opts.max, lastRefill: now };
    }

    if (bucket.tokens <= 0) {
      c.header('Retry-After', String(Math.ceil(opts.windowMs / 1000)));
      return c.json({ error: 'Too many requests' }, 429);
    }

    bucket.tokens--;
    buckets.set(key, bucket);
    await next();
  };
}
