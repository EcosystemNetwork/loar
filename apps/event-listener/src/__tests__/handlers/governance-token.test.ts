import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Batcher, buildEnvelope } from '../../batcher';
import { db } from '../../firestore';
import { governanceTokenHandlers } from '../../handlers/governance-token';

const mockDb = db as any;

const token = '0x1111111111111111111111111111111111111111';
const from = '0x2222222222222222222222222222222222222222';
const to = '0x3333333333333333333333333333333333333333';
const ZERO = '0x0000000000000000000000000000000000000000';

function findHandler(event: string) {
  const h = governanceTokenHandlers.find((x) => x.event === event);
  if (!h) throw new Error(`Missing handler for ${event}`);
  return h;
}

function createCtx(args: Record<string, any>) {
  return {
    log: { address: token } as any,
    args,
    address: token,
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
    client: { readContract: vi.fn() },
  } as any;
}

describe('GovernanceToken handlers', () => {
  beforeEach(() => {
    mockDb.runTransaction.mockImplementation(async (fn: any) => {
      const tx = {
        get: vi.fn(async (ref: any) => {
          if (ref.id.includes('token-holder-balance')) {
            return { exists: false, data: () => null };
          }
          return {
            exists: true,
            data: () => ({
              id: 'holder',
              tokenAddress: token,
              holderAddress: to,
              balance: '500',
            }),
          };
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

  it('Transfer writes a TokenTransfer and updates the recipient balance', async () => {
    const ctx = createCtx({ from, to, amount: 100n });
    await findHandler('Transfer').run(ctx);
    await ctx.batcher.commit();

    const batch = mockDb.batch.mock.results[0]!.value;
    const transferWrite = batch._ops.set[0];
    expect(transferWrite.data).toMatchObject({
      tokenAddress: token,
      from,
      to,
      value: '100',
    });

    const tx = await mockDb.runTransaction.mock.results[1]!.value;
    expect(tx.update).toHaveBeenCalledWith(expect.anything(), { balance: '600' });
  });

  it('Transfer mints a new holder when the recipient has no prior balance', async () => {
    mockDb.runTransaction.mockImplementation(async (fn: any) => {
      const tx = {
        get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        create: vi.fn(),
      };
      await fn(tx);
      return tx;
    });

    const ctx = createCtx({ from: ZERO, to, amount: 250n });
    await findHandler('Transfer').run(ctx);

    const tx = await mockDb.runTransaction.mock.results[0]!.value;
    expect(tx.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tokenAddress: token,
        holderAddress: to,
        balance: '250',
      })
    );
    expect(tx.update).not.toHaveBeenCalled();
  });
});
