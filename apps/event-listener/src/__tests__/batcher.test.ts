import { describe, expect, it, vi } from 'vitest';
import { Batcher, buildEnvelope } from '../batcher';
import { db } from '../firestore';

const mockDb = db as any;

describe('Batcher', () => {
  it('stages set, update, and delete operations and reports size', () => {
    const batcher = new Batcher();
    const ref = { id: 'doc-1' } as any;
    batcher.set(ref, { a: 1 });
    batcher.update(ref, { b: 2 });
    batcher.delete(ref);
    expect(batcher.size()).toBe(3);
  });

  it('splits commits into 500-op chunks', async () => {
    const batcher = new Batcher();
    for (let i = 0; i < 1500; i++) {
      batcher.set({ id: `doc-${i}` } as any, { i });
    }
    expect(batcher.size()).toBe(1500);
    await batcher.commit();

    expect(mockDb.batch).toHaveBeenCalledTimes(3);
    const batches = mockDb.batch.mock.results.map((r: any) => r.value);
    expect(batches).toHaveLength(3);
    for (const batch of batches) {
      expect(batch._ops.set.length).toBe(500);
    }
  });

  it('propagates commit errors', async () => {
    const batcher = new Batcher();
    const failing = {
      set: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      commit: vi.fn().mockRejectedValue(new Error('boom')),
    };
    mockDb.batch.mockReturnValueOnce(failing as any);
    batcher.set({ id: 'doc' } as any, { a: 1 });
    await expect(batcher.commit()).rejects.toThrow('boom');
  });

  it('clears staged operations after a successful commit', async () => {
    const batcher = new Batcher();
    batcher.set({ id: 'doc' } as any, { a: 1 });
    await batcher.commit();
    expect(batcher.size()).toBe(0);
  });
});

describe('buildEnvelope', () => {
  it('lowercases block and transaction hashes and carries the chain id', () => {
    const envelope = buildEnvelope({
      blockNumber: 123,
      blockHash: '0xABC123',
      txHash: '0xDEF456',
      logIndex: 7,
      unconfirmed: true,
    });

    expect(envelope.chainId).toBe(11155111);
    expect(envelope.blockNumber).toBe(123);
    expect(envelope.blockHash).toBe('0xabc123');
    expect(envelope.txHash).toBe('0xdef456');
    expect(envelope.logIndex).toBe(7);
    expect(envelope.unconfirmed).toBe(true);
    expect(envelope.indexedAt).toEqual({ _mock: 'serverTimestamp' });
  });
});
