/**
 * Uniswap v4 PoolManager handlers (chain-global, not factory-spawned).
 * Events: Initialize, Swap.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { COLLECTIONS, type Hex, type Pool, type Swap } from '../schema.js';
import type { Handler } from './types.js';

const initializeEvent = parseAbiItem(
  'event Initialize(bytes32 indexed id, address indexed currency0, address indexed currency1, uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick)'
);
const swapEvent = parseAbiItem(
  'event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)'
);

const initialize: Handler<typeof initializeEvent> = {
  kind: 'PoolManager',
  event: 'Initialize',
  abi: initializeEvent,
  async run(ctx) {
    const doc: Pool = {
      poolId: ctx.args.id as Hex,
      currency0: getAddress(ctx.args.currency0).toLowerCase() as Hex,
      currency1: getAddress(ctx.args.currency1).toLowerCase() as Hex,
      fee: Number(ctx.args.fee),
      tickSpacing: Number(ctx.args.tickSpacing),
      hooks: getAddress(ctx.args.hooks).toLowerCase() as Hex,
      sqrtPriceX96: ctx.args.sqrtPriceX96.toString(),
      tick: Number(ctx.args.tick),
      creationBlock: ctx.block.number,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.pools).doc(ctx.args.id as string), doc);
  },
};

const swap: Handler<typeof swapEvent> = {
  kind: 'PoolManager',
  event: 'Swap',
  abi: swapEvent,
  async run(ctx) {
    const doc: Swap = {
      id: ctx.eventId,
      poolId: ctx.args.id as Hex,
      sender: getAddress(ctx.args.sender).toLowerCase() as Hex,
      amount0: ctx.args.amount0.toString(),
      amount1: ctx.args.amount1.toString(),
      sqrtPriceX96: ctx.args.sqrtPriceX96.toString(),
      liquidity: ctx.args.liquidity.toString(),
      tick: Number(ctx.args.tick),
      timestamp: ctx.block.timestamp,
      blockNumber: ctx.block.number,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.swaps).doc(ctx.eventId), doc);
  },
};

export const poolManagerHandlers: Handler[] = [
  initialize as unknown as Handler,
  swap as unknown as Handler,
];
