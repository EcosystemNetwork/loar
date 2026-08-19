import { describe, expect, it, vi } from 'vitest';
import { runClaimedAggregateMutation } from '../idempotency';

function createFirestore() {
  const claims = new Map<string, any>();
  const writes: any[] = [];

  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        id,
        get: () => Promise.resolve({ exists: claims.has(id), data: () => claims.get(id) }),
      }),
    }),
    runTransaction: async (fn: any) => {
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: any) => {
          writes.push({ ref, data, kind: 'set' });
        },
        create: (ref: any, data: any) => {
          writes.push({ ref, data, kind: 'create' });
        },
        update: vi.fn(),
        delete: vi.fn(),
      };
      const result = await fn(tx);
      if (result) {
        for (const w of writes) {
          claims.set(w.ref.id, w.data);
        }
      }
      return result;
    },
  } as any;
}

describe('runClaimedAggregateMutation', () => {
  it('applies the mutation and records the claim for an unprocessed event', async () => {
    const firestore = createFirestore();
    const envelope = { txHash: '0xabc', logIndex: 1 } as any;
    const mutate = vi.fn(async (tx: any) => {
      tx.update('ref', { count: 1 });
      return true;
    });

    const ok = await runClaimedAggregateMutation(firestore, 'tally', envelope, mutate);
    expect(ok).toBe(true);
    expect(mutate).toHaveBeenCalledOnce();

    const nope = await runClaimedAggregateMutation(firestore, 'tally', envelope, mutate);
    expect(nope).toBe(false);
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('does not record the claim when the inner mutation returns false', async () => {
    const firestore = createFirestore();
    const envelope = { txHash: '0xdef', logIndex: 2 } as any;
    const mutate = vi.fn().mockResolvedValue(false);

    const first = await runClaimedAggregateMutation(firestore, 'tally', envelope, mutate);
    expect(first).toBe(false);

    const second = await runClaimedAggregateMutation(firestore, 'tally', envelope, mutate);
    expect(second).toBe(false);
    expect(mutate).toHaveBeenCalledTimes(2);
  });
});
