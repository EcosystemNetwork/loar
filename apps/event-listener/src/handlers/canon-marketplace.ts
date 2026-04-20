/**
 * CanonMarketplace handlers.
 * Events: SubmissionCreated, VoteCast, SubmissionAccepted, SubmissionRejected.
 *
 * SubmissionCreated doesn't carry universeToken/metadataURI/submissionFee/
 * votingDeadline in its payload, so we read them back via the `submissions()`
 * struct getter — matches the Ponder implementation.
 */
import { parseAbiItem, getAddress } from 'viem';
import { db } from '../firestore.js';
import { COLLECTIONS, type Hex, type CanonSubmission, type CanonVote } from '../schema.js';
import type { Handler } from './types.js';

const submissionCreatedEvent = parseAbiItem(
  'event SubmissionCreated(uint256 indexed id, uint256 indexed universeId, uint8 subType, address indexed creator, bytes32 contentHash)'
);
const voteCastEvent = parseAbiItem(
  'event VoteCast(uint256 indexed submissionId, address indexed voter, bool support, uint256 weight)'
);
const submissionAcceptedEvent = parseAbiItem(
  'event SubmissionAccepted(uint256 indexed submissionId)'
);
const submissionRejectedEvent = parseAbiItem(
  'event SubmissionRejected(uint256 indexed submissionId)'
);

const submissionsAbi = [
  parseAbiItem(
    'function submissions(uint256 id) view returns (uint256, uint256, address, uint8, uint8, address, bytes32, string, uint256, uint256, uint256, uint256, uint256, uint256)'
  ),
] as const;

const submissionCreated: Handler<typeof submissionCreatedEvent> = {
  kind: 'CanonMarketplace',
  event: 'SubmissionCreated',
  abi: submissionCreatedEvent,
  async run(ctx) {
    const id = ctx.args.id.toString();
    const sub = (await ctx.client.readContract({
      abi: submissionsAbi,
      address: ctx.address,
      functionName: 'submissions',
      args: [ctx.args.id],
    })) as readonly [
      bigint,
      bigint,
      Hex,
      number,
      number,
      Hex,
      Hex,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];

    const doc: CanonSubmission = {
      id,
      universeId: Number(ctx.args.universeId),
      universeToken: getAddress(sub[2]).toLowerCase() as Hex,
      submissionType: Number(ctx.args.subType),
      status: 1, // VOTING
      creator: getAddress(ctx.args.creator).toLowerCase() as Hex,
      contentHash: ctx.args.contentHash as Hex,
      metadataURI: sub[7],
      submissionFee: sub[8].toString(),
      votesFor: '0',
      votesAgainst: '0',
      votingDeadline: Number(sub[11]),
      createdAt: ctx.block.timestamp,
      finalizedAt: null,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.canonSubmissions).doc(id), doc);
  },
};

const voteCast: Handler<typeof voteCastEvent> = {
  kind: 'CanonMarketplace',
  event: 'VoteCast',
  abi: voteCastEvent,
  async run(ctx) {
    const submissionIdStr = ctx.args.submissionId.toString();
    const voter = getAddress(ctx.args.voter).toLowerCase() as Hex;

    const vote: CanonVote = {
      id: `${submissionIdStr}:${voter}`,
      submissionId: Number(ctx.args.submissionId),
      voter,
      support: ctx.args.support,
      weight: ctx.args.weight.toString(),
      timestamp: ctx.block.timestamp,
      _event: ctx.envelope,
    };
    ctx.batcher.set(db.collection(COLLECTIONS.canonVotes).doc(vote.id), vote);

    // Tally update must transact — concurrent votes on the same submission.
    const subRef = db.collection(COLLECTIONS.canonSubmissions).doc(submissionIdStr);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(subRef);
      if (!snap.exists) return;
      const existing = snap.data() as CanonSubmission;
      if (ctx.args.support) {
        tx.update(subRef, {
          votesFor: (BigInt(existing.votesFor) + ctx.args.weight).toString(),
        });
      } else {
        tx.update(subRef, {
          votesAgainst: (BigInt(existing.votesAgainst) + ctx.args.weight).toString(),
        });
      }
    });
  },
};

const submissionAccepted: Handler<typeof submissionAcceptedEvent> = {
  kind: 'CanonMarketplace',
  event: 'SubmissionAccepted',
  abi: submissionAcceptedEvent,
  async run(ctx) {
    ctx.batcher.update(
      db.collection(COLLECTIONS.canonSubmissions).doc(ctx.args.submissionId.toString()),
      { status: 2, finalizedAt: ctx.block.timestamp }
    );
  },
};

const submissionRejected: Handler<typeof submissionRejectedEvent> = {
  kind: 'CanonMarketplace',
  event: 'SubmissionRejected',
  abi: submissionRejectedEvent,
  async run(ctx) {
    ctx.batcher.update(
      db.collection(COLLECTIONS.canonSubmissions).doc(ctx.args.submissionId.toString()),
      { status: 3, finalizedAt: ctx.block.timestamp }
    );
  },
};

export const canonMarketplaceHandlers: Handler[] = [
  submissionCreated as unknown as Handler,
  voteCast as unknown as Handler,
  submissionAccepted as unknown as Handler,
  submissionRejected as unknown as Handler,
];
