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

const getBountiesCol = () => (firebaseAvailable ? db.collection('bounties') : null);
const getBountySubmissionsCol = () =>
  firebaseAvailable ? db.collection('bountySubmissions') : null;

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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const col = getBountiesCol();
      if (!col)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Bounties not available' });

      const now = new Date();
      const deadline = new Date(now.getTime() + input.deadlineDays * 86400 * 1000);

      const bounty = {
        poster: ctx.user.address,
        posterUid: ctx.user.uid,
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const bountiesCol = getBountiesCol();
      const subsCol = getBountySubmissionsCol();
      if (!bountiesCol || !subsCol)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

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
        submitterUid: ctx.user.uid,
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
      })
    )
    .mutation(async ({ ctx, input }) => {
      const bountiesCol = getBountiesCol();
      const subsCol = getBountySubmissionsCol();
      if (!bountiesCol || !subsCol)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      const bountyDoc = await bountiesCol.doc(input.bountyId).get();
      if (!bountyDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Bounty not found' });
      const bounty = bountyDoc.data()!;
      if (bounty.poster !== ctx.user.address)
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
      });

      return { success: true };
    }),

  // ── Cancel bounty ──────────────────────────────────────────
  cancel: protectedProcedure
    .input(z.object({ bountyId: z.string(), txHash: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const col = getBountiesCol();
      if (!col)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });
      const doc = await col.doc(input.bountyId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Bounty not found' });
      const bounty = doc.data()!;
      if (bounty.poster !== ctx.user.address)
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
