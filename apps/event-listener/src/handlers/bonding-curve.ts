/**
 * BondingCurve handlers.
 * Events: TokensPurchased, TokensSold, RefundPending, RefundClaimed,
 * TradingHaltedByManager, Graduated.
 *
 * Every buy/sell both inserts a trade row AND mutates the curve aggregates +
 * inserts a snapshot (Ponder's applyTradeToCurve helper). We replicate that
 * pattern using Firestore transactions so tokensSold/ethRaised don't race
 * between concurrent handlers on the same curve.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { logger } from '../logger.js';
import {
  COLLECTIONS,
  type Hex,
  type BondingCurve,
  type BondingCurveTrade,
  type BondingCurveSnapshot,
  type BondingCurveRefund,
  type BondingCurveHaltEvent,
} from '../schema.js';
import type { Handler, HandlerCtx } from './types.js';

const tokensPurchasedEvent = parseAbiItem(
  'event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount, uint256 newPrice)'
);
const tokensSoldEvent = parseAbiItem(
  'event TokensSold(address indexed seller, uint256 tokenAmount, uint256 ethReturned, uint256 newPrice)'
);
const refundPendingEvent = parseAbiItem(
  'event RefundPending(address indexed buyer, uint256 amount)'
);
const refundClaimedEvent = parseAbiItem(
  'event RefundClaimed(address indexed buyer, uint256 amount)'
);
const tradingHaltedByManagerEvent = parseAbiItem(
  'event TradingHaltedByManager(uint256 indexed universeId, bool halted)'
);
const graduatedEvent = parseAbiItem(
  'event Graduated(uint256 indexed universeId, address indexed token, uint256 ethRaised, uint256 lpTokens)'
);

/**
 * Apply a buy/sell to the curve aggregates + emit a snapshot. Uses a
 * transaction so two concurrent trades can't both read the same `tokensSold`.
 * Must run OUTSIDE the batcher (transactions are their own write scope).
 */
async function applyTrade(args: {
  curveAddr: Hex;
  deltaTokensSold: bigint;
  deltaEthRaised: bigint;
  newPrice: bigint;
  timestamp: number;
  blockNumber: number;
  trigger: 'buy' | 'sell';
  snapshotId: string;
  envelope: BondingCurve['_event'];
}): Promise<void> {
  const curveRef = db.collection(COLLECTIONS.bondingCurves).doc(args.curveAddr);
  const snapRef = db.collection(COLLECTIONS.bondingCurveSnapshots).doc(args.snapshotId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(curveRef);
    if (!snap.exists) {
      logger.warn(
        { curveAddr: args.curveAddr },
        'trade for unknown curve — skipping aggregate update'
      );
      return;
    }
    const row = snap.data() as BondingCurve;
    const nextTokensSold = BigInt(row.tokensSold) + args.deltaTokensSold;
    const nextEthRaised = BigInt(row.ethRaised) + args.deltaEthRaised;
    const clampedTokens = nextTokensSold < 0n ? 0n : nextTokensSold;
    const clampedEth = nextEthRaised < 0n ? 0n : nextEthRaised;

    tx.update(curveRef, {
      tokensSold: clampedTokens.toString(),
      ethRaised: clampedEth.toString(),
      lastPrice: args.newPrice.toString(),
      tradeCount: row.tradeCount + 1,
    });

    const snapshot: BondingCurveSnapshot = {
      id: args.snapshotId,
      bondingCurve: args.curveAddr,
      blockNumber: args.blockNumber,
      timestamp: args.timestamp,
      tokensSold: clampedTokens.toString(),
      ethRaised: clampedEth.toString(),
      price: args.newPrice.toString(),
      trigger: args.trigger,
      _event: args.envelope,
    };
    tx.set(snapRef, snapshot);
  });
}

const tokensPurchased: Handler<typeof tokensPurchasedEvent> = {
  kind: 'BondingCurve',
  event: 'TokensPurchased',
  abi: tokensPurchasedEvent,
  async run(ctx) {
    const curveAddr = ctx.address;
    const trade: BondingCurveTrade = {
      id: ctx.eventId,
      bondingCurve: curveAddr,
      trader: getAddress(ctx.args.buyer).toLowerCase() as Hex,
      isBuy: true,
      ethAmount: ctx.args.ethAmount.toString(),
      tokenAmount: ctx.args.tokenAmount.toString(),
      price: ctx.args.newPrice.toString(),
      timestamp: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.bondingCurveTrades).doc(ctx.eventId), trade);

    await applyTrade({
      curveAddr,
      deltaTokensSold: ctx.args.tokenAmount,
      deltaEthRaised: ctx.args.ethAmount,
      newPrice: ctx.args.newPrice,
      timestamp: ctx.block.timestamp,
      blockNumber: ctx.block.number,
      trigger: 'buy',
      snapshotId: `${ctx.eventId}:snap`,
      envelope: ctx.envelope,
    });
  },
};

const tokensSold: Handler<typeof tokensSoldEvent> = {
  kind: 'BondingCurve',
  event: 'TokensSold',
  abi: tokensSoldEvent,
  async run(ctx) {
    const curveAddr = ctx.address;
    const trade: BondingCurveTrade = {
      id: ctx.eventId,
      bondingCurve: curveAddr,
      trader: getAddress(ctx.args.seller).toLowerCase() as Hex,
      isBuy: false,
      ethAmount: ctx.args.ethReturned.toString(),
      tokenAmount: ctx.args.tokenAmount.toString(),
      price: ctx.args.newPrice.toString(),
      timestamp: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.bondingCurveTrades).doc(ctx.eventId), trade);

    await applyTrade({
      curveAddr,
      deltaTokensSold: -ctx.args.tokenAmount,
      deltaEthRaised: -ctx.args.ethReturned,
      newPrice: ctx.args.newPrice,
      timestamp: ctx.block.timestamp,
      blockNumber: ctx.block.number,
      trigger: 'sell',
      snapshotId: `${ctx.eventId}:snap`,
      envelope: ctx.envelope,
    });
  },
};

const refundPending: Handler<typeof refundPendingEvent> = {
  kind: 'BondingCurve',
  event: 'RefundPending',
  abi: refundPendingEvent,
  async run(ctx) {
    const curveAddr = ctx.address;
    const buyer = getAddress(ctx.args.buyer).toLowerCase() as Hex;
    const id = `${curveAddr}:${buyer}`;

    const curveRef = db.collection(COLLECTIONS.bondingCurves).doc(curveAddr);
    const refundRef = db.collection(COLLECTIONS.bondingCurveRefunds).doc(id);

    await db.runTransaction(async (tx) => {
      const [curveSnap, refundSnap] = await Promise.all([tx.get(curveRef), tx.get(refundRef)]);

      if (refundSnap.exists) {
        const existing = refundSnap.data() as BondingCurveRefund;
        if (existing.claimedAt === null) {
          tx.update(refundRef, {
            amount: (BigInt(existing.amount) + ctx.args.amount).toString(),
            lastEventId: ctx.eventId,
          });
        } else {
          const doc: BondingCurveRefund = {
            id,
            bondingCurve: curveAddr,
            buyer,
            amount: ctx.args.amount.toString(),
            pendingSince: ctx.block.timestamp,
            claimedAt: null,
            lastEventId: ctx.eventId,
            _event: ctx.envelope,
          };
          tx.set(refundRef, doc);
        }
      } else {
        const doc: BondingCurveRefund = {
          id,
          bondingCurve: curveAddr,
          buyer,
          amount: ctx.args.amount.toString(),
          pendingSince: ctx.block.timestamp,
          claimedAt: null,
          lastEventId: ctx.eventId,
          _event: ctx.envelope,
        };
        tx.set(refundRef, doc);
      }

      if (curveSnap.exists) {
        const curve = curveSnap.data() as BondingCurve;
        tx.update(curveRef, {
          pendingRefundsTotal: (BigInt(curve.pendingRefundsTotal) + ctx.args.amount).toString(),
        });
      }
    });
  },
};

const refundClaimed: Handler<typeof refundClaimedEvent> = {
  kind: 'BondingCurve',
  event: 'RefundClaimed',
  abi: refundClaimedEvent,
  async run(ctx) {
    const curveAddr = ctx.address;
    const buyer = getAddress(ctx.args.buyer).toLowerCase() as Hex;
    const id = `${curveAddr}:${buyer}`;

    const curveRef = db.collection(COLLECTIONS.bondingCurves).doc(curveAddr);
    const refundRef = db.collection(COLLECTIONS.bondingCurveRefunds).doc(id);

    await db.runTransaction(async (tx) => {
      const [curveSnap, refundSnap] = await Promise.all([tx.get(curveRef), tx.get(refundRef)]);
      if (refundSnap.exists) {
        tx.update(refundRef, {
          amount: '0',
          claimedAt: ctx.block.timestamp,
          lastEventId: ctx.eventId,
        });
      }
      if (curveSnap.exists) {
        const curve = curveSnap.data() as BondingCurve;
        const prev = BigInt(curve.pendingRefundsTotal);
        const next = prev > ctx.args.amount ? prev - ctx.args.amount : 0n;
        tx.update(curveRef, { pendingRefundsTotal: next.toString() });
      }
    });
  },
};

const tradingHaltedByManager: Handler<typeof tradingHaltedByManagerEvent> = {
  kind: 'BondingCurve',
  event: 'TradingHaltedByManager',
  abi: tradingHaltedByManagerEvent,
  async run(ctx) {
    const curveAddr = ctx.address;
    const haltDoc: BondingCurveHaltEvent = {
      id: ctx.eventId,
      bondingCurve: curveAddr,
      universeId: Number(ctx.args.universeId),
      halted: ctx.args.halted,
      source: 'manager',
      timestamp: ctx.block.timestamp,
      blockNumber: ctx.block.number,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.bondingCurveHaltEvents).doc(ctx.eventId), haltDoc);

    const curveRef = db.collection(COLLECTIONS.bondingCurves).doc(curveAddr);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(curveRef);
      if (!snap.exists) return;
      const curve = snap.data() as BondingCurve;
      if (curve.tradingStatus === 'graduated') return;
      tx.update(curveRef, {
        tradingStatus: ctx.args.halted ? 'halted' : 'active',
        tradingStatusUpdatedAt: ctx.block.timestamp,
      });
    });
  },
};

const graduated: Handler<typeof graduatedEvent> = {
  kind: 'BondingCurve',
  event: 'Graduated',
  abi: graduatedEvent,
  async run(ctx) {
    const curveAddr = ctx.address;
    ctx.batcher.update(db.collection(COLLECTIONS.bondingCurves).doc(curveAddr), {
      graduated: true,
      graduatedAt: ctx.block.timestamp,
      tradingStatus: 'graduated',
      tradingStatusUpdatedAt: ctx.block.timestamp,
    });

    const haltDoc: BondingCurveHaltEvent = {
      id: `${ctx.eventId}:grad`,
      bondingCurve: curveAddr,
      universeId: Number(ctx.args.universeId),
      halted: true,
      source: 'graduation',
      timestamp: ctx.block.timestamp,
      blockNumber: ctx.block.number,
      _event: ctx.envelope,
    };
    ctx.batcher.set(
      db.collection(COLLECTIONS.bondingCurveHaltEvents).doc(`${ctx.eventId}:grad`),
      haltDoc
    );
  },
};

export const bondingCurveHandlers: Handler[] = [
  tokensPurchased as unknown as Handler,
  tokensSold as unknown as Handler,
  refundPending as unknown as Handler,
  refundClaimed as unknown as Handler,
  tradingHaltedByManager as unknown as Handler,
  graduated as unknown as Handler,
];
