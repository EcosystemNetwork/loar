/**
 * Story Bounties Router
 *
 * Manages bounty lifecycle off-chain (Firestore) with on-chain $LOAR settlement.
 * Creators post bounties → community submits → creator awards → $LOAR released.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';
import { resolveActingUid, recordAgentCommission } from '../../services/agentAuth';

const getBountiesCol = () => (firebaseAvailable ? db.collection('bounties') : null);
const getBountySubmissionsCol = () =>
  firebaseAvailable ? db.collection('bountySubmissions') : null;

/**
 * Map a bounty `contentType` to the marketplace `submissionTypeEnum`.
 * Marketplace canon submissions accept only CHARACTER/PLOT_ARC/LOCATION/LORE_RULE —
 * bounty types are broader (video/art/music/voiceover/etc), so we collapse them
 * onto the closest canon type. PLOT_ARC is the catch-all for narrative work.
 */
function bountyContentTypeToCanonType(
  contentType: string | undefined
): 'CHARACTER' | 'PLOT_ARC' | 'LOCATION' | 'LORE_RULE' {
  switch (contentType) {
    case 'character':
      return 'CHARACTER';
    case 'lore':
      return 'LORE_RULE';
    default:
      return 'PLOT_ARC';
  }
}

export const bountiesRouter = router({
  // ── List bounties (public) ─────────────────────────────────
  list: publicProcedure
    .input(
      z.object({
        universeId: z.string().optional(),
        status: z.enum(['open', 'claimed', 'cancelled', 'expired']).optional(),
        contentType: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const col = getBountiesCol();
      if (!col) return [];

      let query = col.orderBy('createdAt', 'desc').limit(input.limit);
      if (input.status) query = query.where('status', '==', input.status);
      if (input.universeId) query = query.where('universeId', '==', input.universeId);
      if (input.contentType) query = query.where('contentType', '==', input.contentType);

      const snap = await query.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  // ── Get single bounty ──────────────────────────────────────
  get: publicProcedure.input(z.object({ bountyId: z.string() })).query(async ({ input }) => {
    const col = getBountiesCol();
    if (!col) return null;
    const doc = await col.doc(input.bountyId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  }),

  // ── Create bounty ──────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        universeId: z.string().optional(), // null = platform-wide
        reward: z.number().min(10), // $LOAR amount
        title: z.string().min(5).max(200),
        description: z.string().min(20).max(5000),
        contentType: z.enum([
          'video',
          'story',
          'character',
          'art',
          'music',
          'voiceover',
          'lore',
          'other',
        ]),
        deadlineDays: z.number().min(1).max(365),
        txHash: z.string().optional(), // on-chain tx hash for $LOAR lock
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const col = getBountiesCol();
      if (!col)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Bounties not available' });

      const { actingUid } = await resolveActingUid(ctx.user.uid, input.onBehalfOfUid, 'bounties');

      const now = new Date();
      const deadline = new Date(now.getTime() + input.deadlineDays * 86400 * 1000);

      const bounty = {
        poster: ctx.user.address,
        posterUid: actingUid,
        universeId: input.universeId || null,
        reward: input.reward,
        title: input.title,
        description: input.description,
        contentType: input.contentType,
        deadline: deadline.toISOString(),
        status: 'open',
        claimedBy: null,
        submissionCount: 0,
        txHash: input.txHash || null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      const ref = await col.add(bounty);
      return { id: ref.id, ...bounty };
    }),

  // ── Submit to bounty ───────────────────────────────────────
  submit: protectedProcedure
    .input(
      z.object({
        bountyId: z.string(),
        contentUrl: z.string().url(), // IPFS/storage URL of submission
        contentHash: z.string().optional(),
        description: z.string().max(2000),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const bountiesCol = getBountiesCol();
      const subsCol = getBountySubmissionsCol();
      if (!bountiesCol || !subsCol)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      const { actingUid } = await resolveActingUid(ctx.user.uid, input.onBehalfOfUid, 'bounties');

      const bountyDoc = await bountiesCol.doc(input.bountyId).get();
      if (!bountyDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bounty not found' });
      const bounty = bountyDoc.data()!;
      if (bounty.status !== 'open')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bounty is not open' });
      if (new Date(bounty.deadline) < new Date())
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bounty expired' });

      const now = new Date();
      const submission = {
        bountyId: input.bountyId,
        submitter: ctx.user.address,
        submitterUid: actingUid,
        contentUrl: input.contentUrl,
        contentHash: input.contentHash || null,
        description: input.description,
        status: 'pending', // pending | accepted | rejected
        createdAt: now.toISOString(),
      };

      const ref = await subsCol.add(submission);
      await bountiesCol.doc(input.bountyId).update({
        submissionCount: (bounty.submissionCount || 0) + 1,
        updatedAt: now.toISOString(),
      });

      return { id: ref.id, ...submission };
    }),

  // ── List submissions for a bounty ──────────────────────────
  submissions: publicProcedure
    .input(z.object({ bountyId: z.string() }))
    .query(async ({ input }) => {
      const col = getBountySubmissionsCol();
      if (!col) return [];
      const snap = await col
        .where('bountyId', '==', input.bountyId)
        .orderBy('createdAt', 'desc')
        .get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  // ── Award bounty ───────────────────────────────────────────
  award: protectedProcedure
    .input(
      z.object({
        bountyId: z.string(),
        submissionId: z.string(),
        txHash: z.string().optional(), // on-chain award tx
        autoCanonize: z.boolean().default(true),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const bountiesCol = getBountiesCol();
      const subsCol = getBountySubmissionsCol();
      if (!bountiesCol || !subsCol)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      const { actingUid, agentContract } = await resolveActingUid(
        ctx.user.uid,
        input.onBehalfOfUid,
        'bounties'
      );

      const bountyDoc = await bountiesCol.doc(input.bountyId).get();
      if (!bountyDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bounty not found' });
      const bounty = bountyDoc.data()!;
      if (bounty.posterUid !== actingUid)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only poster can award' });
      if (bounty.status !== 'open')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bounty not open' });

      const subDoc = await subsCol.doc(input.submissionId).get();
      if (!subDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Submission not found' });
      const submission = subDoc.data()!;

      const now = new Date();
      await bountiesCol.doc(input.bountyId).update({
        status: 'claimed',
        claimedBy: submission.submitter,
        winningSubmissionId: input.submissionId,
        awardTxHash: input.txHash || null,
        updatedAt: now.toISOString(),
      });

      await subsCol.doc(input.submissionId).update({
        status: 'accepted',
        acceptedAt: now.toISOString(),
      });

      // Auto-canonize: owner-paid work skips the public vote and lands in canon directly.
      let canonSubmissionId: string | null = null;
      if (input.autoCanonize && bounty.universeId) {
        try {
          const submissionsCol = firebaseAvailable ? db.collection('canonSubmissions') : null;
          if (submissionsCol) {
            const canonRef = await submissionsCol.add({
              universeId: bounty.universeId,
              universeToken: bounty.universeToken || null,
              submissionType: bountyContentTypeToCanonType(bounty.contentType),
              title: bounty.title,
              description: bounty.description,
              contentHash: submission.contentHash || null,
              metadataURI: submission.contentUrl,
              mediaUrl: submission.contentUrl,
              onChainSubmissionId: null,
              creatorUid: submission.submitterUid,
              creatorAddress: submission.submitter,
              status: 'ACCEPTED',
              votesFor: 0,
              votesAgainst: 0,
              voterCount: 0,
              votingDeadline: now,
              acceptedAt: now,
              originatedFrom: `bounty:${input.bountyId}`,
              createdAt: now,
              updatedAt: now,
            });
            canonSubmissionId = canonRef.id;
            await subsCol.doc(input.submissionId).update({ canonSubmissionId });

            // Audit log entry — bounty award → auto-canonized
            if (firebaseAvailable) {
              await db
                .collection('contentAuditLog')
                .add({
                  action: 'bounty.awarded.canonized',
                  bountyId: input.bountyId,
                  submissionId: input.submissionId,
                  canonSubmissionId,
                  universeId: bounty.universeId,
                  posterUid: bounty.posterUid,
                  submitterUid: submission.submitterUid,
                  actingUid,
                  rewardLoar: bounty.reward,
                  txHash: input.txHash || null,
                  createdAt: now,
                })
                .catch((err) => console.error('Audit log write failed:', err));
            }
          }
        } catch (err) {
          // Don't fail the award just because canonization failed; log and continue.
          console.error('Auto-canonize on bounty award failed:', err);
        }
      }

      // Record talent-agent commission when an agent posted/awarded on behalf
      // of the universe owner. Commission is taken off the bounty reward
      // (denominated in $LOAR — convert to 18-decimal wei for the ledger).
      if (agentContract && bounty.reward) {
        const rewardWei = (BigInt(Math.floor(Number(bounty.reward))) * BigInt(1e18)).toString();
        recordAgentCommission({
          agentContractId: agentContract.id,
          agentUid: ctx.user.uid,
          creatorUid: actingUid,
          sourceType: 'collab',
          sourceId: `bounty:${input.bountyId}`,
          grossAmountWei: rewardWei,
          commissionBps: agentContract.commissionBps,
          txHash: input.txHash,
        }).catch(() => {});
      }

      return { success: true, canonSubmissionId };
    }),

  // ── Cancel bounty ──────────────────────────────────────────
  cancel: protectedProcedure
    .input(
      z.object({
        bountyId: z.string(),
        txHash: z.string().optional(),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const col = getBountiesCol();
      if (!col)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      const { actingUid } = await resolveActingUid(ctx.user.uid, input.onBehalfOfUid, 'bounties');

      const doc = await col.doc(input.bountyId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bounty not found' });
      const bounty = doc.data()!;
      if (bounty.posterUid !== actingUid)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only poster can cancel' });
      if (bounty.status !== 'open')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bounty not open' });

      await col.doc(input.bountyId).update({
        status: 'cancelled',
        cancelTxHash: input.txHash || null,
        updatedAt: new Date().toISOString(),
      });

      return { success: true };
    }),

  // ── My bounties (poster) ───────────────────────────────────
  myBounties: protectedProcedure.query(async ({ ctx }) => {
    const col = getBountiesCol();
    if (!col) return [];
    const snap = await col
      .where('poster', '==', ctx.user.address)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),

  // ── My submissions ─────────────────────────────────────────
  mySubmissions: protectedProcedure.query(async ({ ctx }) => {
    const col = getBountySubmissionsCol();
    if (!col) return [];
    const snap = await col
      .where('submitter', '==', ctx.user.address)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),

  // ── Stats ──────────────────────────────────────────────────
  stats: publicProcedure.query(async () => {
    const col = getBountiesCol();
    if (!col) return { total: 0, open: 0, totalReward: 0 };

    const allSnap = await col.get();
    let open = 0;
    let totalReward = 0;
    allSnap.docs.forEach((d) => {
      const data = d.data();
      totalReward += data.reward || 0;
      if (data.status === 'open') open++;
    });

    return { total: allSnap.size, open, totalReward };
  }),
});
