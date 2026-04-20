/**
 * AdPlacement handlers.
 * Events: AdSlotCreated, SponsorshipActivated.
 *
 * Both events omit fields the Firestore row needs (episodesRemaining for
 * slots, totalPaid for sponsorships), so we read back via `adSlots()` and
 * `sponsorships()` struct getters — matches Ponder.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { COLLECTIONS, type Hex, type AdSlot, type Sponsorship } from '../schema.js';
import type { Handler } from './types.js';

const adSlotCreatedEvent = parseAbiItem(
  'event AdSlotCreated(uint256 indexed slotId, uint256 indexed universeId, uint8 placementType, uint256 minBid)'
);
const sponsorshipActivatedEvent = parseAbiItem(
  'event SponsorshipActivated(uint256 indexed sponsorshipId, uint256 indexed slotId, address indexed sponsor)'
);

const adSlotsAbi = [
  parseAbiItem(
    'function adSlots(uint256 id) view returns (uint256, uint256, uint8, uint256, uint256, address, string, uint256, bool)'
  ),
] as const;

const sponsorshipsAbi = [
  parseAbiItem(
    'function sponsorships(uint256 id) view returns (uint256, uint256, address, uint256, uint256, uint256, bool)'
  ),
] as const;

const adSlotCreated: Handler<typeof adSlotCreatedEvent> = {
  kind: 'AdPlacement',
  event: 'AdSlotCreated',
  abi: adSlotCreatedEvent,
  async run(ctx) {
    const id = ctx.args.slotId.toString();
    const slot = (await ctx.client.readContract({
      abi: adSlotsAbi,
      address: ctx.address,
      functionName: 'adSlots',
      args: [ctx.args.slotId],
    })) as readonly [bigint, bigint, number, bigint, bigint, Hex, string, bigint, boolean];

    const doc: AdSlot = {
      id,
      universeId: Number(ctx.args.universeId),
      placementType: Number(ctx.args.placementType),
      minBid: ctx.args.minBid.toString(),
      currentBid: '0',
      currentBidder: null,
      episodesRemaining: Number(slot[7]),
      active: true,
      createdAt: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.adSlots).doc(id), doc);
  },
};

const sponsorshipActivated: Handler<typeof sponsorshipActivatedEvent> = {
  kind: 'AdPlacement',
  event: 'SponsorshipActivated',
  abi: sponsorshipActivatedEvent,
  async run(ctx) {
    const id = ctx.args.sponsorshipId.toString();
    const spon = (await ctx.client.readContract({
      abi: sponsorshipsAbi,
      address: ctx.address,
      functionName: 'sponsorships',
      args: [ctx.args.sponsorshipId],
    })) as readonly [bigint, bigint, Hex, bigint, bigint, bigint, boolean];

    const doc: Sponsorship = {
      id,
      adSlotId: Number(ctx.args.slotId),
      sponsor: getAddress(ctx.args.sponsor).toLowerCase() as Hex,
      totalPaid: spon[3].toString(),
      impressions: 0,
      active: true,
      startedAt: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.sponsorships).doc(id), doc);
  },
};

export const adPlacementHandlers: Handler[] = [
  adSlotCreated as unknown as Handler,
  sponsorshipActivated as unknown as Handler,
];
