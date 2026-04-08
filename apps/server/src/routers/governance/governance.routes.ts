/**
 * Governance Router
 *
 * Caches on-chain governance proposals in Firestore for fast querying.
 * Frontend writes to chain first, then syncs data here via syncProposal.
 * Supports proposal listing, filtering, and delegation tracking.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';

const proposalsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('governanceProposals');
};

const delegationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('governanceDelegations');
};

const proposalStateEnum = z.enum([
  'Pending',
  'Active',
  'Canceled',
  'Defeated',
  'Succeeded',
  'Queued',
  'Expired',
  'Executed',
]);

const syncProposalSchema = z.object({
  proposalId: z.string(),
  universeId: z.string(),
  governorAddress: z.string(),
  tokenAddress: z.string(),
  description: z.string(),
  proposer: z.string(),
  targets: z.array(z.string()),
  values: z.array(z.string()),
  calldatas: z.array(z.string()),
  state: proposalStateEnum,
  forVotes: z.string().default('0'),
  againstVotes: z.string().default('0'),
  abstainVotes: z.string().default('0'),
  startBlock: z.number(),
  endBlock: z.number(),
  executedAt: z.string().optional(),
});

export const governanceRouter = router({
  /** Sync an on-chain proposal to Firestore cache (called after tx confirmation).
   *  Only the proposer (authenticated caller) can create/update their own proposals. */
  syncProposal: protectedProcedure.input(syncProposalSchema).mutation(async ({ ctx, input }) => {
    // Verify caller is the proposer
    if (input.proposer.toLowerCase() !== ctx.user.address?.toLowerCase()) {
      throw new Error('Only the proposer can sync this proposal');
    }

    const ref = proposalsCol().doc(input.proposalId);

    // If doc exists, verify original proposer matches
    const existing = await ref.get();
    if (existing.exists) {
      const existingProposer = existing.data()?.proposer?.toLowerCase();
      if (existingProposer && existingProposer !== ctx.user.address?.toLowerCase()) {
        throw new Error("Cannot overwrite another proposer's proposal");
      }
    }

    await ref.set(
      {
        ...input,
        updatedAt: new Date(),
      },
      { merge: true }
    );
    return { ok: true };
  }),

  /** List proposals for a universe, optionally filtered by state */
  listProposals: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        state: proposalStateEnum.optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = proposalsCol()
        .where('universeId', '==', input.universeId)
        .orderBy('startBlock', 'desc')
        .limit(input.limit);

      if (input.state) {
        query = proposalsCol()
          .where('universeId', '==', input.universeId)
          .where('state', '==', input.state)
          .orderBy('startBlock', 'desc')
          .limit(input.limit);
      }

      if (input.cursor) {
        const cursorDoc = await proposalsCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const proposals = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      return {
        proposals,
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  /** Get a single proposal by ID */
  getProposal: publicProcedure
    .input(z.object({ proposalId: z.string() }))
    .query(async ({ input }) => {
      const doc = await proposalsCol().doc(input.proposalId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    }),

  /** Record a delegation event (caller must be the delegator) */
  recordDelegation: protectedProcedure
    .input(
      z.object({
        delegatee: z.string(),
        universeId: z.string(),
        tokenAddress: z.string(),
        txHash: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await delegationsCol().add({
        delegator: ctx.user.address?.toLowerCase() || ctx.user.uid,
        ...input,
        createdAt: new Date(),
      });
      return { ok: true };
    }),

  /** Get delegations for a universe */
  getDelegations: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        limit: z.number().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      const snapshot = await delegationsCol()
        .where('universeId', '==', input.universeId)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  /** Update proposal state (e.g., after voting ends or execution).
   *  Only the original proposer can update (state synced from chain). */
  updateState: protectedProcedure
    .input(
      z.object({
        proposalId: z.string(),
        state: proposalStateEnum,
        forVotes: z.string().optional(),
        againstVotes: z.string().optional(),
        abstainVotes: z.string().optional(),
        executedAt: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { proposalId, ...updates } = input;

      // Verify the caller is the proposal's original proposer
      const proposalDoc = await proposalsCol().doc(proposalId).get();
      if (!proposalDoc.exists) {
        throw new Error('Proposal not found');
      }
      const proposer = proposalDoc.data()?.proposer?.toLowerCase();
      if (proposer !== ctx.user.address?.toLowerCase()) {
        throw new Error('Only the proposer can update proposal state');
      }

      await proposalsCol()
        .doc(proposalId)
        .update({
          ...updates,
          updatedAt: new Date(),
        });
      return { ok: true };
    }),
});
