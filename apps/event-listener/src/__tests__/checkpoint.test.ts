import { describe, expect, it, vi } from 'vitest';
import { loadCheckpoint, writeCheckpoint } from '../checkpoint';
import { db } from '../firestore';

const mockDb = db as any;

describe('checkpoint', () => {
  it('returns null for a missing checkpoint', async () => {
    const cp = await loadCheckpoint();
    expect(cp).toBeNull();
  });

  it('maps a stored checkpoint into an IndexerCheckpoint', async () => {
    const get = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({
        lastBlockIndexed: 100,
        lastBlockFinalized: 85,
        headBlockKnown: 120,
        chain: 'sepolia',
      }),
    });
    const doc = { id: 'sepolia', get, set: vi.fn(), update: vi.fn(), delete: vi.fn() };
    mockDb.collection('indexer_checkpoints').doc.mockReturnValue(doc);

    const cp = await loadCheckpoint();
    expect(cp).not.toBeNull();
    expect(cp!.lastBlockIndexed).toBe(100);
    expect(cp!.lastBlockFinalized).toBe(85);
    expect(cp!.headBlockKnown).toBe(120);
    expect(cp!.chain).toBe('sepolia');
  });

  it('writes lastBlockFinalized using the configured finality depth', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const doc = {
      id: 'sepolia',
      get: vi.fn().mockResolvedValue({ exists: false }),
      set,
      update: vi.fn(),
      delete: vi.fn(),
    };
    mockDb.collection('indexer_checkpoints').doc.mockReturnValue(doc);

    await writeCheckpoint(100, 120);
    expect(set).toHaveBeenCalledOnce();
    const [data, options] = set.mock.calls[0] as any;
    expect(data).toMatchObject({
      chain: 'sepolia',
      chainId: 11155111,
      lastBlockIndexed: 100,
      lastBlockFinalized: 85, // 100 - 15
      headBlockKnown: 120,
    });
    expect(options).toEqual({ merge: true });
  });
});
