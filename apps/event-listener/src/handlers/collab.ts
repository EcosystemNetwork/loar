/**
 * CollabManager handlers.
 * Events: CollabProposed, CollabAccepted, CollabCompleted, CollabCancelled.
 * revenueShareBps isn't in CollabProposed payload — read from `collabs()`.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { COLLECTIONS, type Hex, type Collab } from '../schema.js';
import type { Handler } from './types.js';

const collabProposedEvent = parseAbiItem(
  'event CollabProposed(uint256 indexed collabId, uint256 indexed universeA, uint256 indexed universeB, address proposer)'
);
const collabAcceptedEvent = parseAbiItem(
  'event CollabAccepted(uint256 indexed collabId, address indexed acceptor)'
);
const collabCompletedEvent = parseAbiItem(
  'event CollabCompleted(uint256 indexed collabId, uint256 totalRevenue)'
);
const collabCancelledEvent = parseAbiItem('event CollabCancelled(uint256 indexed collabId)');

const collabsAbi = [
  parseAbiItem(
    'function collabs(uint256 id) view returns (uint256, uint256, uint256, address, address, uint8, uint16, uint256, uint256, uint256, string, uint256)'
  ),
] as const;

const collabProposed: Handler<typeof collabProposedEvent> = {
  kind: 'CollabManager',
  event: 'CollabProposed',
  abi: collabProposedEvent,
  async run(ctx) {
    const id = ctx.args.collabId.toString();
    const c = (await ctx.client.readContract({
      abi: collabsAbi,
      address: ctx.address,
      functionName: 'collabs',
      args: [ctx.args.collabId],
    })) as readonly [
      bigint,
      bigint,
      bigint,
      Hex,
      Hex,
      number, // status (uint8)
      number, // revenueShareBps (uint16)
      bigint,
      bigint,
      bigint,
      string,
      bigint,
    ];

    const doc: Collab = {
      id,
      universeA: Number(ctx.args.universeA),
      universeB: Number(ctx.args.universeB),
      proposer: getAddress(ctx.args.proposer).toLowerCase() as Hex,
      acceptor: null,
      status: 0, // PROPOSED
      revenueShareBps: Number(c[6]),
      totalRevenue: '0',
      episodeCount: 0,
      startTime: null,
      endTime: null,
      createdAt: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.collabs).doc(id), doc);
  },
};

const collabAccepted: Handler<typeof collabAcceptedEvent> = {
  kind: 'CollabManager',
  event: 'CollabAccepted',
  abi: collabAcceptedEvent,
  async run(ctx) {
    ctx.batcher.update(db.collection(COLLECTIONS.collabs).doc(ctx.args.collabId.toString()), {
      status: 1,
      acceptor: getAddress(ctx.args.acceptor).toLowerCase() as Hex,
    });
  },
};

const collabCompleted: Handler<typeof collabCompletedEvent> = {
  kind: 'CollabManager',
  event: 'CollabCompleted',
  abi: collabCompletedEvent,
  async run(ctx) {
    ctx.batcher.update(db.collection(COLLECTIONS.collabs).doc(ctx.args.collabId.toString()), {
      status: 3,
      totalRevenue: ctx.args.totalRevenue.toString(),
      endTime: ctx.block.timestamp,
    });
  },
};

const collabCancelled: Handler<typeof collabCancelledEvent> = {
  kind: 'CollabManager',
  event: 'CollabCancelled',
  abi: collabCancelledEvent,
  async run(ctx) {
    ctx.batcher.update(db.collection(COLLECTIONS.collabs).doc(ctx.args.collabId.toString()), {
      status: 4,
    });
  },
};

export const collabHandlers: Handler[] = [
  collabProposed as unknown as Handler,
  collabAccepted as unknown as Handler,
  collabCompleted as unknown as Handler,
  collabCancelled as unknown as Handler,
];
