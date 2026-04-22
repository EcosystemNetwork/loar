/**
 * Canon Marketplace Router — Submit content for universe canon,
 * vote on submissions, license accepted canon
 */
import { protectedProcedure, publicProcedure, router, requirePermission } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { getPlatformConfig, bpsToFraction } from '../../services/platformConfig';
import { randomUUID } from 'crypto';
import { getStorageManager } from '../../services/storage';
import { assertContentOperable, assertCanonReadyForMonetization } from '../../lib/content-status';

const submissionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('canonSubmissions');
};
const canonVotesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('canonVotes');
};
const canonLicensesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('canonLicenses');
};
const marketplaceSalesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('marketplaceSales');
};
const contentCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('content');
};

const submissionTypeEnum = z.enum(['CHARACTER', 'PLOT_ARC', 'LOCATION', 'LORE_RULE']);

export const marketplaceRouter = router({
  // ---- Submissions ----

  submit: protectedProcedure
    .use(requirePermission('marketplace.submit'))
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
        /** On-chain uint256 submission id returned by CanonMarketplace.submit(). Enables on-chain finalize/license. */
        onChainSubmissionId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const submission = {
          ...input,
          onChainSubmissionId: input.onChainSubmissionId ?? null,
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

        const ref = await submissionsCol().add(submission);
        return { id: ref.id, ...submission };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error('Error in submit:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Operation failed',
          cause: error,
        });
      }
    }),

  vote: protectedProcedure
    .input(
      z.object({
        submissionId: z.string(),
        support: z.boolean(),
        // TODO: verify vote weight on-chain via governance token balanceOf
        weight: z.string().refine((w) => {
          const num = parseFloat(w);
          return !isNaN(num) && num > 0 && num <= 1e24;
        }, 'Vote weight must be between 0 and 1e24'),
        txHash: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const weightNum = parseFloat(input.weight);
        if (isNaN(weightNum) || weightNum <= 0) throw new Error('Invalid vote weight');

        // Use a deterministic doc ID to prevent duplicate votes atomically
        const voteDocId = `${input.submissionId}_${ctx.user.uid}`;
        const voteRef = canonVotesCol().doc(voteDocId);

        // Run dedup check + vote recording inside a transaction to prevent race conditions
        const voteData = await db.runTransaction(async (tx) => {
          const existingVote = await tx.get(voteRef);
          if (existingVote.exists) throw new Error('Already voted on this submission');

          const subRef = submissionsCol().doc(input.submissionId);
          const subDoc = await tx.get(subRef);
          if (!subDoc.exists) throw new Error('Submission not found');

          const sub = subDoc.data()!;
          if (sub.status !== 'VOTING') throw new Error('Submission is not in voting status');
          if (sub.votingDeadline?.toDate && new Date() > sub.votingDeadline.toDate()) {
            throw new Error('Voting has ended');
          }

          const vote = {
            submissionId: input.submissionId,
            voterUid: ctx.user.uid,
            voterAddress: ctx.user.address || null,
            support: input.support,
            weight: input.weight,
            txHash: input.txHash || null,
            votedAt: new Date(),
          };

          tx.set(voteRef, vote);
          tx.update(subRef, {
            votesFor: input.support ? (sub.votesFor || 0) + weightNum : sub.votesFor || 0,
            votesAgainst: !input.support
              ? (sub.votesAgainst || 0) + weightNum
              : sub.votesAgainst || 0,
            voterCount: (sub.voterCount || 0) + 1,
            updatedAt: new Date(),
          });

          return vote;
        });

        return { ok: true, vote: voteData };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        if (error instanceof Error && error.message.includes('Already voted')) {
          throw new TRPCError({ code: 'CONFLICT', message: error.message });
        }
        console.error('Error in vote:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Operation failed',
          cause: error,
        });
      }
    }),

  finalize: protectedProcedure
    .input(
      z.object({
        submissionId: z.string(),
        /** On-chain tx hash for CanonMarketplace.finalize() — stored for audit when present. */
        txHash: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const ref = submissionsCol().doc(input.submissionId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Submission not found');

      const sub = doc.data()!;
      if (sub.status !== 'VOTING') throw new Error('Not in voting status');
      if (new Date() < sub.votingDeadline?.toDate?.()) throw new Error('Voting not ended');

      const accepted = (sub.votesFor || 0) > (sub.votesAgainst || 0);
      const now = new Date();

      await ref.update({
        status: accepted ? 'ACCEPTED' : 'REJECTED',
        finalizedAt: now,
        finalizeTxHash: input.txHash || null,
        updatedAt: now,
      });

      // ── On acceptance: pin to IPFS and lock content as canon ──
      if (accepted && sub.contentHash) {
        try {
          const manager = getStorageManager();
          const pinResult = await manager.pinToIPFS(sub.contentHash);

          // Mark the submission as permanently stored
          await ref.update({
            ipfsCid: pinResult.cid,
            ipfsUrl: pinResult.url,
            canonLocked: true,
            canonLockedAt: now,
          });

          // If there's a linked content doc, lock it too
          const contentSnap = await contentCol()
            .where('contentHash', '==', sub.contentHash)
            .limit(1)
            .get();

          if (!contentSnap.empty) {
            await contentSnap.docs[0].ref.update({
              canonLocked: true,
              canonLockedAt: now,
              canonUniverseId: sub.universeId,
              canonSubmissionId: input.submissionId,
              ipfsCid: pinResult.cid,
              ipfsUrl: pinResult.url,
              updatedAt: now,
            });
          }
        } catch (pinErr) {
          // Non-fatal — canon is accepted even if IPFS pin fails
          // Can be retried later
          console.error('[Canon] IPFS pin failed for accepted submission:', pinErr);
        }
      }

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
      let query: FirebaseFirestore.Query = submissionsCol().where(
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

  getSubmission: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const doc = await submissionsCol().doc(input.id).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }),

  getVotes: publicProcedure
    .input(
      z.object({
        submissionId: z.string(),
        limit: z.number().min(1).max(500).default(100),
      })
    )
    .query(async ({ input }) => {
      const snapshot = await canonVotesCol()
        .where('submissionId', '==', input.submissionId)
        .orderBy('votedAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  getCanon: publicProcedure.input(z.object({ universeId: z.string() })).query(async ({ input }) => {
    const snapshot = await submissionsCol()
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
        fee: z.string(), // wei
        txHash: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const subDoc = await submissionsCol().doc(input.submissionId).get();
      if (!subDoc.exists) throw new Error('Submission not found');
      const sub = subDoc.data()!;
      if (sub.status !== 'ACCEPTED') throw new Error('Not accepted canon');

      // Block licensing of moderated content
      if (sub.contentId) {
        await assertContentOperable(sub.contentId);
        await assertCanonReadyForMonetization(sub.contentId);
      }

      const config = await getPlatformConfig();
      const feeBps = config.marketplacePlatformFeeBps;
      const feeWei = BigInt(input.fee);
      const platformFeeWei = (feeWei * BigInt(feeBps)) / BigInt(10_000);
      const creatorReceivesWei = feeWei - platformFeeWei;

      const license = {
        submissionId: input.submissionId,
        licenseeUid: ctx.user.uid,
        licenseeAddress: ctx.user.address || null,
        creatorUid: sub.creatorUid || null,
        creatorAddress: sub.creatorAddress || null,
        fee: input.fee,
        txHash: input.txHash,
        platformFeeBps: feeBps,
        platformFeeWei: platformFeeWei.toString(),
        creatorReceivesWei: creatorReceivesWei.toString(),
        grantedAt: new Date(),
      };

      const [licenseRef] = await Promise.all([
        canonLicensesCol().add(license),
        // Record the sale for platform revenue tracking
        marketplaceSalesCol().add({
          id: randomUUID(),
          type: 'canon_license',
          submissionId: input.submissionId,
          buyerUid: ctx.user.uid,
          sellerUid: sub.creatorUid || null,
          universeId: sub.universeId || null,
          grossWei: input.fee,
          platformFeeBps: feeBps,
          platformFeeWei: platformFeeWei.toString(),
          sellerReceivesWei: creatorReceivesWei.toString(),
          txHash: input.txHash,
          createdAt: new Date(),
        }),
      ]);

      return { id: licenseRef.id, ...license };
    }),

  // ---- Platform fee info ----

  getPlatformFee: publicProcedure.query(async () => {
    const config = await getPlatformConfig();
    return {
      feeBps: config.marketplacePlatformFeeBps,
      feePercent: bpsToFraction(config.marketplacePlatformFeeBps) * 100,
    };
  }),

  mySubmissions: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await submissionsCol()
      .where('creatorUid', '==', ctx.user.uid)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }),
});
