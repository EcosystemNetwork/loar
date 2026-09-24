/**
 * Hard budget reservation — real Redis, real Lua script. Only Firestore is
 * stubbed (controls doc + ledger aggregates). Skips itself if no Redis is
 * reachable, like the repo's other real-stack tests.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

const REDIS_URL = vi.hoisted(() => {
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  return process.env.REDIS_URL;
});

// Firestore stub: a controls doc with a default per-user cap of $1, plus
// ledger aggregates a test can seed to exercise hydration.
const ledger: Record<string, number> = {};
vi.mock('../lib/firebase', () => ({
  firebaseAvailable: true,
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          if (name === 'costControls') {
            return {
              exists: true,
              data: () => ({
                pausedProviders: ['paused-prov'],
                caps: { userDailyUsd: 1, apiKeyDailyUsd: 0.2 },
              }),
            };
          }
          if (name === 'costAggregates' && id in ledger) {
            return { exists: true, data: () => ({ costUsd: ledger[id] }) };
          }
          return { exists: false, data: () => null };
        },
        set: async () => {},
      }),
      add: async () => ({ id: 'x' }),
    }),
    getAll: async () => [],
  },
}));

async function redisReachable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  probe.on('error', () => {});
  try {
    await probe.connect();
    return (await probe.ping()) === 'PONG';
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}
const haveRedis = await redisReachable();

const run = `t${randomUUID().slice(0, 8)}`;
const day = new Date().toISOString().slice(0, 10);
const uid = (n: string) => `${run}-${n}`;

describe.skipIf(!haveRedis)('redis spend reservation (real Redis)', () => {
  let spend: typeof import('../services/cost-tracker/redis-spend');
  let controls: typeof import('../services/cost-tracker/controls');
  let scope: typeof import('../services/cost-tracker/scope');
  let cleanup: Redis;

  beforeAll(async () => {
    const { getRedisClientAsync } = await import('../lib/redis');
    await getRedisClientAsync();
    spend = await import('../services/cost-tracker/redis-spend');
    controls = await import('../services/cost-tracker/controls');
    scope = await import('../services/cost-tracker/scope');
    cleanup = new Redis(REDIS_URL);
  });

  afterAll(async () => {
    const keys = await cleanup.keys(`cost:usd6:*${run}*`);
    if (keys.length) await cleanup.del(...keys);
    cleanup.disconnect();
    await controls.shutdownControlsSubscriber?.();
    const { shutdownRedis } = await import('../lib/redis');
    await shutdownRedis?.();
  });

  const user = (name: string, capUsd: number) => ({ scope: 'user', key: uid(name), capUsd });

  it('counts sub-cent spend instead of dropping it', async () => {
    const id = uid('subcent');
    for (let i = 0; i < 3; i++) await spend.incrementRedisSpend('user', id, 0.004);
    expect(await spend.readRedisSpend('user', id)).toBeCloseTo(0.012, 6);
  });

  it('refuses a reservation that does not fit and frees room on release', async () => {
    const t = [user('basic', 1)];
    const first = await spend.reserveRedisSpend(t, 0.6);
    expect(first.status).toBe('reserved');

    const second = await spend.reserveRedisSpend(t, 0.6);
    expect(second).toMatchObject({ status: 'denied', scope: 'user', capUsd: 1 });
    if (second.status === 'denied') expect(second.committedUsd).toBeCloseTo(0.6, 6);

    if (first.status === 'reserved') await spend.releaseRedisHold(first.hold);
    expect((await spend.reserveRedisSpend(t, 0.6)).status).toBe('reserved');
  });

  it('counts already-recorded spend against the cap', async () => {
    const id = uid('spent');
    await spend.incrementRedisSpend('user', id, 0.9);
    const r = await spend.reserveRedisSpend([{ scope: 'user', key: id, capUsd: 1 }], 0.2);
    expect(r.status).toBe('denied');
    if (r.status === 'denied') expect(r.committedUsd).toBeCloseTo(0.9, 6);
  });

  it('is atomic under a concurrent stampede: 20 x $0.10 against a $1 cap admits exactly 10', async () => {
    const t = [user('stampede', 1)];
    const results = await Promise.all(
      Array.from({ length: 20 }, () => spend.reserveRedisSpend(t, 0.1))
    );
    expect(results.filter((r) => r.status === 'reserved')).toHaveLength(10);
    expect(results.filter((r) => r.status === 'denied')).toHaveLength(10);
  });

  it('is all-or-nothing across scopes', async () => {
    const shared = uid('multi');
    // apiKey has only $0.2 of room, user has plenty.
    const both = [
      { scope: 'user', key: shared, capUsd: 1 },
      { scope: 'apiKey', key: shared, capUsd: 0.2 },
    ];
    const denied = await spend.reserveRedisSpend(both, 0.5);
    expect(denied).toMatchObject({ status: 'denied', scope: 'apiKey' });
    // The user scope must not have been charged by the failed attempt.
    const userOnly = await spend.reserveRedisSpend(
      [{ scope: 'user', key: shared, capUsd: 1 }],
      0.95
    );
    expect(userOnly.status).toBe('reserved');
  });

  it('expires holds so a crashed caller cannot leak budget', async () => {
    const t = [user('expiry', 1)];
    expect((await spend.reserveRedisSpend(t, 0.9, 1)).status).toBe('reserved');
    expect((await spend.reserveRedisSpend(t, 0.9, 1)).status).toBe('denied');
    await new Promise((r) => setTimeout(r, 1200));
    expect((await spend.reserveRedisSpend(t, 0.9, 1)).status).toBe('reserved');
  });

  it('hydrates a cold counter from the Firestore ledger before checking', async () => {
    const id = uid('hydrate');
    ledger[`${day}__user__${id}`] = 0.5;
    const r = await spend.reserveRedisSpend([{ scope: 'user', key: id, capUsd: 1 }], 0.6);
    expect(r.status).toBe('denied');
  });

  it('release is idempotent', async () => {
    const t = [user('idem', 1)];
    const r = await spend.reserveRedisSpend(t, 0.9);
    if (r.status !== 'reserved') throw new Error('expected reserved');
    await spend.releaseRedisHold(r.hold);
    await spend.releaseRedisHold(r.hold);
    expect((await spend.reserveRedisSpend(t, 0.9)).status).toBe('reserved');
  });

  // ── controls-level API ──────────────────────────────────────────────

  const asUser = <T>(name: string, fn: () => Promise<T>) =>
    scope.withCostScope({ userId: uid(name) }, fn) as Promise<T>;

  it('reserveProviderBudget: books, blocks the next call, frees on release', async () => {
    await asUser('ctl1', async () => {
      const hold = await controls.reserveProviderBudget({ provider: 'p', estimatedUsd: 0.7 });
      expect(hold).not.toBeNull();
      await expect(
        controls.reserveProviderBudget({ provider: 'p', estimatedUsd: 0.7 })
      ).rejects.toBeInstanceOf(controls.CostCapExceededError);
      await hold!.release();
      await hold!.release(); // idempotent
      const again = await controls.reserveProviderBudget({ provider: 'p', estimatedUsd: 0.7 });
      await again!.release();
    });
  });

  it('refuses a single call bigger than the whole cap, even at zero spend', async () => {
    await asUser('ctl2', async () => {
      const err = await controls
        .reserveProviderBudget({ provider: 'p', estimatedUsd: 5 })
        .catch((e) => e);
      expect(err).toBeInstanceOf(controls.CostCapExceededError);
      expect(err.attemptedUsd).toBe(5);
      expect(err.message).toContain('needs ~$5.0000');
    });
  });

  it('withSpendHold releases the hold even when the call throws', async () => {
    await asUser('ctl3', async () => {
      await expect(
        controls.withSpendHold({ provider: 'p', estimatedUsd: 0.9 }, async () => {
          throw new Error('provider blew up');
        })
      ).rejects.toThrow('provider blew up');
      // Room is back: this would be denied if the hold had leaked.
      const ok = await controls.withSpendHold(
        { provider: 'p', estimatedUsd: 0.9 },
        async () => 'ok'
      );
      expect(ok).toBe('ok');
    });
  });

  it('honors the provider kill-switch and skips reservation with no estimate', async () => {
    await asUser('ctl4', async () => {
      await expect(
        controls.reserveProviderBudget({ provider: 'paused-prov', estimatedUsd: 0.1 })
      ).rejects.toBeInstanceOf(controls.ProviderPausedError);
      // No estimate -> the soft path, nothing held, returns null.
      expect(await controls.reserveProviderBudget({ provider: 'p', estimatedUsd: 0 })).toBeNull();
    });
  });
});
