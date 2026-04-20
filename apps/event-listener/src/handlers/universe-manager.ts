/**
 * UniverseManager handlers — port of apps/indexer/src/index.ts top section.
 * Events: UniverseCreated, TokenCreated, SetHook, BondingCurveCreated,
 * TokenGraduated.
 *
 * UniverseCreated spawns a new Universe child contract; TokenCreated spawns
 * a new GovernanceToken + UniverseGovernor; BondingCurveCreated spawns a new
 * BondingCurve. Each of those handlers records the child address in the
 * factory registry so downstream handlers pick up events from it on the next
 * backfill chunk.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { logger } from '../logger.js';
import {
  COLLECTIONS,
  type Hex,
  type Universe,
  type Token,
  type BondingCurve,
  type HookEvent,
} from '../schema.js';
import { recordFactoryChild } from '../factory.js';
import type { Handler, HandlerCtx } from './types.js';

// ── ABI items mirroring apps/indexer/ponder.config.ts ────────────────────

const universeCreatedEvent = parseAbiItem(
  'event UniverseCreated(address universe, address creator)'
);
const tokenCreatedEvent = parseAbiItem(
  'event TokenCreated(address msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address governor)'
);
const bondingCurveCreatedEvent = parseAbiItem(
  'event BondingCurveCreated(uint256 indexed universeId, address indexed token, address indexed bondingCurve, uint256 graduationEth, uint256 curveSupply)'
);
const setHookEvent = parseAbiItem('event SetHook(address hook, bool enabled)');
const tokenGraduatedEvent = parseAbiItem('event TokenGraduated(address indexed token)');

// ── Handlers ─────────────────────────────────────────────────────────────

// Minimal ABI for readContract calls we need to fetch universe metadata.
const universeMetaAbi = [
  parseAbiItem('function universeName() view returns (string)'),
  parseAbiItem('function universeDescription() view returns (string)'),
  parseAbiItem('function universeImageUrl() view returns (string)'),
] as const;

const universeCreated: Handler<typeof universeCreatedEvent> = {
  kind: 'UniverseManager',
  event: 'UniverseCreated',
  abi: universeCreatedEvent,
  async run(ctx) {
    const universeAddress = getAddress(ctx.args.universe).toLowerCase() as Hex;

    let universeName = 'Untitled Universe';
    let universeDescription = 'A narrative universe';
    let imageURL = '';

    try {
      universeName = (await ctx.client.readContract({
        abi: universeMetaAbi,
        address: universeAddress,
        functionName: 'universeName',
      })) as string;
      universeDescription = (await ctx.client.readContract({
        abi: universeMetaAbi,
        address: universeAddress,
        functionName: 'universeDescription',
      })) as string;
      imageURL = (await ctx.client.readContract({
        abi: universeMetaAbi,
        address: universeAddress,
        functionName: 'universeImageUrl',
      })) as string;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, universeAddress },
        'Failed to read universe metadata, falling back to defaults'
      );
    }

    const doc: Universe = {
      id: universeAddress,
      universeId: null,
      creator: getAddress(ctx.args.creator).toLowerCase() as Hex,
      createdAt: ctx.block.timestamp,
      name: universeName,
      description: universeDescription,
      imageURL,
      tokenAddress: null,
      governorAddress: null,
      nodeCount: 0,
      _event: ctx.envelope,
    };

    ctx.batcher.set(db.collection(COLLECTIONS.universes).doc(universeAddress), doc);

    await recordFactoryChild(
      'universe',
      universeAddress,
      ctx.address,
      universeAddress,
      ctx.block.number,
      ctx.block.timestamp
    );
  },
};

// Minimal ABI for the totalSupply + getUniverseData reads used to resolve
// which universe a newly-created token belongs to.
const universeManagerViewAbi = [
  parseAbiItem('function totalSupply() view returns (uint256)'),
  parseAbiItem(
    'function getUniverseData(uint256 id) view returns (address universe, address token, address governor, address bondingCurve, address locker, address poolHook)'
  ),
] as const;

const tokenCreated: Handler<typeof tokenCreatedEvent> = {
  kind: 'UniverseManager',
  event: 'TokenCreated',
  abi: tokenCreatedEvent,
  async run(ctx) {
    const tokenAddress = getAddress(ctx.args.tokenAddress).toLowerCase() as Hex;
    const deployer = getAddress(ctx.args.msgSender).toLowerCase() as Hex;
    const governorAddress = getAddress(ctx.args.governor).toLowerCase() as Hex;

    // Strategy 1: scan the last 10 universes via getUniverseData and match by
    // token address. Mirrors the on-chain lookup in the Ponder handler.
    let resolvedUniverseAddress: Hex = '0x0000000000000000000000000000000000000000';
    try {
      const totalSupply = (await ctx.client.readContract({
        abi: universeManagerViewAbi,
        address: ctx.address,
        functionName: 'totalSupply',
      })) as bigint;
      const count = Number(totalSupply);
      for (let i = count - 1; i >= Math.max(0, count - 10); i--) {
        try {
          const data = (await ctx.client.readContract({
            abi: universeManagerViewAbi,
            address: ctx.address,
            functionName: 'getUniverseData',
            args: [BigInt(i)],
          })) as readonly [Hex, Hex, Hex, Hex, Hex, Hex];
          const [universeAddr, tokenAddr] = data;
          if (getAddress(tokenAddr).toLowerCase() === tokenAddress) {
            resolvedUniverseAddress = getAddress(universeAddr).toLowerCase() as Hex;
            break;
          }
        } catch {
          /* universe id doesn't exist or call failed — skip */
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'on-chain universe resolution failed');
    }

    // Strategy 2: Firestore fallback — find a universe by deployer with no
    // tokenAddress yet, most recent first.
    if (resolvedUniverseAddress === '0x0000000000000000000000000000000000000000') {
      try {
        const snap = await db
          .collection(COLLECTIONS.universes)
          .where('creator', '==', deployer)
          .where('tokenAddress', '==', null)
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();
        if (!snap.empty) {
          resolvedUniverseAddress = snap.docs[0]!.id as Hex;
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message }, 'Firestore universe fallback failed');
      }
    }

    if (resolvedUniverseAddress !== '0x0000000000000000000000000000000000000000') {
      ctx.batcher.update(db.collection(COLLECTIONS.universes).doc(resolvedUniverseAddress), {
        tokenAddress,
        governorAddress,
      });
    }

    const tokenDoc: Token = {
      id: tokenAddress,
      universeAddress: resolvedUniverseAddress,
      deployer,
      tokenAdmin: getAddress(ctx.args.tokenAdmin).toLowerCase() as Hex,
      name: ctx.args.tokenName,
      symbol: ctx.args.tokenSymbol,
      imageURL: ctx.args.tokenImage,
      metadata: ctx.args.tokenMetadata,
      context: ctx.args.tokenContext,
      startingTick: ctx.args.startingTick.toString(),
      poolHook: getAddress(ctx.args.poolHook).toLowerCase() as Hex,
      poolId: ctx.args.poolId,
      pairedToken: getAddress(ctx.args.pairedToken).toLowerCase() as Hex,
      locker: getAddress(ctx.args.locker).toLowerCase() as Hex,
      createdAt: ctx.block.timestamp,
      _event: ctx.envelope,
    };

    ctx.batcher.set(db.collection(COLLECTIONS.tokens).doc(tokenAddress), tokenDoc);

    // Register the spawned governor + token so handlers for those contract
    // kinds pick up events on subsequent log-fetch rounds.
    await recordFactoryChild(
      'governor',
      governorAddress,
      ctx.address,
      resolvedUniverseAddress === '0x0000000000000000000000000000000000000000'
        ? undefined
        : resolvedUniverseAddress,
      ctx.block.number,
      ctx.block.timestamp
    );
    await recordFactoryChild(
      'token',
      tokenAddress,
      ctx.address,
      resolvedUniverseAddress === '0x0000000000000000000000000000000000000000'
        ? undefined
        : resolvedUniverseAddress,
      ctx.block.number,
      ctx.block.timestamp
    );
  },
};

const setHook: Handler<typeof setHookEvent> = {
  kind: 'UniverseManager',
  event: 'SetHook',
  abi: setHookEvent,
  async run(ctx) {
    const doc: HookEvent = {
      id: ctx.eventId,
      timestamp: ctx.block.timestamp,
      hook_address: getAddress(ctx.args.hook).toLowerCase() as Hex,
      enabled: ctx.args.enabled,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.hookEvents).doc(ctx.eventId), doc);
  },
};

const bondingCurveCreated: Handler<typeof bondingCurveCreatedEvent> = {
  kind: 'UniverseManager',
  event: 'BondingCurveCreated',
  abi: bondingCurveCreatedEvent,
  async run(ctx) {
    const curveAddress = getAddress(ctx.args.bondingCurve).toLowerCase() as Hex;

    const doc: BondingCurve = {
      id: curveAddress,
      tokenAddress: getAddress(ctx.args.token).toLowerCase() as Hex,
      universeId: Number(ctx.args.universeId),
      graduationEth: ctx.args.graduationEth.toString(),
      curveSupply: ctx.args.curveSupply.toString(),
      graduated: false,
      graduatedAt: null,
      createdAt: ctx.block.timestamp,
      tradingStatus: 'active',
      tradingStatusUpdatedAt: null,
      tokensSold: '0',
      ethRaised: '0',
      lastPrice: '0',
      tradeCount: 0,
      pendingRefundsTotal: '0',
      _event: ctx.envelope,
    };

    ctx.batcher.set(db.collection(COLLECTIONS.bondingCurves).doc(curveAddress), doc);

    await recordFactoryChild(
      'bondingCurve',
      curveAddress,
      ctx.address,
      undefined,
      ctx.block.number,
      ctx.block.timestamp
    );
  },
};

const tokenGraduated: Handler<typeof tokenGraduatedEvent> = {
  kind: 'UniverseManager',
  event: 'TokenGraduated',
  abi: tokenGraduatedEvent,
  async run(ctx) {
    const tokenAddress = getAddress(ctx.args.token).toLowerCase() as Hex;
    // Find the curve by tokenAddress. Must actually query now, not defer,
    // because the batcher's buffered writes aren't visible to reads.
    const snap = await db
      .collection(COLLECTIONS.bondingCurves)
      .where('tokenAddress', '==', tokenAddress)
      .limit(1)
      .get();
    if (snap.empty) {
      logger.warn({ tokenAddress }, 'TokenGraduated for unknown curve');
      return;
    }
    const curveRef = snap.docs[0]!.ref;
    ctx.batcher.update(curveRef, {
      graduated: true,
      graduatedAt: ctx.block.timestamp,
    });
  },
};

export const universeManagerHandlers: Handler[] = [
  universeCreated as unknown as Handler,
  tokenCreated as unknown as Handler,
  setHook as unknown as Handler,
  bondingCurveCreated as unknown as Handler,
  tokenGraduated as unknown as Handler,
];
