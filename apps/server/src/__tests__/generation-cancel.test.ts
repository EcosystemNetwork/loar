import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelGenerationRecord,
  dequeueGenerationJob,
  isGenerationCancelled,
} from '../lib/generation-cancel';
import { finalizeGenerationFailure } from '../lib/refund-audit';

const { getJob, releaseJobSpendHold } = vi.hoisted(() => ({
  getJob: vi.fn(),
  releaseJobSpendHold: vi.fn(async (_job: unknown) => {}),
}));
vi.mock('../lib/queue', () => ({ getGenerationQueue: () => ({ getJob }) }));
vi.mock('../lib/video-budget', () => ({ releaseJobSpendHold }));

type Doc = Record<string, unknown>;

/** Minimal in-memory Firestore: collection().doc().get(), runTransaction with tx.get/update. */
function createDb(initial: Record<string, Doc>) {
  const state = structuredClone(initial);
  const refFor = (id: string) => ({ id });
  const snap = (id: string) => ({
    exists: id in state,
    data: () => (id in state ? structuredClone(state[id]) : undefined),
  });
  const db = {
    collection: () => ({ doc: (id: string) => ({ ...refFor(id), get: async () => snap(id) }) }),
    runTransaction: async (cb: (tx: any) => Promise<unknown>) => {
      const writes: Array<[string, Doc]> = [];
      const result = await cb({
        get: async (ref: { id: string }) => snap(ref.id),
        update: (ref: { id: string }, data: Doc) => writes.push([ref.id, data]),
      });
      for (const [id, data] of writes) state[id] = { ...state[id], ...data };
      return result;
    },
  };
  return { db: db as any, state };
}

describe('cancelGenerationRecord', () => {
  it('flips a queued generation to cancelled and reports its charge', async () => {
    const { db, state } = createDb({ g1: { userId: 'u1', status: 'queued', creditsCharged: 4 } });
    const out = await cancelGenerationRecord(db, {
      generationId: 'g1',
      userId: 'u1',
      reason: 'changed my mind',
    });
    expect(out).toEqual({ kind: 'cancelled', creditsCharged: 4, creditsRefunded: false });
    expect(state.g1).toMatchObject({ status: 'cancelled', cancelReason: 'changed my mind' });
  });

  it('never relabels a terminal generation', async () => {
    for (const status of ['completed', 'failed', 'cancelled']) {
      const { db, state } = createDb({ g1: { userId: 'u1', status } });
      const out = await cancelGenerationRecord(db, { generationId: 'g1', userId: 'u1' });
      expect(out).toEqual({ kind: 'already_terminal', status });
      expect(state.g1.status).toBe(status);
    }
  });

  it("refuses another user's generation without touching it", async () => {
    const { db, state } = createDb({ g1: { userId: 'u1', status: 'running' } });
    const out = await cancelGenerationRecord(db, { generationId: 'g1', userId: 'intruder' });
    expect(out).toEqual({ kind: 'not_owner' });
    expect(state.g1.status).toBe('running');
  });

  it('reports a missing generation', async () => {
    const { db } = createDb({});
    expect(await cancelGenerationRecord(db, { generationId: 'nope', userId: 'u1' })).toEqual({
      kind: 'not_found',
    });
  });

  it('is idempotent: a second cancel is a no-op', async () => {
    const { db } = createDb({ g1: { userId: 'u1', status: 'running' } });
    await cancelGenerationRecord(db, { generationId: 'g1', userId: 'u1' });
    const second = await cancelGenerationRecord(db, { generationId: 'g1', userId: 'u1' });
    expect(second).toEqual({ kind: 'already_terminal', status: 'cancelled' });
  });
});

describe('isGenerationCancelled', () => {
  it('is true only for a cancelled record', async () => {
    const { db } = createDb({
      a: { status: 'cancelled' },
      b: { status: 'running' },
    });
    expect(await isGenerationCancelled(db, 'a')).toBe(true);
    expect(await isGenerationCancelled(db, 'b')).toBe(false);
    expect(await isGenerationCancelled(db, 'missing')).toBe(false);
  });
});

describe('finalizeGenerationFailure vs cancel', () => {
  it('leaves a cancelled generation cancelled instead of marking it failed', async () => {
    const { db, state } = createDb({ g1: { userId: 'u1', status: 'cancelled' } });
    const out = await finalizeGenerationFailure(db, {
      userId: 'u1',
      generationId: 'g1',
      creditsCharged: 0,
      failureReason: 'provider failed',
      latencyMs: 10,
    });
    expect(out).toBe('already_cancelled');
    expect(state.g1.status).toBe('cancelled');
  });
});

describe('dequeueGenerationJob', () => {
  beforeEach(() => {
    releaseJobSpendHold.mockClear();
    getJob.mockReset();
  });

  const fakeJob = (state: string, remove = vi.fn(async () => {})) => ({
    getState: async () => state,
    remove,
  });

  it('removes a waiting job and releases its spend hold', async () => {
    const job = fakeJob('waiting');
    getJob.mockResolvedValue(job);
    expect(await dequeueGenerationJob('g1')).toBe('removed');
    expect(job.remove).toHaveBeenCalledOnce();
    expect(releaseJobSpendHold).toHaveBeenCalledWith(job);
  });

  it('leaves a running job alone (the provider call is already in flight)', async () => {
    const job = fakeJob('active');
    getJob.mockResolvedValue(job);
    expect(await dequeueGenerationJob('g1')).toBe('running');
    expect(job.remove).not.toHaveBeenCalled();
    expect(releaseJobSpendHold).not.toHaveBeenCalled();
  });

  it('reports not_queued when there is no job, or the queue is unreachable', async () => {
    getJob.mockResolvedValue(null);
    expect(await dequeueGenerationJob('g1')).toBe('not_queued');
    getJob.mockRejectedValue(new Error('redis down'));
    expect(await dequeueGenerationJob('g1')).toBe('not_queued');
  });

  it('does not throw when removal races the worker picking the job up', async () => {
    getJob.mockResolvedValue(
      fakeJob(
        'waiting',
        vi.fn(async () => {
          throw new Error('job is locked');
        })
      )
    );
    expect(await dequeueGenerationJob('g1')).toBe('not_queued');
    expect(releaseJobSpendHold).not.toHaveBeenCalled();
  });
});
