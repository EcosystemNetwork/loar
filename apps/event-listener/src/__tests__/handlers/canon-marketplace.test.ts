import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Batcher, buildEnvelope } from '../../batcher';
import { db } from '../../firestore';
import { canonMarketplaceHandlers } from '../../handlers/canon-marketplace';
import { chainId } from '../../rpc';

const mockDb = db as any;

const canon = '0x1111111111111111111111111111111111111111';
const creator = '0x2222222222222222222222222222222222222222';
const voter = '0x3333333333333333333333333333333333333333';
const universeToken = '0x4444444444444444444444444444444444444444';

function findHandler(event: string) {
  const h = canonMarketplaceHandlers.find((x) => x.event === event);
  if (!h) throw new Error(`Missing handler for ${event}`);
  return h;
}

function createCtx(args: Record<string, any>, readContract = vi.fn()) {
  return {
    log: { address: canon } as any,
    args,
    address: canon,
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
    batcher: new Batcher(),
    client: { readContract },
  } as any;
}

describe('CanonMarketplace handlers', () => {
  beforeEach(() => {
    mockDb.runTransaction.mockImplementation(async (fn: any) => {
      const tx = {
        get: vi.fn(async (ref: any) => {
          if (ref.id.includes('canon-submission-votes')) {
            return { exists: false, data: () => null };
          }
          if (ref.id === `${chainId}:1`) {
            return {
              exists: true,
              data: () => ({ id: '1', votesFor: '0', votesAgainst: '0' }),
            };
          }
          return { exists: false, data: () => null };
        }),
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        create: vi.fn(),
      };
      await fn(tx);
      return tx;
    });
  });

  it('SubmissionCreated writes the submission from on-chain data', async () => {
    const readContract = vi
      .fn()
      .mockResolvedValue([
        1n,
        42n,
        universeToken,
        0,
        1,
        creator,
        '0x00000000000000000000000000000000000000000000000000000000deadbeef',
        'ipfs://metadata',
        1000n,
        0n,
        0n,
        1_700_000_100n,
        0n,
        0n,
      ]);

    const ctx = createCtx(
      {
        id: 1n,
        universeId: 42n,
        subType: 0,
        creator,
        contentHash: '0x00000000000000000000000000000000000000000000000000000000deadbeef',
      },
      readContract
    );

    await findHandler('SubmissionCreated').run(ctx);
    await ctx.batcher.commit();

    const batch = mockDb.batch.mock.results[0]!.value;
    const write = batch._ops.set[0];
    expect(write.data).toMatchObject({
      id: '1',
      universeId: 42,
      universeToken: universeToken.toLowerCase(),
      submissionType: 0,
      status: 1,
      creator: creator.toLowerCase(),
      metadataURI: 'ipfs://metadata',
      submissionFee: '1000',
      votesFor: '0',
      votesAgainst: '0',
      votingDeadline: 1_700_000_100,
    });
  });

  it('VoteCast writes a vote and updates the submission tally', async () => {
    const ctx = createCtx({
      submissionId: 1n,
      voter,
      support: true,
      weight: 25n,
    });

    await findHandler('VoteCast').run(ctx);
    await ctx.batcher.commit();

    const batch = mockDb.batch.mock.results[0]!.value;
    const voteWrite = batch._ops.set[0];
    expect(voteWrite.data).toMatchObject({
      submissionId: 1,
      voter: voter.toLowerCase(),
      support: true,
      weight: '25',
    });

    const tx = await mockDb.runTransaction.mock.results[0]!.value;
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), { votesFor: '25' });
  });

  it('SubmissionAccepted marks the submission as accepted', async () => {
    const ctx = createCtx({ submissionId: 1n });

    await findHandler('SubmissionAccepted').run(ctx);
    await ctx.batcher.commit();

    const batch = mockDb.batch.mock.results[0]!.value;
    const update = batch._ops.update[0];
    expect(update.data).toMatchObject({ status: 2, finalizedAt: ctx.block.timestamp });
  });
});
