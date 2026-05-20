/**
 * cost-tracker unit tests — scope propagation, ledger recording, margin calc.
 *
 * Firebase is fully mocked in setup.ts so these tests only verify control
 * flow and accounting logic. We capture batch writes by swapping the shared
 * db mock with a spying variant before the module under test is imported.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Firestore batch/doc spies that replace the setup.ts stub ─────────────

const batchSetCalls: Array<{ ref: any; data: any; opts?: any }> = [];
const commitMock = vi.fn().mockResolvedValue(undefined);
const mkBatch = () => ({
  set: vi.fn((ref: any, data: any, opts?: any) => {
    batchSetCalls.push({ ref, data, opts });
  }),
  commit: commitMock,
});

const ledgerDocGetMock = vi.fn();
const providerAggDocsGetMock = vi.fn();
const creditPurchasesGetMock = vi.fn();

function buildCollection(name: string) {
  if (name === 'costAggregates') {
    return {
      doc: (_id: string) => ({
        get: ledgerDocGetMock,
        set: vi.fn(),
      }),
      where: vi.fn().mockReturnThis(),
      get: providerAggDocsGetMock,
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    };
  }
  if (name === 'creditPurchases') {
    return {
      where: vi.fn().mockReturnThis(),
      get: creditPurchasesGetMock,
    };
  }
  return {
    doc: (id: string) => ({
      id,
      get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
      set: vi.fn(),
      update: vi.fn(),
    }),
    add: vi.fn().mockResolvedValue({ id: 'auto-id' }),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ docs: [], empty: true }),
  };
}

vi.mock('../lib/firebase', () => ({
  db: {
    collection: (name: string) => buildCollection(name),
    batch: () => mkBatch(),
    runTransaction: vi.fn().mockImplementation(async (fn: any) =>
      fn({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        set: vi.fn(),
        update: vi.fn(),
      })
    ),
    // `readPlatformAggregate` (used by computeMargin via margin.ts) now fans
    // out across shards via db.getAll(...refs). Preserve single-value test
    // semantics: put the ledgerDocGetMock result in shard 0 and pad the rest
    // with empty docs so the sum equals the original mock value.
    getAll: async (...refs: any[]) => {
      const first = await ledgerDocGetMock();
      const empty = { exists: false, data: () => null };
      return [first, ...refs.slice(1).map(() => empty)];
    },
  },
  firebaseAvailable: true,
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}));

beforeEach(() => {
  batchSetCalls.length = 0;
  commitMock.mockClear();
  ledgerDocGetMock.mockReset();
  providerAggDocsGetMock.mockReset();
  creditPurchasesGetMock.mockReset();
});

// ── Scope ──────────────────────────────────────────────────────────────

describe('cost-tracker scope', () => {
  it('returns system scope outside withCostScope', async () => {
    const { getCostScope } = await import('../services/cost-tracker');
    const scope = getCostScope();
    expect(scope.userId).toBeNull();
    expect(scope.route).toBe('system');
  });

  it('propagates scope through nested async calls', async () => {
    const { getCostScope, withCostScope } = await import('../services/cost-tracker');
    const outer = {
      userId: '0xabc',
      apiKeyId: 'key-1',
      aiAgentId: null,
      route: 'trpc:outer',
    };
    await withCostScope(outer as any, async () => {
      await new Promise((r) => setImmediate(r));
      const inner = getCostScope();
      expect(inner.userId).toBe('0xabc');
      expect(inner.apiKeyId).toBe('key-1');
      expect(inner.route).toBe('trpc:outer');
    });
    // scope clears outside
    expect(getCostScope().userId).toBeNull();
  });

  it('overrides nested scope cleanly without leaking to sibling async chains', async () => {
    const { getCostScope, withCostScope } = await import('../services/cost-tracker');
    const outer = withCostScope({ userId: 'u1', route: 'r1' } as any, async () => {
      await new Promise((r) => setImmediate(r));
      expect(getCostScope().userId).toBe('u1');
      return 'outer-done';
    });
    const sibling = withCostScope({ userId: 'u2', route: 'r2' } as any, async () => {
      await new Promise((r) => setImmediate(r));
      expect(getCostScope().userId).toBe('u2');
      return 'sibling-done';
    });
    const [a, b] = await Promise.all([outer, sibling]);
    expect(a).toBe('outer-done');
    expect(b).toBe('sibling-done');
  });
});

// ── Record ────────────────────────────────────────────────────────────

describe('cost-tracker record', () => {
  it('writes ledger + platform/provider/user aggregates when scope is set', async () => {
    const { recordProviderCost, withCostScope } = await import('../services/cost-tracker');
    await withCostScope(
      {
        userId: '0xuser',
        apiKeyId: null,
        aiAgentId: null,
        universeAddress: null,
        route: 'trpc:vlm.extract.start',
      } as any,
      async () => {
        await recordProviderCost({
          provider: 'gemini',
          model: 'gemini-2.5-pro',
          kind: 'vlm',
          costUsd: 0.012345,
          inputTokens: 1000,
          outputTokens: 250,
        });
      }
    );

    expect(commitMock).toHaveBeenCalled();
    // 1 ledger + 4 scopes (platform/provider/model/user) × 2 periods = 9
    expect(batchSetCalls.length).toBe(9);
    const ledgerWrite = batchSetCalls[0].data;
    expect(ledgerWrite.provider).toBe('gemini');
    expect(ledgerWrite.model).toBe('gemini-2.5-pro');
    expect(ledgerWrite.costUsd).toBeCloseTo(0.012345, 5);
    expect(ledgerWrite.userId).toBe('0xuser');
    expect(ledgerWrite.route).toBe('trpc:vlm.extract.start');
    // Verify one of the aggregate increments carries the cost.
    const agg = batchSetCalls[1].data;
    expect(agg.costUsd).toEqual({ __increment: 0.012345 });
  });

  it('still writes apiKey + universe aggregates when scope includes them', async () => {
    const { recordProviderCost, withCostScope } = await import('../services/cost-tracker');
    await withCostScope(
      {
        userId: '0xuser',
        apiKeyId: 'key-42',
        aiAgentId: 'agent-7',
        universeAddress: '0xuniv',
        route: 'worker:vlm.extract',
      } as any,
      async () => {
        await recordProviderCost({
          provider: 'fal',
          model: 'seedance-2.0',
          kind: 'video_gen',
          costUsd: 0.5,
        });
      }
    );
    // 1 ledger + 6 scopes (platform, provider, model, user, apiKey, universe) × 2 periods = 13
    expect(batchSetCalls.length).toBe(13);
  });

  it('never throws when firebase batch.commit fails', async () => {
    commitMock.mockRejectedValueOnce(new Error('firestore down'));
    const { recordProviderCost } = await import('../services/cost-tracker');
    await expect(
      recordProviderCost({
        provider: 'gemini',
        kind: 'vlm',
        costUsd: 0.001,
      })
    ).resolves.toBeUndefined();
  });

  it('skips persistence when costUsd is zero or negative', async () => {
    const { recordProviderCost } = await import('../services/cost-tracker');
    await recordProviderCost({ provider: 'gemini', kind: 'vlm', costUsd: 0 });
    await recordProviderCost({ provider: 'gemini', kind: 'vlm', costUsd: -1 });
    expect(commitMock).not.toHaveBeenCalled();
  });
});

// ── Margin ────────────────────────────────────────────────────────────

describe('cost-tracker margin', () => {
  it('returns zero margin when revenue is zero', async () => {
    const { computeMargin } = await import('../services/cost-tracker');
    ledgerDocGetMock.mockResolvedValue({ exists: false, data: () => null });
    creditPurchasesGetMock.mockResolvedValue({ forEach: () => {}, docs: [] });
    const m = await computeMargin('day');
    expect(m.marginRatio).toBe(0);
    expect(m.hitsTarget).toBe(false);
  });

  it('computes 30% margin correctly', async () => {
    const { computeMargin, marginTarget } = await import('../services/cost-tracker');
    ledgerDocGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ costUsd: 70 }),
    });
    creditPurchasesGetMock.mockResolvedValue({
      forEach: (cb: any) => cb({ data: () => ({ usdAmount: 100 }) }),
      docs: [],
    });
    const m = await computeMargin('day');
    expect(m.revenueUsd).toBe(100);
    expect(m.costUsd).toBe(70);
    expect(m.marginUsd).toBe(30);
    expect(m.marginRatio).toBeCloseTo(0.3, 5);
    expect(m.hitsTarget).toBe(true);
    expect(m.target).toBe(marginTarget());
  });

  it('flags margin miss when cost exceeds 70% of revenue', async () => {
    const { computeMargin } = await import('../services/cost-tracker');
    ledgerDocGetMock.mockResolvedValue({
      exists: true,
      data: () => ({ costUsd: 80 }),
    });
    creditPurchasesGetMock.mockResolvedValue({
      forEach: (cb: any) => cb({ data: () => ({ usdAmount: 100 }) }),
      docs: [],
    });
    const m = await computeMargin('day');
    expect(m.marginRatio).toBeCloseTo(0.2, 5);
    expect(m.hitsTarget).toBe(false);
  });
});
