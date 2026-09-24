/**
 * Queued-video budget plumbing (lib/video-budget.ts) against a real Redis:
 * admission-time reservation + denial handling, and the worker's
 * retry-aware release. Only Firestore is stubbed. Skips without Redis.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';

const REDIS_URL = vi.hoisted(() => {
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  return process.env.REDIS_URL;
});

vi.mock('../lib/firebase', () => ({
  firebaseAvailable: true,
  db: {
    collection: (name: string) => ({
      doc: () => ({
        get: async () =>
          name === 'costControls'
            ? {
                exists: true,
                data: () => ({ pausedProviders: ['paused-prov'], caps: { userDailyUsd: 1 } }),
              }
            : { exists: false, data: () => null },
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

describe('isFinalAttempt', () => {
  it('is true only when no further retry will run', async () => {
    const { isFinalAttempt } = await import('../lib/video-budget');
    // attempts: 2 (the generation queue default) -> attemptsMade counts PRIOR attempts.
    expect(isFinalAttempt({ attemptsMade: 0, opts: { attempts: 2 } })).toBe(false);
    expect(isFinalAttempt({ attemptsMade: 1, opts: { attempts: 2 } })).toBe(true);
    expect(isFinalAttempt({ attemptsMade: 0, opts: undefined })).toBe(true);
  });
});

describe.skipIf(!haveRedis)('queued video budget (real Redis)', () => {
  let vb: typeof import('../lib/video-budget');
  let cost: typeof import('../services/cost-tracker');
  let scope: typeof import('../services/cost-tracker/scope');
  let cleanup: Redis;

  beforeAll(async () => {
    const { getRedisClientAsync } = await import('../lib/redis');
    await getRedisClientAsync();
    vb = await import('../lib/video-budget');
    cost = await import('../services/cost-tracker');
    scope = await import('../services/cost-tracker/scope');
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

  const asUser = <T>(name: string, fn: () => Promise<T>) =>
    scope.withCostScope({ userId: `${run}-${name}` }, fn) as Promise<T>;
  const reserve = (usd: number, onDenied: (e: Error) => Promise<void> = async () => {}) =>
    vb.reserveQueuedVideoBudget({ provider: 'fal', providerCostUsd: usd, onDenied });

  it('reserves at admission and returns a serializable ref for the job data', async () => {
    await asUser('adm1', async () => {
      const hold = await reserve(0.6);
      expect(hold).not.toBeNull();
      expect(() => JSON.stringify(hold!.ref)).not.toThrow();
      await hold!.release();
    });
  });

  it('on denial: runs onDenied once BEFORE throwing a 429, and books nothing', async () => {
    await asUser('adm2', async () => {
      const first = await reserve(0.7);
      const order: string[] = [];
      const onDenied = vi.fn(async (e: Error) => {
        order.push(`denied:${e.message.includes('Cost cap exceeded')}`);
      });
      const err = await reserve(0.7, onDenied).catch((e) => {
        order.push('thrown');
        return e;
      });
      expect(err).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      expect(onDenied).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['denied:true', 'thrown']); // refund happens before the caller sees the error
      // The denied attempt held nothing: releasing the first frees the whole cap.
      await first!.release();
      const again = await reserve(0.9);
      expect(again).not.toBeNull();
      await again!.release();
    });
  });

  it('a paused provider is a 403 and also triggers onDenied', async () => {
    await asUser('adm3', async () => {
      const onDenied = vi.fn(async () => {});
      const err = await vb
        .reserveQueuedVideoBudget({
          provider: 'paused-prov' as any,
          providerCostUsd: 0.1,
          onDenied,
        })
        .catch((e) => e);
      expect(err).toMatchObject({ code: 'FORBIDDEN' });
      expect(onDenied).toHaveBeenCalledTimes(1);
    });
  });

  it('free models are not gated and never call onDenied', async () => {
    const onDenied = vi.fn(async () => {});
    expect(
      await vb.reserveQueuedVideoBudget({ provider: 'fal', providerCostUsd: 0, onDenied })
    ).toBeNull();
    expect(onDenied).not.toHaveBeenCalled();
  });

  it('budgetErrorToTrpc leaves unrelated errors alone', async () => {
    expect(await vb.budgetErrorToTrpc(new Error('boom'))).toBeNull();
    expect(vb.isBudgetRefusal(new Error('boom'))).toBe(false);
  });

  // ── worker-side release ────────────────────────────────────────────

  /** Build the job the worker would see: hold ref crossed a JSON boundary. */
  async function queuedJob(name: string, attemptsMade: number, attempts = 2) {
    const hold = await asUser(name, () => reserve(0.9));
    const job = {
      data: { spendHold: JSON.parse(JSON.stringify(hold!.ref)) },
      attemptsMade,
      opts: { attempts },
    };
    /** Is the 0.9 slot free again? (a 0.9 reserve only fits once the hold is gone) */
    const slotFree = () =>
      asUser(name, async () => {
        const h = await reserve(0.9).catch(() => null);
        await h?.release();
        return h !== null;
      });
    return { job, slotFree };
  }

  it('worker releases the hold when the job succeeds', async () => {
    const { job, slotFree } = await queuedJob('w1', 0);
    expect(await slotFree()).toBe(false);
    await vb.runReleasingSpendHold(job, async () => 'done');
    expect(await slotFree()).toBe(true);
  });

  it('worker KEEPS the hold when a non-final attempt throws (the retry stays covered)', async () => {
    const { job, slotFree } = await queuedJob('w2', 0, 2);
    await expect(
      vb.runReleasingSpendHold(job, async () => {
        throw new Error('transient');
      })
    ).rejects.toThrow('transient');
    expect(await slotFree()).toBe(false);
    // ...and the retry (final attempt) that then succeeds releases it.
    await vb.runReleasingSpendHold({ ...job, attemptsMade: 1 }, async () => 'ok');
    expect(await slotFree()).toBe(true);
  });

  it('worker releases the hold when the FINAL attempt throws', async () => {
    const { job, slotFree } = await queuedJob('w3', 1, 2);
    await expect(
      vb.runReleasingSpendHold(job, async () => {
        throw new Error('fatal');
      })
    ).rejects.toThrow('fatal');
    expect(await slotFree()).toBe(true);
  });

  it('jobs without a hold (free models / Redis down) pass through untouched', async () => {
    const job = { data: {}, attemptsMade: 0, opts: { attempts: 2 } };
    await expect(vb.runReleasingSpendHold(job, async () => 42)).resolves.toBe(42);
  });
});
