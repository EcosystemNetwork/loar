/**
 * End-to-end: `dispatchGeneration` under the hard daily-cap reservation.
 * Real Redis + real hold logic + real ledger write-through; only Firestore and
 * the MiniMax network call are stubbed. Skips itself without a reachable Redis.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { minimaxService } from '../services/minimax';

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
            ? { exists: true, data: () => ({ caps: { userDailyUsd: 1 } }) }
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

describe.skipIf(!haveRedis)('dispatchGeneration hard budget (real Redis)', () => {
  let dispatchGeneration: typeof import('../routers/generation/generation.routes').dispatchGeneration;
  let getModelById: typeof import('../services/video-models').getModelById;
  let withCostScope: typeof import('../services/cost-tracker/scope').withCostScope;
  let cleanup: Redis;
  // Network boundary: spy on the real singleton so every import sees the same replaced method.
  const generateVideo = vi.spyOn(minimaxService, 'generateVideo');

  beforeAll(async () => {
    const { getRedisClientAsync } = await import('../lib/redis');
    await getRedisClientAsync();
    ({ dispatchGeneration } = await import('../routers/generation/generation.routes'));
    ({ getModelById } = await import('../services/video-models'));
    ({ withCostScope } = await import('../services/cost-tracker/scope'));
    cleanup = new Redis(REDIS_URL);
  });

  afterAll(async () => {
    const keys = await cleanup.keys(`cost:usd6:*${run}*`);
    if (keys.length) await cleanup.del(...keys);
    cleanup.disconnect();
    const { shutdownControlsSubscriber } = await import('../services/cost-tracker');
    await shutdownControlsSubscriber?.();
    const { shutdownRedis } = await import('../lib/redis');
    await shutdownRedis?.();
  });

  const input = { prompt: 'a fox', mode: 'text_to_video', durationSec: 5 } as any;
  const dispatchAs = (name: string, model: any) =>
    withCostScope({ userId: `${run}-${name}` }, () =>
      dispatchGeneration(model, input, undefined, `${run}-${name}`)
    ) as Promise<{ status: string; videoUrl?: string }>;

  it('admits only what fits the cap, refuses the rest with a 429, and counts the spend', async () => {
    const model = getModelById('minimax-hailuo-02-t2v')!;
    expect(model.providerCostUsd).toBeGreaterThan(0);
    // A model priced so exactly 3 calls fit under the $1 cap.
    const priced = { ...model, providerCostUsd: 0.3 };

    generateVideo.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { id: 't1', status: 'completed', videoUrl: 'https://cdn.example.com/v.mp4' };
    });

    // 5 concurrent calls: nothing has been *recorded* yet, so only the holds
    // can stop the 4th and 5th from slipping under the cap.
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => dispatchAs('burst', priced))
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(3);
    expect(refused).toHaveLength(2);
    expect(refused[0].reason).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(generateVideo).toHaveBeenCalledTimes(3); // refused calls never reached the provider

    // Holds are gone and the 3 completed calls are now counted as spend
    // ($0.90): a 4th $0.30 call no longer fits.
    await expect(dispatchAs('burst', priced)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(generateVideo).toHaveBeenCalledTimes(3);
  });

  it('releases the hold when the provider call throws', async () => {
    const model = { ...getModelById('minimax-hailuo-02-t2v')!, providerCostUsd: 0.9 };
    generateVideo.mockRejectedValueOnce(new Error('provider down'));
    await expect(dispatchAs('throws', model)).rejects.toThrow('provider down');
    generateVideo.mockResolvedValueOnce({
      id: 't',
      status: 'completed',
      videoUrl: 'https://x/v.mp4',
    });
    // Would be refused if the failed call's $0.90 hold had leaked.
    await expect(dispatchAs('throws', model)).resolves.toMatchObject({ status: 'completed' });
  });

  it('does not gate free/local models', async () => {
    const free = { ...getModelById('minimax-hailuo-02-t2v')!, providerCostUsd: 0 };
    generateVideo.mockResolvedValue({ id: 'f', status: 'completed', videoUrl: 'https://x/v.mp4' });
    await expect(dispatchAs('free', free)).resolves.toMatchObject({ status: 'completed' });
  });
});
