import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Batcher, buildEnvelope } from '../../batcher';
import { db } from '../../firestore';
import { bondingCurveHandlers } from '../../handlers/bonding-curve';
import { chainId } from '../../rpc';

const mockDb = db as any;

const curve = '0x1111111111111111111111111111111111111111';
const buyer = '0x2222222222222222222222222222222222222222';

function findHandler(event: string) {
  const h = bondingCurveHandlers.find((x) => x.event === event);
  if (!h) throw new Error(`Missing handler for ${event}`);
  return h;
}

function createCtx(args: Record<string, any>) {
  return {
    log: { address: curve } as any,
    args,
    address: curve,
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

describe('BondingCurve handlers', () => {
  beforeEach(() => {
    mockDb.runTransaction.mockImplementation(async (fn: any) => {
      const tx = {
        get: vi.fn(async (ref: any) => {
          if (ref.id.includes('bonding-curve-trade') || ref.id.includes('bonding-curve-refund')) {
            return { exists: false, data: () => null };
          }
          if (ref.id === `${chainId}:${curve}`) {
            return {
              exists: true,
              data: () => ({
                id: `${chainId}:${curve}`,
                tokensSold: '1000',
                ethRaised: '1000',
                tradeCount: 5,
                pendingRefundsTotal: '100',
              }),
            };
          }
          if (ref.id === `${chainId}:${curve}:${buyer}`) {
            return {
              exists: true,
              data: () => ({
                id: `${chainId}:${curve}:${buyer}`,
                bondingCurve: curve,
                buyer,
                amount: '100',
                pendingSince: 1_700_000_000,
                claimedAt: null,
                lastEventId: 'prev',
              }),
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

  it('TokensPurchased writes a trade and updates the curve aggregate', async () => {
    const ctx = createCtx({
      buyer,
      ethAmount: 1000n,
      tokenAmount: 500n,
      newPrice: 3n,
    });

    await findHandler('TokensPurchased').run(ctx);
    await ctx.batcher.commit();

    const batch = mockDb.batch.mock.results[0]!.value;
    const tradeWrite = batch._ops.set[0];
    expect(tradeWrite.data).toMatchObject({
      bondingCurve: curve,
      trader: buyer.toLowerCase(),
      isBuy: true,
      ethAmount: '1000',
      tokenAmount: '500',
      price: '3',
    });

    const tx = await mockDb.runTransaction.mock.results[0]!.value;
    expect(tx.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tokensSold: '1500',
        ethRaised: '2000',
        lastPrice: '3',
        tradeCount: 6,
      })
    );
  });

  it('RefundPending increments the pending refund total', async () => {
    const ctx = createCtx({
      buyer,
      amount: 50n,
    });

    await findHandler('RefundPending').run(ctx);

    const tx = await mockDb.runTransaction.mock.results[0]!.value;
    expect(tx.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pendingRefundsTotal: '150' })
    );
  });
});
