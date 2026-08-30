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

  // Serialize transactions the way Firestore does — a concurrent
  // transaction retries against committed state rather than racing.
  let lock: Promise<unknown> = Promise.resolve();

  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => ({ collection, id }),
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

import { awardPoints, awardGenerationPoints, POINTS_PER_GENERATION } from './index';
import { withCostScope } from '../cost-tracker/scope';

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
