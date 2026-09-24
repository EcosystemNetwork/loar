/**
 * LLM + VLM pre-call estimates, and the hard cap on real `dispatchLlm` against
 * a real Redis. Only Firestore, BYOK key lookup and the provider's network
 * call are stubbed. The Redis-backed tests skip without a reachable Redis.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { openAIService } from '../services/openai';
import {
  DEFAULT_OUTPUT_TOKEN_ESTIMATE,
  IMAGE_TOKEN_ALLOWANCE,
  estimateLlmCostUsd,
  estimateLlmInputTokens,
} from '../services/llm-models/estimate';
import {
  VLM_FILE_TOKEN_ALLOWANCE,
  VLM_INLINE_IMAGE_TOKENS,
  VLM_OUTPUT_TOKEN_ESTIMATE,
  estimateVlmCostUsd,
} from '../services/vlm/estimate';

const REDIS_URL = vi.hoisted(() => {
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  return process.env.REDIS_URL;
});

vi.mock('../lib/byok', async (orig) => ({
  ...(await orig<typeof import('../lib/byok')>()),
  resolveProviderKey: async () => 'test-key',
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
vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}));

const priced = { providerInputUsdPerMtok: 2, providerOutputUsdPerMtok: 10, maxOutputTokens: null };

describe('estimateLlmCostUsd', () => {
  it('counts text, tool/schema JSON and a flat allowance per image', () => {
    const tokens = estimateLlmInputTokens({
      messages: [
        { content: 'a'.repeat(300) },
        {
          content: [
            { type: 'text', text: 'b'.repeat(30) },
            { type: 'image_url', image_url: {} },
          ],
        },
      ],
      tools: { x: 1 },
    });
    // 300 + 30 chars of text + the tool JSON, at 3 chars/token, plus one image.
    expect(tokens).toBe(
      Math.ceil((300 + 30 + JSON.stringify({ x: 1 }).length) / 3) + IMAGE_TOKEN_ALLOWANCE
    );
  });

  it("uses the caller's maxTokens as the output figure, else a default", () => {
    const base = { messages: [{ content: '' }] };
    expect(estimateLlmCostUsd(priced, { ...base, maxTokens: 1_000_000 })).toBeCloseTo(10, 6);
    expect(estimateLlmCostUsd(priced, base)).toBeCloseTo(
      (DEFAULT_OUTPUT_TOKEN_ESTIMATE / 1_000_000) * 10,
      9
    );
  });

  it("clamps output to the model's own ceiling", () => {
    const capped = { ...priced, maxOutputTokens: 1000 };
    expect(
      estimateLlmCostUsd(capped, { messages: [{ content: '' }], maxTokens: 500_000 })
    ).toBeCloseTo((1000 / 1_000_000) * 10, 9);
  });
});

describe('estimateVlmCostUsd', () => {
  it('adds a flat allowance per Files-API part and per inline image', () => {
    const none = estimateVlmCostUsd({ prompt: '' }, 1, 1);
    const withMedia = estimateVlmCostUsd(
      { prompt: '', media: [{ fileData: {} }, { inlineData: {} }] },
      1,
      1
    );
    expect(withMedia - none).toBeCloseTo(
      (VLM_FILE_TOKEN_ALLOWANCE + VLM_INLINE_IMAGE_TOKENS) / 1_000_000,
      9
    );
    expect(none).toBeCloseTo(VLM_OUTPUT_TOKEN_ESTIMATE / 1_000_000, 9);
  });
});

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

describe.skipIf(!haveRedis)('dispatchLlm hard budget (real Redis)', () => {
  let dispatchLlm: typeof import('../services/llm-models/dispatch').dispatchLlm;
  let withCostScope: typeof import('../services/cost-tracker/scope').withCostScope;
  let cleanup: Redis;
  const chat = vi.spyOn(openAIService, 'chat');

  beforeAll(async () => {
    const { getRedisClientAsync } = await import('../lib/redis');
    await getRedisClientAsync();
    ({ dispatchLlm } = await import('../services/llm-models/dispatch'));
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

  it('two concurrent calls that each need ~60% of the cap: one runs, one gets a 429', async () => {
    const { getLlmModelById } = await import('../services/llm-models/registry');
    const model = getLlmModelById('gpt-5')!;
    // Choose maxTokens so the ESTIMATE is ~$0.60 against the $1 user cap.
    const maxTokens = Math.ceil(0.6 / (model.providerOutputUsdPerMtok / 1_000_000));
    chat.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { text: 'ok', usage: { promptTokens: 1, completionTokens: 1 } } as any;
    });

    const call = () =>
      withCostScope({ userId: `${run}-llm` }, () =>
        dispatchLlm({
          modelId: 'gpt-5',
          messages: [{ role: 'user', content: 'hi' }],
          maxTokens,
          userId: `${run}-llm`,
        })
      ) as Promise<{ text: string }>;

    const results = await Promise.allSettled([call(), call()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    expect(chat).toHaveBeenCalledTimes(1); // the refused call never reached the provider

    // The hold was released after the call: only the ~$0.000011 actually
    // recorded remains, so a call that fits again succeeds.
    chat.mockClear();
    await expect(call()).resolves.toMatchObject({ text: 'ok' });
  });
});
