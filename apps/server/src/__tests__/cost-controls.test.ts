/**
 * Controls + alerts + trend + comparison + top-movers + CSV tests.
 *
 * Uses top-level mocks (vi.mock — hoisted) with mutable state objects so
 * each test configures its fixture without resetModules (which would
 * re-register the Prometheus counters and crash prom-client).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mutable fixture the firebase mock reads from ─────────────────────

type DocFixture = { exists: boolean; data: () => any };
type QueryFixture = { docs: Array<{ id: string; data: () => any }>; empty?: boolean };

const fixture: {
  docs: Record<string, Record<string, DocFixture>>; // [collection][id] -> doc
  queries: Record<string, QueryFixture>; // [collection] -> query result (for .where...get())
  purchases: QueryFixture;
  getAllResult: DocFixture[];
  batchSetCalls: Array<{ data: any }>;
  commitFail: boolean;
  collectionSetCalls: Array<{ collection: string; id: string; data: any; opts?: any }>;
} = {
  docs: {},
  queries: {},
  purchases: { docs: [], empty: true },
  getAllResult: [],
  batchSetCalls: [],
  commitFail: false,
  collectionSetCalls: [],
};

function reset() {
  fixture.docs = {};
  fixture.queries = {};
  fixture.purchases = { docs: [], empty: true };
  fixture.getAllResult = [];
  fixture.batchSetCalls = [];
  fixture.commitFail = false;
  fixture.collectionSetCalls = [];
}

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}));

vi.mock('../lib/firebase', () => ({
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const v = fixture.docs[name]?.[id];
          return v ?? { exists: false, data: () => null };
        },
        set: (data: any, opts?: any) => {
          fixture.collectionSetCalls.push({ collection: name, id, data, opts });
          return Promise.resolve();
        },
      }),
      add: (data: any) => {
        fixture.collectionSetCalls.push({ collection: name, id: '(auto)', data });
        return Promise.resolve({ id: 'auto-id' });
      },
      where: function () {
        return this;
      },
      orderBy: function () {
        return this;
      },
      limit: function () {
        return this;
      },
      get: async () => {
        if (name === 'creditPurchases') return fixture.purchases;
        return fixture.queries[name] ?? { docs: [] };
      },
    }),
    batch: () => ({
      set: (_ref: any, data: any) => fixture.batchSetCalls.push({ data }),
      commit: async () => {
        if (fixture.commitFail) throw new Error('firestore down');
      },
    }),
    getAll: async (...refs: any[]) => {
      // `fixture.getAllResult` describes the desired value PER PERIOD (one
      // entry per day for trend/comparison, one entry for single-period
      // reads). Production code fans each period across PLATFORM_SHARD_COUNT
      // shards, so refs.length = periods × shardCount. Fan the fixture out
      // by placing the value in shard 0 of each period and padding the rest
      // with empty docs — keeps test setups shard-agnostic.
      const periodCount = fixture.getAllResult.length;
      if (periodCount === 0 || refs.length === 0) {
        return refs.map(() => ({ exists: false, data: () => null }));
      }
      const shardsPerPeriod = Math.max(1, Math.floor(refs.length / periodCount));
      const empty = { exists: false, data: () => null };
      const out: DocFixture[] = [];
      for (let i = 0; i < refs.length; i++) {
        const periodIdx = Math.floor(i / shardsPerPeriod);
        const shardIdx = i % shardsPerPeriod;
        if (shardIdx === 0 && periodIdx < periodCount) {
          out.push(fixture.getAllResult[periodIdx]);
        } else {
          out.push(empty);
        }
      }
      return out;
    },
    runTransaction: async (fn: any) =>
      fn({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
        set: vi.fn(),
        update: vi.fn(),
      }),
  },
  firebaseAvailable: true,
}));

const slackMock = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/slack', () => ({ sendSlackAlert: slackMock }));

beforeEach(() => {
  reset();
  slackMock.mockClear();
});

function makeDoc(data: any): DocFixture {
  return { exists: true, data: () => data };
}

function setControlsDoc(overrides: Partial<any> = {}) {
  fixture.docs.costControls = {
    platform: makeDoc({
      pausedProviders: [],
      caps: {
        platformDailyUsd: null,
        userDailyUsd: null,
        apiKeyDailyUsd: null,
        universeDailyUsd: null,
      },
      overrides: { userDailyUsd: {}, apiKeyDailyUsd: {}, universeDailyUsd: {} },
      alert: { enabled: false, marginThreshold: null, cooldownMinutes: 30 },
      ...overrides,
    }),
  };
}

// ── Controls gate ────────────────────────────────────────────────────

describe('cost-tracker controls', () => {
  it('throws ProviderPausedError when provider is in pausedProviders', async () => {
    const { assertProviderAllowed, ProviderPausedError, invalidateControlsCache } =
      await import('../services/cost-tracker');
    setControlsDoc({ pausedProviders: ['gemini'] });
    invalidateControlsCache();
    await expect(assertProviderAllowed({ provider: 'gemini' })).rejects.toBeInstanceOf(
      ProviderPausedError
    );
  });

  it('throws CostCapExceededError when today platform spend >= cap', async () => {
    const { assertProviderAllowed, CostCapExceededError, invalidateControlsCache } =
      await import('../services/cost-tracker');
    setControlsDoc({
      caps: {
        platformDailyUsd: 10,
        userDailyUsd: null,
        apiKeyDailyUsd: null,
        universeDailyUsd: null,
      },
    });
    // Today's platform aggregate is now read via db.getAll across shards;
    // put the value in one shard fixture so the sum hits the cap.
    fixture.getAllResult = [makeDoc({ costUsd: 12 })];
    invalidateControlsCache();
    await expect(assertProviderAllowed({ provider: 'fal' })).rejects.toBeInstanceOf(
      CostCapExceededError
    );
  });

  it('passes when all caps are null and no provider is paused', async () => {
    const { assertProviderAllowed, invalidateControlsCache } =
      await import('../services/cost-tracker');
    setControlsDoc();
    invalidateControlsCache();
    await expect(assertProviderAllowed({ provider: 'gemini' })).resolves.toBeUndefined();
  });

  it('applies per-user override before the default user cap', async () => {
    const { assertProviderAllowed, CostCapExceededError, withCostScope, invalidateControlsCache } =
      await import('../services/cost-tracker');
    setControlsDoc({
      caps: {
        platformDailyUsd: null,
        userDailyUsd: 100,
        apiKeyDailyUsd: null,
        universeDailyUsd: null,
      },
      overrides: {
        userDailyUsd: { '0xuser': 1 },
        apiKeyDailyUsd: {},
        universeDailyUsd: {},
      },
    });
    const day = new Date().toISOString().slice(0, 10);
    fixture.docs.costAggregates = {
      [`${day}__user__0xuser`]: makeDoc({ costUsd: 1.5 }),
    };
    invalidateControlsCache();
    await withCostScope({ userId: '0xuser', route: 'test' } as any, async () => {
      await expect(assertProviderAllowed({ provider: 'gemini' })).rejects.toBeInstanceOf(
        CostCapExceededError
      );
    });
  });
});

// ── Alerts ───────────────────────────────────────────────────────────

describe('cost-tracker alerts', () => {
  it('does not fire when alerts.enabled is false', async () => {
    setControlsDoc({ alert: { enabled: false, marginThreshold: null, cooldownMinutes: 30 } });
    const { runAlertSweep, invalidateControlsCache } = await import('../services/cost-tracker');
    invalidateControlsCache();
    const fired = await runAlertSweep();
    expect(fired).toEqual([]);
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('fires margin alert when margin ratio is below threshold', async () => {
    setControlsDoc({
      alert: { enabled: true, marginThreshold: 0.3, cooldownMinutes: 30 },
    });
    // Platform aggregate is now read via db.getAll across shards.
    fixture.getAllResult = [makeDoc({ costUsd: 90 })];
    fixture.purchases = {
      docs: [],
      forEach: (cb: any) => cb({ data: () => ({ usdAmount: 100 }) }),
    } as any;
    fixture.docs.costControls = {
      ...fixture.docs.costControls,
      alertCooldown: { exists: false, data: () => null },
    };
    const { checkAndFireMarginAlert, invalidateControlsCache } =
      await import('../services/cost-tracker');
    invalidateControlsCache();
    const res = await checkAndFireMarginAlert();
    expect(res).not.toBeNull();
    expect(res?.kind).toBe('margin_breach');
    expect(slackMock).toHaveBeenCalledOnce();
    const alertWrite = fixture.collectionSetCalls.find((c) => c.collection === 'costAlerts');
    expect(alertWrite).toBeDefined();
  });

  it('returns null when margin is at or above threshold', async () => {
    setControlsDoc({ alert: { enabled: true, marginThreshold: 0.3, cooldownMinutes: 30 } });
    fixture.getAllResult = [makeDoc({ costUsd: 70 })];
    fixture.purchases = {
      docs: [],
      forEach: (cb: any) => cb({ data: () => ({ usdAmount: 100 }) }),
    } as any;
    const { checkAndFireMarginAlert, invalidateControlsCache } =
      await import('../services/cost-tracker');
    invalidateControlsCache();
    const res = await checkAndFireMarginAlert();
    expect(res).toBeNull();
    expect(slackMock).not.toHaveBeenCalled();
  });
});

// ── Trend + comparison + top-movers + by-model + CSV ────────────────

describe('cost-tracker analytics + csv', () => {
  it('getPlatformTrend returns one point per day with margin computed', async () => {
    fixture.getAllResult = Array.from({ length: 7 }, () =>
      makeDoc({ costUsd: 20, calls: 2, tokensUsed: 100 })
    );
    fixture.purchases = {
      docs: [],
      forEach: (cb: any) => cb({ data: () => ({ usdAmount: 50 }) }),
    } as any;
    const { getPlatformTrend } = await import('../services/cost-tracker');
    const series = await getPlatformTrend(7);
    expect(series.length).toBe(7);
    for (const p of series) {
      expect(p.costUsd).toBe(20);
      expect(p.revenueUsd).toBe(50);
      expect(p.marginRatio).toBeCloseTo(0.6, 5);
    }
  });

  it('getComparison splits series in half + computes deltas', async () => {
    // 14 days total — first 7 cheaper, next 7 more expensive
    fixture.getAllResult = Array.from({ length: 14 }, (_, i) =>
      makeDoc({ costUsd: i < 7 ? 10 : 20, calls: 1, tokensUsed: 0 })
    );
    fixture.purchases = {
      docs: [],
      forEach: (cb: any) => cb({ data: () => ({ usdAmount: 100 }) }),
    } as any;
    const { getComparison } = await import('../services/cost-tracker');
    const cmp = await getComparison('week');
    expect(cmp.current.costUsd).toBeGreaterThan(cmp.previous.costUsd);
    expect(cmp.delta.costUsd).toBe(cmp.current.costUsd - cmp.previous.costUsd);
    expect(cmp.delta.costPct).toBeGreaterThan(0);
  });

  it('getTopMovers ranks by deltaUsd desc + limits', async () => {
    // First get call → current, second → previous
    let nth = 0;
    fixture.queries = {
      costAggregates: {
        get docs() {
          // never read — the closure below handles it
          return [];
        },
      } as any,
    };
    // Override the mock get to alternate.
    const currDocs = [
      { id: 'a', data: () => ({ key: '0xaaa', costUsd: 10, calls: 5 }) },
      { id: 'b', data: () => ({ key: '0xbbb', costUsd: 5, calls: 3 }) },
      { id: 'c', data: () => ({ key: '0xccc', costUsd: 1, calls: 1 }) },
    ];
    const prevDocs = [
      { id: 'a', data: () => ({ key: '0xaaa', costUsd: 1 }) },
      { id: 'b', data: () => ({ key: '0xbbb', costUsd: 4 }) },
    ];
    (fixture.queries as any).costAggregates = {
      get docs() {
        return nth++ === 0 ? currDocs : prevDocs;
      },
    };

    const { getTopMovers } = await import('../services/cost-tracker');
    const out = await getTopMovers({ scope: 'user', limit: 2 });
    expect(out.length).toBe(2);
    expect(out[0].key).toBe('0xaaa');
    expect(out[0].deltaUsd).toBe(9);
  });

  it('exportLedgerCsv escapes commas/quotes and emits header + rows', async () => {
    fixture.queries.costLedger = {
      docs: [
        {
          id: 'cost_1',
          data: () => ({
            provider: 'gemini',
            model: 'gemini-2.5-pro',
            kind: 'vlm',
            costUsd: 0.01,
            inputTokens: 100,
            outputTokens: 20,
            userId: '0xuser',
            apiKeyId: null,
            universeAddress: null,
            route: 'trpc:vlm.extract.start,oops',
            createdAt: new Date('2026-04-18T12:00:00Z'),
          }),
        },
      ],
    };
    const { exportLedgerCsv } = await import('../services/cost-tracker');
    const csv = await exportLedgerCsv({ limit: 10 });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('costUsd');
    expect(lines[1]).toContain('gemini');
    expect(lines[1]).toContain('"trpc:vlm.extract.start,oops"');
  });

  it('getByModel parses provider + model from the composite key', async () => {
    fixture.queries.costAggregates = {
      docs: [
        {
          id: 'agg1',
          data: () => ({
            key: 'gemini:gemini-2.5-pro',
            kind: 'vlm',
            costUsd: 0.1,
            calls: 5,
            tokensUsed: 500,
          }),
        },
        {
          id: 'agg2',
          data: () => ({
            key: 'fal:seedance-2.0',
            kind: 'video_gen',
            costUsd: 0.5,
            calls: 1,
            tokensUsed: 0,
          }),
        },
      ],
    };
    const { getByModel } = await import('../services/cost-tracker');
    const rows = await getByModel('2026-04-18');
    expect(rows.length).toBe(2);
    expect(rows[0].provider).toBe('gemini');
    expect(rows[0].model).toBe('gemini-2.5-pro');
    expect(rows[0].costPerCallUsd).toBeCloseTo(0.02, 5);
    expect(rows[1].costPerCallUsd).toBeCloseTo(0.5, 5);
  });
});

// ── Record (model scope) ─────────────────────────────────────────────

describe('cost-tracker record (model scope)', () => {
  it('emits a `model` scope aggregate when model is provided', async () => {
    const { recordProviderCost, withCostScope } = await import('../services/cost-tracker');
    await withCostScope(
      { userId: '0xu', apiKeyId: null, aiAgentId: null, universeAddress: null } as any,
      async () => {
        await recordProviderCost({
          provider: 'gemini',
          model: 'gemini-2.5-pro',
          kind: 'vlm',
          costUsd: 0.01,
        });
      }
    );
    const scopes = fixture.batchSetCalls.slice(1).map((b) => b.data.scope);
    expect(scopes).toContain('model');
    expect(scopes).toContain('platform');
    expect(scopes).toContain('provider');
    expect(scopes).toContain('user');
  });

  it('omits the model scope when model is missing', async () => {
    const { recordProviderCost } = await import('../services/cost-tracker');
    await recordProviderCost({ provider: 'stripe_fee', kind: 'payment_fee', costUsd: 0.03 });
    const scopes = fixture.batchSetCalls.slice(1).map((b) => b.data.scope);
    expect(scopes).not.toContain('model');
  });
});
