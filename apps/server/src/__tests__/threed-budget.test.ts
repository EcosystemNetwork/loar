/**
 * Live-3D budget plumbing (lib/threed-budget.ts) against a real Redis: the
 * reservation, and the fire-and-forget settle that records cost only for
 * COMPLETED jobs and always releases the hold. Only Firestore is stubbed.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

const REDIS_URL = vi.hoisted(() => {
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  return process.env.REDIS_URL;
});

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}));
vi.mock('../lib/firebase', () => ({
  firebaseAvailable: true,
  db: {
    collection: (name: string) => ({
      doc: () => ({
        get: async () =>
          name === 'costControls'
            ? {
                exists: true,
                data: () => ({ pausedProviders: ['tripo'], caps: { userDailyUsd: 1 } }),
              }
            : { exists: false, data: () => null },
        set: async () => {},
      }),
      add: async () => ({ id: 'x' }),
    }),
    batch: () => ({ set: () => {}, commit: async () => {} }),
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

describe.skipIf(!haveRedis)('live 3D budget (real Redis)', () => {
  let tb: typeof import('../lib/threed-budget');
  let spend: typeof import('../services/cost-tracker/redis-spend');
  let scope: typeof import('../services/cost-tracker/scope');
  let cost: typeof import('../services/cost-tracker');
  let cleanup: Redis;

  beforeAll(async () => {
    const { getRedisClientAsync } = await import('../lib/redis');
    await getRedisClientAsync();
    tb = await import('../lib/threed-budget');
    spend = await import('../services/cost-tracker/redis-spend');
    scope = await import('../services/cost-tracker/scope');
    cost = await import('../services/cost-tracker');
    cleanup = new Redis(REDIS_URL);
  });

  afterAll(async () => {
    const keys = await cleanup.keys(`cost:usd6:*${run}*`);
    if (keys.length) await cleanup.del(...keys);
    cleanup.disconnect();
    await cost.shutdownControlsSubscriber?.();
    const { shutdownRedis } = await import('../lib/redis');
    await shutdownRedis?.();
  });

  const uid = (n: string) => `${run}-${n}`;
  const asUser = <T>(n: string, fn: () => Promise<T>) =>
    scope.withCostScope({ userId: uid(n) }, fn) as Promise<T>;
  const waitFor = async (pred: () => Promise<boolean>, ms = 3000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await pred()) return true;
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };
  /** Can a $0.9 reservation fit right now? (only when no hold/spend is in the way) */
  const fits = (n: string, usd = 0.9) =>
    asUser(n, async () => {
      const h = await tb.reserveThreedBudget('meshy', usd).catch(() => null);
      await h?.release();
      return h !== null;
    });

  it('a denied reservation is a 429 and books nothing', async () => {
    await asUser('deny', async () => {
      const first = await tb.reserveThreedBudget('meshy', 0.7);
      const err = await tb.reserveThreedBudget('meshy', 0.7).catch((e) => e);
      expect(err).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      await first!.release();
    });
    expect(await fits('deny')).toBe(true);
  });

  it('a paused provider is a 403', async () => {
    await asUser('paused', async () => {
      await expect(tb.reserveThreedBudget('tripo', 0.1)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });
  });

  it('completed job: records its cost to the spend counter, then releases the hold', async () => {
    const hold = await asUser('ok', () => tb.reserveThreedBudget('meshy', 0.3));
    let resolveJob!: () => void;
    const done = new Promise<void>((r) => (resolveJob = r));
    asUser('ok', async () =>
      tb.settleThreedJob({
        hold,
        done,
        provider: 'meshy',
        model: 'meshy-rigging',
        costUsd: 0.3,
        readStatus: async () => 'completed',
      })
    );
    expect(await spend.readRedisSpend('user', uid('ok'))).toBe(0); // nothing recorded yet
    resolveJob();
    expect(
      await waitFor(async () => ((await spend.readRedisSpend('user', uid('ok'))) ?? 0) >= 0.3)
    ).toBe(true);
    expect(await spend.readRedisSpend('user', uid('ok'))).toBeCloseTo(0.3, 6);
    // hold released: $0.3 spent + a fresh $0.6 reservation now fits under $1
    expect(await waitFor(() => fits('ok', 0.6))).toBe(true);
  });

  it('failed job: records NOTHING (a failed task bills nothing) but still releases the hold', async () => {
    const hold = await asUser('fail', () => tb.reserveThreedBudget('meshy', 0.9));
    await new Promise<void>((resolve) => {
      asUser('fail', async () =>
        tb.settleThreedJob({
          hold,
          done: Promise.resolve().then(resolve),
          provider: 'meshy',
          model: 'meshy-rigging',
          costUsd: 0.9,
          readStatus: async () => 'failed',
        })
      );
    });
    expect(await waitFor(() => fits('fail'))).toBe(true);
    expect(await spend.readRedisSpend('user', uid('fail'))).toBe(0);
  });

  it('still releases when the completer rejects or the status read throws', async () => {
    const h1 = await asUser('rej', () => tb.reserveThreedBudget('meshy', 0.9));
    asUser('rej', async () =>
      tb.settleThreedJob({
        hold: h1,
        done: Promise.reject(new Error('completer blew up')),
        provider: 'meshy',
        model: 'm',
        costUsd: 0.9,
        readStatus: async () => 'failed',
      })
    );
    expect(await waitFor(() => fits('rej'))).toBe(true);

    const h2 = await asUser('thr', () => tb.reserveThreedBudget('meshy', 0.9));
    asUser('thr', async () =>
      tb.settleThreedJob({
        hold: h2,
        done: Promise.resolve(),
        provider: 'meshy',
        model: 'm',
        costUsd: 0.9,
        readStatus: async () => {
          throw new Error('firestore down');
        },
      })
    );
    expect(await waitFor(() => fits('thr'))).toBe(true);
  });

  it('releaseHoldOnError frees the hold on a throw and passes results through otherwise', async () => {
    const hold = await asUser('roe', () => tb.reserveThreedBudget('meshy', 0.9));
    await expect(
      tb.releaseHoldOnError(hold, async () => {
        throw new Error('provider rejected the task');
      })
    ).rejects.toThrow('provider rejected');
    expect(await fits('roe')).toBe(true);
    await expect(tb.releaseHoldOnError(null, async () => 'ok')).resolves.toBe('ok');
  });
});
