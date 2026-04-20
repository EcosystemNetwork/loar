/**
 * GovernanceToken handler — the ERC20 Transfer event is the sole event we
 * track on spawned governance tokens. Maintains a per-holder balance table
 * via read-modify-write transaction.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { COLLECTIONS, type Hex, type TokenTransfer, type TokenHolder } from '../schema.js';
import type { Handler } from './types.js';

const ZERO = '0x0000000000000000000000000000000000000000';

// OpenZeppelin v4 Transfer uses `amount`; v5 uses `value`. We try both via the
// ABI overload and fall back. The Ponder handler used `amount`, so we stick
// with that.
const transferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 amount)'
);

const transfer: Handler<typeof transferEvent> = {
  kind: 'GovernanceToken',
  event: 'Transfer',
  abi: transferEvent,
  async run(ctx) {
    const tokenAddress = ctx.address;
    const from = getAddress(ctx.args.from).toLowerCase() as Hex;
    const to = getAddress(ctx.args.to).toLowerCase() as Hex;
    const amount = ctx.args.amount;

    const transferDoc: TokenTransfer = {
      id: ctx.eventId,
      tokenAddress,
      from,
      to,
      value: amount.toString(),
      timestamp: ctx.block.timestamp,
      blockNumber: ctx.block.number,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.tokenTransfers).doc(ctx.eventId), transferDoc);

    // Holder balance updates. Must transact (read-modify-write) since two
    // transfers in the same block could both touch the same holder.
    if (from !== ZERO) {
      const fromRef = db.collection(COLLECTIONS.tokenHolders).doc(`${tokenAddress}:${from}`);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(fromRef);
        if (snap.exists) {
          const prev = BigInt((snap.data() as TokenHolder).balance) - amount;
          tx.update(fromRef, { balance: (prev > 0n ? prev : 0n).toString() });
        }
      });
    }

    if (to !== ZERO) {
      const toRef = db.collection(COLLECTIONS.tokenHolders).doc(`${tokenAddress}:${to}`);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(toRef);
        if (snap.exists) {
          const prev = BigInt((snap.data() as TokenHolder).balance) + amount;
          tx.update(toRef, { balance: prev.toString() });
        } else {
          const doc: TokenHolder = {
            id: `${tokenAddress}:${to}`,
            tokenAddress,
            holderAddress: to,
            balance: amount.toString(),
            _event: ctx.envelope,
          };
          tx.set(toRef, doc);
        }
      });
    }
  },
};

export const governanceTokenHandlers: Handler[] = [transfer as unknown as Handler];
