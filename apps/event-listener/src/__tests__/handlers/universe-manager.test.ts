import { describe, expect, it, vi } from 'vitest';
import { Batcher, buildEnvelope } from '../../batcher';
import { db } from '../../firestore';
import { universeManagerHandlers } from '../../handlers/universe-manager';
import { getChildren } from '../../factory';

const mockDb = db as any;

const addresses = {
  universeManager: '0x1111111111111111111111111111111111111111',
  universe: '0x2222222222222222222222222222222222222222',
  creator: '0x3333333333333333333333333333333333333333',
};

function findHandler(event: string) {
  const h = universeManagerHandlers.find((x) => x.event === event);
  if (!h) throw new Error(`Missing handler for ${event}`);
  return h;
}

function createCtx(args: Record<string, any>) {
  const readContract = vi.fn();
  const client = { readContract };
  const batcher = new Batcher();
  return {
    log: { address: addresses.universeManager } as any,
    args,
    address: addresses.universeManager,
    block: { number: 123, hash: '0xblock', timestamp: 1_700_000_000 },
    txHash: '0xtx',
    logIndex: 4,
    eventId: '0xtx:4',
    envelope: buildEnvelope({
      blockNumber: 123,
      blockHash: '0xblock',
      txHash: '0xtx',
      logIndex: 4,
      unconfirmed: false,
    }),
    batcher,
    client,
  };
}

describe('UniverseManager handlers', () => {
  it('UniverseCreated writes a universe doc and registers a factory child', async () => {
    const ctx = createCtx({ universe: addresses.universe, creator: addresses.creator });
    ctx.client.readContract
      .mockResolvedValueOnce('The Expanse')
      .mockResolvedValueOnce('A space opera')
      .mockResolvedValueOnce('ipfs://cover');

    await findHandler('UniverseCreated').run(ctx as any);
    await ctx.batcher.commit();

    expect(ctx.client.readContract).toHaveBeenCalledTimes(3);
    expect(mockDb.batch).toHaveBeenCalledOnce();

    const batch = mockDb.batch.mock.results[0]!.value;
    expect(batch._ops.set.length).toBe(1);

    const universeWrite = batch._ops.set[0];
    expect(universeWrite.data).toMatchObject({
      id: addresses.universe,
      creator: addresses.creator,
      name: 'The Expanse',
      description: 'A space opera',
      imageURL: 'ipfs://cover',
      nodeCount: 0,
      tokenAddress: null,
      governorAddress: null,
      _event: expect.objectContaining({ chainId: 11155111 }),
    });

    expect(mockDb.collection).toHaveBeenCalledWith('indexer_factoryChildren');
    const childDoc = mockDb
      .collection('indexer_factoryChildren')
      .doc.mock.results.find((r: any) => r.value.id === `sepolia:${addresses.universe}`)?.value;
    expect(childDoc).toBeDefined();
    expect(childDoc.set).toHaveBeenCalledOnce();
    expect(childDoc.set.mock.calls[0][0]).toMatchObject({
      kind: 'universe',
      childAddress: addresses.universe,
      factoryAddress: addresses.universeManager,
    });
    expect(childDoc.set.mock.calls[0][1]).toEqual({ merge: true });

    expect(getChildren('universe')).toContain(addresses.universe);
  });

  it('UniverseCreated falls back to safe defaults when contract reads fail', async () => {
    const ctx = createCtx({ universe: addresses.universe, creator: addresses.creator });
    ctx.client.readContract.mockRejectedValue(new Error('rpc unavailable'));

    await findHandler('UniverseCreated').run(ctx as any);
    await ctx.batcher.commit();

    const batch = mockDb.batch.mock.results[0]!.value;
    const universeWrite = batch._ops.set[0];
    expect(universeWrite.data).toMatchObject({
      name: 'Untitled Universe',
      description: 'A narrative universe',
      imageURL: '',
    });
  });
});
