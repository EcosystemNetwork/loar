/**
 * StoryBounties handlers.
 * Events: BountyCreated, BountyClaimed, BountyCancelled, BountyExpired.
 *
 * The off-chain auto-canonization (writing into `canonSubmissions` with status
 * ACCEPTED) happens in the server's `bounties.award` mutation. This handler
 * records the corresponding on-chain settlement — escrow released, platform
 * fee taken — into the indexer so analytics/revenue dashboards see it.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { COLLECTIONS } from '../schema.js';
import type { Handler } from './types.js';

const bountyCreatedEvent = parseAbiItem(
  'event BountyCreated(uint256 indexed bountyId, address indexed poster, uint256 universeId, uint256 reward, string contentType)'
);
const bountyClaimedEvent = parseAbiItem(
  'event BountyClaimed(uint256 indexed bountyId, address indexed winner, uint256 reward, uint256 platformFee)'
);
const bountyCancelledEvent = parseAbiItem(
  'event BountyCancelled(uint256 indexed bountyId, uint256 refund, uint256 fee)'
);
const bountyExpiredEvent = parseAbiItem('event BountyExpired(uint256 indexed bountyId)');

const bountyCreated: Handler<typeof bountyCreatedEvent> = {
  kind: 'StoryBounties',
  event: 'BountyCreated',
  abi: bountyCreatedEvent,
  async run(ctx) {
    const id = ctx.args.bountyId.toString();
    ctx.batcher.set(db.collection(COLLECTIONS.bounties).doc(id), {
      id,
      poster: getAddress(ctx.args.poster).toLowerCase(),
      universeId: Number(ctx.args.universeId),
      reward: ctx.args.reward.toString(),
      contentType: ctx.args.contentType,
      status: 'OPEN',
      createdAt: ctx.block.timestamp,
      _event: ctx.envelope,
    });
  },
};

const bountyClaimed: Handler<typeof bountyClaimedEvent> = {
  kind: 'StoryBounties',
  event: 'BountyClaimed',
  abi: bountyClaimedEvent,
  async run(ctx) {
    const id = ctx.args.bountyId.toString();
    ctx.batcher.set(db.collection(COLLECTIONS.bounties).doc(id), {
      status: 'CLAIMED',
      winner: getAddress(ctx.args.winner).toLowerCase(),
      rewardPaid: ctx.args.reward.toString(),
      platformFee: ctx.args.platformFee.toString(),
      claimedAt: ctx.block.timestamp,
      _event: ctx.envelope,
    });
  },
};

const bountyCancelled: Handler<typeof bountyCancelledEvent> = {
  kind: 'StoryBounties',
  event: 'BountyCancelled',
  abi: bountyCancelledEvent,
  async run(ctx) {
    const id = ctx.args.bountyId.toString();
    ctx.batcher.set(db.collection(COLLECTIONS.bounties).doc(id), {
      status: 'CANCELLED',
      refund: ctx.args.refund.toString(),
      cancelFee: ctx.args.fee.toString(),
      cancelledAt: ctx.block.timestamp,
      _event: ctx.envelope,
    });
  },
};

const bountyExpired: Handler<typeof bountyExpiredEvent> = {
  kind: 'StoryBounties',
  event: 'BountyExpired',
  abi: bountyExpiredEvent,
  async run(ctx) {
    const id = ctx.args.bountyId.toString();
    ctx.batcher.set(db.collection(COLLECTIONS.bounties).doc(id), {
      status: 'EXPIRED',
      expiredAt: ctx.block.timestamp,
      _event: ctx.envelope,
    });
  },
};

export const storyBountiesHandlers: Handler[] = [
  bountyCreated as unknown as Handler,
  bountyClaimed as unknown as Handler,
  bountyCancelled as unknown as Handler,
  bountyExpired as unknown as Handler,
];
