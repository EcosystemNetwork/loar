import { describe, expect, it } from 'vitest';
import { finalizeGenerationFailure } from '../lib/refund-audit';

type StoredDoc = Record<string, unknown>;
type PendingWrite = { collection: string; id: string; data: StoredDoc; merge: boolean };

function createDb(initial: Record<string, Record<string, StoredDoc>>) {
  const state = structuredClone(initial);
  let failNextCommit = false;

  const db = {
    collection: (collection: string) => ({
      doc: (id: string) => ({ collection, id }),
    }),
    runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
      const writes: PendingWrite[] = [];
      const result = await callback({
        get: async (ref: { collection: string; id: string }) => {
          const data = state[ref.collection]?.[ref.id];
          return { exists: Boolean(data), data: () => structuredClone(data) };
        },
        set: (
          ref: { collection: string; id: string },
          data: StoredDoc,
          options?: { merge?: boolean }
        ) => {
          writes.push({ ...ref, data, merge: options?.merge === true });
        },
        update: (ref: { collection: string; id: string }, data: StoredDoc) => {
          writes.push({ ...ref, data, merge: true });
        },
      });

      if (failNextCommit) {
        failNextCommit = false;
        throw new Error('commit failed');
      }

      for (const write of writes) {
        state[write.collection] ??= {};
        state[write.collection][write.id] = write.merge
          ? { ...state[write.collection][write.id], ...structuredClone(write.data) }
          : structuredClone(write.data);
      }
      return result;
    },
  };

  return {
    db: db as any,
    state,
    failNextTransaction: () => {
      failNextCommit = true;
    },
  };
}

const failure = {
  userId: 'user-1',
  generationId: 'generation-1',
  creditsCharged: 13,
  failureReason: 'provider failed',
  latencyMs: 1500,
};

// Credits/points are retired (BYOK) — `finalizeGenerationFailure` no longer
// touches any balance; it only marks the generation failed and always
// reports 'not_charged'.
describe('finalizeGenerationFailure', () => {
  it('marks the generation failed without refunding, and is replay-safe', async () => {
    const { db, state } = createDb({
      userCredits: { 'user-1': { balance: 87, totalSpent: 13 } },
      videoGenerations: { 'generation-1': { status: 'running' } },
    });

    expect(await finalizeGenerationFailure(db, failure)).toBe('not_charged');
    expect(await finalizeGenerationFailure(db, failure)).toBe('not_charged');

    // Balance is never touched now.
    expect(state.userCredits['user-1']).toEqual({ balance: 87, totalSpent: 13 });
    expect(state.videoGenerations['generation-1']).toMatchObject({
      status: 'failed',
      failureReason: 'provider failed',
    });
  });

  it('commits the failed status atomically across a retry', async () => {
    const { db, state, failNextTransaction } = createDb({
      userCredits: { 'user-1': { balance: 87, totalSpent: 13 } },
      videoGenerations: { 'generation-1': { status: 'running' } },
    });
    failNextTransaction();

    await expect(finalizeGenerationFailure(db, failure)).rejects.toThrow('commit failed');
    expect(state.userCredits['user-1']).toEqual({ balance: 87, totalSpent: 13 });
    expect(state.videoGenerations['generation-1']).toEqual({ status: 'running' });

    expect(await finalizeGenerationFailure(db, failure)).toBe('not_charged');
    expect(state.userCredits['user-1']).toEqual({ balance: 87, totalSpent: 13 });
    expect(state.videoGenerations['generation-1']).toMatchObject({ status: 'failed' });
  });
});
