/**
 * Canon Marketplace Router — Submit content for universe canon,
 * vote on submissions, license accepted canon
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';

const submissionsCol = db.collection('canonSubmissions');
const canonVotesCol = db.collection('canonVotes');
const canonLicensesCol = db.collection('canonLicenses');

const submissionTypeEnum = z.enum(['CHARACTER', 'PLOT_ARC', 'LOCATION', 'LORE_RULE']);

export const marketplaceRouter = router({
  // ---- Submissions ----

  submit: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        universeToken: z.string(),
        submissionType: submissionTypeEnum,
        title: z.string().min(1).max(200),
        description: z.string().min(10).max(5000),
        contentHash: z.string(),
        metadataURI: z.string(),
        mediaUrl: z.string().optional(),
        submissionFeeTxHash: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const submission = {
        ...input,
        creatorUid: ctx.user.uid,
        creatorAddress: ctx.user.address || null,
        status: 'VOTING' as const,
        votesFor: 0,
        votesAgainst: 0,
        voterCount: 0,
        votingDeadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ref = await submissionsCol.add(submission);
      return { id: ref.id, ...submission };
    }),

  vote: protectedProcedure
    .input(
      z.object({
        submissionId: z.string(),
        support: z.boolean(),
        weight: z.string(), // token balance as string
        txHash: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if already voted
      const existingVote = await canonVotesCol
        .where('submissionId', '==', input.submissionId)
        .where('voterUid', '==', ctx.user.uid)
        .get();

      if (!existingVote.empty) throw new Error('Already voted on this submission');

      // Record vote
      const voteData = {
        submissionId: input.submissionId,
        voterUid: ctx.user.uid,
        voterAddress: ctx.user.address || null,
        support: input.support,
        weight: input.weight,
        txHash: input.txHash || null,
        votedAt: new Date(),
      };

      await canonVotesCol.add(voteData);

      // Update submission tallies
      const subRef = submissionsCol.doc(input.submissionId);
      const subDoc = await subRef.get();
      if (!subDoc.exists) throw new Error('Submission not found');

      const sub = subDoc.data()!;
      const weightNum = parseFloat(input.weight);
      await subRef.update({
        votesFor: input.support ? (sub.votesFor || 0) + weightNum : sub.votesFor || 0,
        votesAgainst: !input.support ? (sub.votesAgainst || 0) + weightNum : sub.votesAgainst || 0,
        voterCount: (sub.voterCount || 0) + 1,
        updatedAt: new Date(),
      });

      return { ok: true, vote: voteData };
    }),

  finalize: protectedProcedure
    .input(z.object({ submissionId: z.string() }))
    .mutation(async ({ input }) => {
      const ref = submissionsCol.doc(input.submissionId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Submission not found');

      const sub = doc.data()!;
      if (sub.status !== 'VOTING') throw new Error('Not in voting status');
      if (new Date() < sub.votingDeadline?.toDate?.()) throw new Error('Voting not ended');

      const accepted = (sub.votesFor || 0) > (sub.votesAgainst || 0);
      await ref.update({
        status: accepted ? 'ACCEPTED' : 'REJECTED',
        finalizedAt: new Date(),
        updatedAt: new Date(),
      });

      return { ok: true, accepted };
    }),

  // ---- Browsing ----

  getByUniverse: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        status: z.enum(['VOTING', 'ACCEPTED', 'REJECTED', 'ALL']).default('ALL'),
        type: submissionTypeEnum.optional(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      let query: FirebaseFirestore.Query = submissionsCol.where(
        'universeId',
        '==',
        input.universeId
      );

      if (input.status !== 'ALL') {
        query = query.where('status', '==', input.status);
      }
      if (input.type) {
        query = query.where('submissionType', '==', input.type);
      }

      const snapshot = await query.orderBy('createdAt', 'desc').limit(input.limit).get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  getSubmission: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const doc = await submissionsCol.doc(input.id).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    }),

  getVotes: publicProcedure
    .input(z.object({ submissionId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await canonVotesCol
        .where('submissionId', '==', input.submissionId)
        .orderBy('votedAt', 'desc')
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  getCanon: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await submissionsCol
        .where('universeId', '==', input.universeId)
        .where('status', '==', 'ACCEPTED')
        .orderBy('finalizedAt', 'desc')
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  // ---- Licensing ----

  licenseCanon: protectedProcedure
    .input(
      z.object({
        submissionId: z.string(),
        fee: z.string(),
        txHash: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const subDoc = await submissionsCol.doc(input.submissionId).get();
      if (!subDoc.exists) throw new Error('Submission not found');
      if (subDoc.data()?.status !== 'ACCEPTED') throw new Error('Not accepted canon');

      const license = {
        submissionId: input.submissionId,
        licenseeUid: ctx.user.uid,
        licenseeAddress: ctx.user.address || null,
        fee: input.fee,
        txHash: input.txHash,
        grantedAt: new Date(),
      };

      const ref = await canonLicensesCol.add(license);
      return { id: ref.id, ...license };
    }),

  mySubmissions: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await submissionsCol
      .where('creatorUid', '==', ctx.user.uid)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }),
});
