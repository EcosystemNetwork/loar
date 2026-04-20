/**
 * Universe (dynamic) handlers — events emitted from per-universe contract
 * instances spawned by the UniverseManager factory.
 * Events: NodeCreated, NodeCanonized, MediaUpdated, TokenUpdated, AdminUpdated.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { logger } from '../logger.js';
import {
  COLLECTIONS,
  type Hex,
  type IndexerNode,
  type NodeCanonization,
  type NodeContent,
} from '../schema.js';
import type { Handler } from './types.js';

const nodeCreatedEvent = parseAbiItem(
  'event NodeCreated(uint256 indexed id, uint256 indexed previous, address indexed creator, bytes32 contentHash, bytes32 plotHash, string link, string plot)'
);
const nodeCanonizedEvent = parseAbiItem(
  'event NodeCanonized(uint256 indexed id, address indexed canonizer)'
);
const mediaUpdatedEvent = parseAbiItem(
  'event MediaUpdated(uint256 indexed nodeId, bytes32 contentHash, string link)'
);
const tokenUpdatedEvent = parseAbiItem('event TokenUpdated(address indexed token)');
const adminUpdatedEvent = parseAbiItem('event AdminUpdated(address indexed newAdmin)');

const nodeCreated: Handler<typeof nodeCreatedEvent> = {
  kind: 'Universe',
  event: 'NodeCreated',
  abi: nodeCreatedEvent,
  async run(ctx) {
    const universeAddress = ctx.address;
    const nodeId = Number(ctx.args.id);
    const compositeId = `${universeAddress}:${nodeId}`;

    const nodeDoc: IndexerNode = {
      id: compositeId,
      universeAddress,
      nodeId,
      previousNodeId: Number(ctx.args.previous),
      creator: getAddress(ctx.args.creator).toLowerCase() as Hex,
      createdAt: ctx.block.timestamp,
      contentHash: (ctx.args.contentHash as Hex) ?? null,
      plotHash: (ctx.args.plotHash as Hex) ?? null,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.nodes).doc(compositeId), nodeDoc);

    const contentDoc: NodeContent = {
      id: compositeId,
      contentHash: (ctx.args.contentHash as Hex) ?? null,
      plotHash: (ctx.args.plotHash as Hex) ?? null,
      videoLink: ctx.args.link,
      plot: ctx.args.plot,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.nodeContents).doc(compositeId), contentDoc);

    // Increment universe.nodeCount. Must transact — read-modify-write.
    const universeRef = db.collection(COLLECTIONS.universes).doc(universeAddress);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(universeRef);
      if (!snap.exists) return;
      const current = snap.data() as { nodeCount: number };
      tx.update(universeRef, { nodeCount: current.nodeCount + 1 });
    });
  },
};

const nodeCanonized: Handler<typeof nodeCanonizedEvent> = {
  kind: 'Universe',
  event: 'NodeCanonized',
  abi: nodeCanonizedEvent,
  async run(ctx) {
    const universeAddress = ctx.address;
    const nodeId = Number(ctx.args.id);
    const id = `${universeAddress}:${nodeId}:${ctx.eventId}`;
    const doc: NodeCanonization = {
      id,
      universeAddress,
      nodeId,
      canonizer: getAddress(ctx.args.canonizer).toLowerCase() as Hex,
      timestamp: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.nodeCanonizations).doc(id), doc);
  },
};

const mediaUpdated: Handler<typeof mediaUpdatedEvent> = {
  kind: 'Universe',
  event: 'MediaUpdated',
  abi: mediaUpdatedEvent,
  async run(ctx) {
    const universeAddress = ctx.address;
    const nodeId = Number(ctx.args.nodeId);
    const compositeId = `${universeAddress}:${nodeId}`;

    ctx.batcher.update(db.collection(COLLECTIONS.nodeContents).doc(compositeId), {
      contentHash: ctx.args.contentHash,
      videoLink: ctx.args.link,
    });
    ctx.batcher.update(db.collection(COLLECTIONS.nodes).doc(compositeId), {
      contentHash: ctx.args.contentHash,
    });
  },
};

const tokenUpdated: Handler<typeof tokenUpdatedEvent> = {
  kind: 'Universe',
  event: 'TokenUpdated',
  abi: tokenUpdatedEvent,
  async run(ctx) {
    const universeAddress = ctx.address;
    ctx.batcher.update(db.collection(COLLECTIONS.universes).doc(universeAddress), {
      tokenAddress: getAddress(ctx.args.token).toLowerCase() as Hex,
    });
  },
};

const adminUpdated: Handler<typeof adminUpdatedEvent> = {
  kind: 'Universe',
  event: 'AdminUpdated',
  abi: adminUpdatedEvent,
  async run(ctx) {
    // Informational — Universe schema has no admin field in Ponder, same here.
    logger.debug(
      { universeAddress: ctx.address, newAdmin: ctx.args.newAdmin },
      'Universe admin updated'
    );
  },
};

export const universeHandlers: Handler[] = [
  nodeCreated as unknown as Handler,
  nodeCanonized as unknown as Handler,
  mediaUpdated as unknown as Handler,
  tokenUpdated as unknown as Handler,
  adminUpdated as unknown as Handler,
];
