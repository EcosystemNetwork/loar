/**
 * points — award idempotency and generation-route gating.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type StoredDoc = Record<string, unknown>;

/** Minimal in-memory Firestore with the surface services/points touches. */
function createDb(initial: Record<string, Record<string, StoredDoc>> = {}) {
  const state: Record<string, Record<string, StoredDoc>> = structuredClone(initial);

  const applyValue = (prev: unknown, next: unknown): unknown => {
    if (next && typeof next === 'object' && '__inc' in (next as object)) {
      return (typeof prev === 'number' ? prev : 0) + (next as { __inc: number }).__inc;
    }
    return next;
  };

  const mergeInto = (target: StoredDoc, data: StoredDoc, merge: boolean) => {
    if (!merge) {
      const out: StoredDoc = {};
      for (const [k, v] of Object.entries(data)) out[k] = applyValue(undefined, v);
      return out;
    }
    const out: StoredDoc = { ...target };
    for (const [k, v] of Object.entries(data)) out[k] = applyValue(target[k], v);
    return out;
  };

  // ── Read-side query surface ──────────────────────────────────────────
  // getLeaderboard / getMyPoints read outside any transaction, via
  // collection().orderBy().limit().get(), collection().where().count().get(),
  // and doc().get(). Model just enough of that to exercise ranking + the
  // profile-hydration join.
  const OPS: Record<string, (a: any, b: any) => boolean> = {
    '<': (a, b) => a < b,
    '<=': (a, b) => a <= b,
    '==': (a, b) => a === b,
    '>=': (a, b) => a >= b,
    '>': (a, b) => a > b,
  };

  interface QuerySpec {
    filters: Array<{ field: string; op: string; value: unknown }>;
    orderBy?: { field: string; dir: 'asc' | 'desc' };
    limit?: number;
  }

  function makeQuery(collection: string, spec: QuerySpec): any {
    const resolve = () => {
      let docs = Object.entries(state[collection] ?? {}).map(([id, data]) => ({ id, data }));
      for (const f of spec.filters) {
        docs = docs.filter((d) => OPS[f.op]((d.data as StoredDoc)[f.field], f.value));
      }
      if (spec.orderBy) {
        const { field, dir } = spec.orderBy;
        docs.sort((a, b) => {
          const av = Number((a.data as StoredDoc)[field] ?? 0);
          const bv = Number((b.data as StoredDoc)[field] ?? 0);
          return dir === 'desc' ? bv - av : av - bv;
        });
      }
      if (typeof spec.limit === 'number') docs = docs.slice(0, spec.limit);
      return docs;
    };
    return {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(collection, { ...spec, filters: [...spec.filters, { field, op, value }] }),
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') =>
        makeQuery(collection, { ...spec, orderBy: { field, dir } }),
      limit: (n: number) => makeQuery(collection, { ...spec, limit: n }),
      count: () => ({
        get: async () => ({ data: () => ({ count: resolve().length }) }),
      }),
      get: async () => {
        const docs = resolve().map(({ id, data }) => ({
          id,
          exists: true,
          data: () => structuredClone(data),
        }));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
  }

  // Serialize transactions the way Firestore does — a concurrent
  // transaction retries against committed state rather than racing.
  let lock: Promise<unknown> = Promise.resolve();

  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => ({
        collection,
        id,
        get: async () => {
          const data = state[collection]?.[id];
          return { exists: Boolean(data), id, data: () => structuredClone(data) };
        },
      }),
      where: (field: string, op: string, value: unknown) =>
        makeQuery(collection, { filters: [{ field, op, value }] }),
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') =>
        makeQuery(collection, { filters: [], orderBy: { field, dir } }),
      limit: (n: number) => makeQuery(collection, { filters: [], limit: n }),
    }),
    runTransaction: (cb: (tx: any) => Promise<unknown>) => {
      const run = lock.then(async () => {
        const writes: Array<{ collection: string; id: string; data: StoredDoc; merge: boolean }> =
          [];
        const result = await cb({
          get: async (ref: { collection: string; id: string }) => {
            const data = state[ref.collection]?.[ref.id];
            return { exists: Boolean(data), data: () => structuredClone(data) };
          },
          set: (
            ref: { collection: string; id: string },
            data: StoredDoc,
            options?: { merge?: boolean }
          ) => writes.push({ ...ref, data, merge: options?.merge === true }),
        });
        for (const w of writes) {
          state[w.collection] ??= {};
          state[w.collection][w.id] = mergeInto(state[w.collection][w.id] ?? {}, w.data, w.merge);
        }
        return result;
      });
      lock = run.catch(() => {});
      return run;
    },
  };

  return { db, state };
}

const { db, state } = createDb();

vi.mock('../../lib/firebase', () => ({
  get db() {
    return db;
  },
  firebaseAvailable: true,
}));

vi.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __inc: n }) },
}));

import {
  awardPoints,
  awardGenerationPoints,
  getLeaderboard,
  getMyPoints,
  POINTS_PER_GENERATION,
} from './index';
import { withCostScope } from '../cost-tracker/scope';

/** Seed userPoints + profiles for the read-side tests. bbb > aaa > ccc. */
function seedLeaderboard() {
  state.userPoints = {
    '0xaaa': { userId: '0xaaa', points: 50, universeCount: 2, generationCount: 3 },
    '0xbbb': { userId: '0xbbb', points: 120, universeCount: 1, generationCount: 11 },
    '0xccc': { userId: '0xccc', points: 30, universeCount: 0, generationCount: 3 },
  };
  state.profiles = {
    // 0xaaa: deliberately no profile row — display fields stay null.
    '0xbbb': { username: 'bob', displayName: 'Bob', avatarUrl: 'https://cdn/b.png' },
    '0xccc': { username: 'cara', displayName: null, avatarUrl: '' },
  };
}

beforeEach(() => {
  for (const k of Object.keys(state)) delete state[k];
});

describe('awardPoints', () => {
  it('credits points and bumps the kind counter', async () => {
    await awardPoints({ userId: '0xAbc', kind: 'universe', amount: 10, dedupeKey: 'universe:0x1' });
    expect(state.userPoints['0xabc']).toMatchObject({
      userId: '0xabc',
      points: 10,
      universeCount: 1,
    });
    expect(state.pointsEvents['universe:0x1']).toMatchObject({ kind: 'universe', amount: 10 });
  });

  it('is idempotent on dedupeKey — a replay does not double-credit', async () => {
    await awardPoints({ userId: '0xabc', kind: 'universe', amount: 10, dedupeKey: 'universe:0x1' });
    await awardPoints({ userId: '0xabc', kind: 'universe', amount: 10, dedupeKey: 'universe:0x1' });
    expect(state.userPoints['0xabc'].points).toBe(10);
  });

  it('accumulates across distinct keys', async () => {
    await awardPoints({ userId: '0xabc', kind: 'generation', amount: 10, dedupeKey: 'gen:r1' });
    await awardPoints({ userId: '0xabc', kind: 'generation', amount: 10, dedupeKey: 'gen:r2' });
    expect(state.userPoints['0xabc']).toMatchObject({ points: 20, generationCount: 2 });
  });

  it('no-ops for a missing user or non-positive amount', async () => {
    await awardPoints({ userId: '', kind: 'generation', amount: 10, dedupeKey: 'gen:x' });
    await awardPoints({ userId: '0xabc', kind: 'generation', amount: 0, dedupeKey: 'gen:y' });
    expect(state.userPoints).toBeUndefined();
  });
});

describe('awardGenerationPoints', () => {
  it('awards once per requestId on a generation route', async () => {
    await withCostScope(
      { userId: '0xdd', route: 'trpc:generation.generate', requestId: 'req-1' },
      async () => {
        awardGenerationPoints();
        awardGenerationPoints();
        // fire-and-forget — let the microtasks flush
        await new Promise((r) => setTimeout(r, 0));
      }
    );
    expect(state.userPoints['0xdd'].points).toBe(POINTS_PER_GENERATION);
    expect(state.userPoints['0xdd'].generationCount).toBe(1);
  });

  it('no-ops for a non-generation route', async () => {
    await withCostScope(
      { userId: '0xdd', route: 'trpc:profiles.upsert', requestId: 'req-2' },
      async () => {
        awardGenerationPoints();
        await new Promise((r) => setTimeout(r, 0));
      }
    );
    expect(state.userPoints).toBeUndefined();
  });

  it('no-ops for an anonymous request', async () => {
    await withCostScope(
      { userId: null, route: 'trpc:generation.generate', requestId: 'req-3' },
      async () => {
        awardGenerationPoints();
        await new Promise((r) => setTimeout(r, 0));
      }
    );
    expect(state.userPoints).toBeUndefined();
  });
});

describe('getLeaderboard', () => {
  beforeEach(seedLeaderboard);

  it('orders by points desc and assigns a 1-based rank', async () => {
    const rows = await getLeaderboard();
    expect(rows.map((r) => r.userId)).toEqual(['0xbbb', '0xaaa', '0xccc']);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.points)).toEqual([120, 50, 30]);
  });

  it('carries the per-kind activity counters through', async () => {
    const [top] = await getLeaderboard();
    expect(top).toMatchObject({ universeCount: 1, generationCount: 11 });
  });

  it('hydrates profile fields when a profile row exists', async () => {
    const rows = await getLeaderboard();
    const bob = rows.find((r) => r.userId === '0xbbb')!;
    expect(bob).toMatchObject({
      username: 'bob',
      displayName: 'Bob',
      avatarUrl: 'https://cdn/b.png',
    });
  });

  it('leaves display fields null when there is no profile row', async () => {
    const rows = await getLeaderboard();
    const aaa = rows.find((r) => r.userId === '0xaaa')!;
    expect(aaa).toMatchObject({ username: null, displayName: null, avatarUrl: null });
  });

  it('coerces an empty-string avatarUrl to null but keeps other fields', async () => {
    const rows = await getLeaderboard();
    const cara = rows.find((r) => r.userId === '0xccc')!;
    expect(cara.avatarUrl).toBeNull();
    expect(cara.username).toBe('cara');
    expect(cara.displayName).toBeNull();
  });

  it('applies the caller-supplied limit', async () => {
    const rows = await getLeaderboard(2);
    expect(rows.map((r) => r.userId)).toEqual(['0xbbb', '0xaaa']);
  });

  it('clamps a limit below 1 up to a single row', async () => {
    expect(await getLeaderboard(0)).toHaveLength(1);
    expect(await getLeaderboard(-10)).toHaveLength(1);
  });

  it('returns [] when there are no scored users', async () => {
    delete state.userPoints;
    expect(await getLeaderboard()).toEqual([]);
  });
});

describe('getMyPoints', () => {
  beforeEach(seedLeaderboard);

  it('returns the caller totals with a 1-based rank, lower-casing the id', async () => {
    expect(await getMyPoints('0xAAA')).toEqual({
      userId: '0xaaa',
      points: 50,
      universeCount: 2,
      generationCount: 3,
      rank: 2,
    });
  });

  it('ranks the highest scorer #1', async () => {
    expect((await getMyPoints('0xbbb')).rank).toBe(1);
  });

  it('returns a zeroed record with null rank for a user with no ledger row', async () => {
    expect(await getMyPoints('0xdoesnotexist')).toEqual({
      userId: '0xdoesnotexist',
      points: 0,
      universeCount: 0,
      generationCount: 0,
      rank: null,
    });
  });

  it('leaves rank null when the row exists but points are 0', async () => {
    state.userPoints!['0xzero'] = {
      userId: '0xzero',
      points: 0,
      universeCount: 1,
      generationCount: 0,
    };
    const me = await getMyPoints('0xzero');
    expect(me).toMatchObject({ points: 0, universeCount: 1, rank: null });
  });

  it('counts every strictly-higher scorer, not ties', async () => {
    state.userPoints!['0xaaa2'] = {
      userId: '0xaaa2',
      points: 50,
      universeCount: 0,
      generationCount: 5,
    };
    // 0xaaa and 0xaaa2 both have 50; only 0xbbb (120) is strictly ahead.
    expect((await getMyPoints('0xaaa')).rank).toBe(2);
    expect((await getMyPoints('0xaaa2')).rank).toBe(2);
  });
});
