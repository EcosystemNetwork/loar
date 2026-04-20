/**
 * UniverseGovernor handlers.
 * Events: ProposalCreated, ProposalExecuted, ProposalCanceled, VoteCast.
 *
 * Governor instances are factory-spawned alongside each universe token. The
 * `universeAddress` backref is resolved lazily at read time (tRPC layer)
 * from the factoryChildren registry.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import {
  COLLECTIONS,
  type Hex,
  type Proposal,
  type ProposalExecution,
  type ProposalCancellation,
  type Vote,
} from '../schema.js';
import type { Handler } from './types.js';

const proposalCreatedEvent = parseAbiItem(
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)'
);
const proposalExecutedEvent = parseAbiItem('event ProposalExecuted(uint256 proposalId)');
const proposalCanceledEvent = parseAbiItem('event ProposalCanceled(uint256 proposalId)');
const voteCastEvent = parseAbiItem(
  'event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)'
);

const proposalCreated: Handler<typeof proposalCreatedEvent> = {
  kind: 'UniverseGovernor',
  event: 'ProposalCreated',
  abi: proposalCreatedEvent,
  async run(ctx) {
    const governorAddress = ctx.address;
    const proposalId = ctx.args.proposalId.toString();
    const doc: Proposal = {
      id: proposalId,
      governorAddress,
      universeAddress: null,
      proposer: getAddress(ctx.args.proposer).toLowerCase() as Hex,
      targets: JSON.stringify(ctx.args.targets),
      values: JSON.stringify(ctx.args.values.map((v: bigint) => v.toString())),
      calldatas: JSON.stringify(ctx.args.calldatas),
      description: ctx.args.description,
      startBlock: Number(ctx.args.voteStart),
      endBlock: Number(ctx.args.voteEnd),
      createdAt: ctx.block.timestamp,
      executed: false,
      cancelled: false,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.proposals).doc(proposalId), doc);
  },
};

const proposalExecuted: Handler<typeof proposalExecutedEvent> = {
  kind: 'UniverseGovernor',
  event: 'ProposalExecuted',
  abi: proposalExecutedEvent,
  async run(ctx) {
    const proposalId = ctx.args.proposalId.toString();
    ctx.batcher.update(db.collection(COLLECTIONS.proposals).doc(proposalId), { executed: true });
    const doc: ProposalExecution = {
      id: ctx.eventId,
      proposalId,
      governorAddress: ctx.address,
      timestamp: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.proposalExecutions).doc(ctx.eventId), doc);
  },
};

const proposalCanceled: Handler<typeof proposalCanceledEvent> = {
  kind: 'UniverseGovernor',
  event: 'ProposalCanceled',
  abi: proposalCanceledEvent,
  async run(ctx) {
    const proposalId = ctx.args.proposalId.toString();
    ctx.batcher.update(db.collection(COLLECTIONS.proposals).doc(proposalId), { cancelled: true });
    const doc: ProposalCancellation = {
      id: ctx.eventId,
      proposalId,
      governorAddress: ctx.address,
      timestamp: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.proposalCancellations).doc(ctx.eventId), doc);
  },
};

const voteCast: Handler<typeof voteCastEvent> = {
  kind: 'UniverseGovernor',
  event: 'VoteCast',
  abi: voteCastEvent,
  async run(ctx) {
    const proposalId = ctx.args.proposalId.toString();
    const voter = getAddress(ctx.args.voter).toLowerCase() as Hex;
    const id = `${proposalId}:${voter}`;
    const doc: Vote = {
      id,
      proposalId,
      governorAddress: ctx.address,
      voter,
      support: Number(ctx.args.support),
      weight: ctx.args.weight.toString(),
      reason: ctx.args.reason || null,
      timestamp: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.votes).doc(id), doc);
  },
};

export const governorHandlers: Handler[] = [
  proposalCreated as unknown as Handler,
  proposalExecuted as unknown as Handler,
  proposalCanceled as unknown as Handler,
  voteCast as unknown as Handler,
];
