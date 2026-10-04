/**
 * Audit R4-2: the AI limiter used to be mounted per router glob, so a batched
 * tRPC path led by any cheap procedure (`/trpc/credits.getBalance,generation.x`)
 * skipped it entirely, and one HTTP request spent one token for N procedures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.stubEnv('REDIS_URL', '');

const { aiRateLimiter, matchAiTier, trpcProcedures, MAX_TRPC_BATCH } =
  await import('../rate-limit');

let counter = 0;
function makeApp() {
  const app = new Hono();
  // Unique tier per app so the shared in-memory store never carries state across tests.
  counter++;
  app.use(
    '/trpc/*',
    aiRateLimiter([
      { match: `gen${counter}.`, windowMs: 60_000, max: 2 },
      { match: `gen${counter}.exact`, windowMs: 60_000, max: 1 },
    ])
  );
  app.all('/trpc/*', (c) => c.text('ok'));
  return { app, prefix: `gen${counter}` };
}

const post = (app: Hono, path: string) =>
  app.request(`${path}?batch=1`, {
    method: 'POST',
    headers: { 'x-forwarded-for': `10.0.0.${counter}` },
  });

describe('trpcProcedures / matchAiTier', () => {
  it('splits a batched path and decodes it', () => {
    expect(trpcProcedures('/trpc/a.b%2Cc.d')).toEqual(['a.b', 'c.d']);
    expect(trpcProcedures('/trpc/a.b,c.d')).toEqual(['a.b', 'c.d']);
  });

  it('prefers an exact match, then the longest prefix', () => {
    const tiers = [
      { match: 'episodes.', windowMs: 1, max: 1 },
      { match: 'episodes.generateFromScript', windowMs: 1, max: 2 },
    ];
    expect(matchAiTier('episodes.generateFromScript', tiers)?.max).toBe(2);
    expect(matchAiTier('episodes.feed', tiers)?.max).toBe(1);
    expect(matchAiTier('credits.getBalance', tiers)).toBeUndefined();
  });
});

describe('aiRateLimiter (batch-aware)', () => {
  beforeEach(() => {
    counter++;
  });

  it('still limits a batch led by a non-AI procedure', async () => {
    const { app, prefix } = makeApp();
    const path = `/trpc/credits.getBalance,${prefix}.video`;
    expect((await post(app, path)).status).toBe(200);
    expect((await post(app, path)).status).toBe(200);
    expect((await post(app, path)).status).toBe(429);
  });

  it('charges every AI procedure in one batch', async () => {
    const { app, prefix } = makeApp();
    const res = await post(app, `/trpc/${prefix}.video,${prefix}.video,${prefix}.video`);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
  });

  it('does not throttle GET queries (status polls)', async () => {
    const { app, prefix } = makeApp();
    for (let i = 0; i < 5; i++) {
      const res = await app.request(`/trpc/${prefix}.getStatus?batch=1`);
      expect(res.status).toBe(200);
    }
  });

  it('rejects oversized batches for any method', async () => {
    const { app } = makeApp();
    const path =
      '/trpc/' +
      Array(MAX_TRPC_BATCH + 1)
        .fill('feed.list')
        .join(',');
    expect((await app.request(path)).status).toBe(400);
  });
});
