/**
 * Revenue Dashboard Router
 *
 * Aggregates revenue data across all monetization streams and provides
 * historical snapshots for charts. Tracks on-chain claim history.
 */
import { z } from 'zod';
import { protectedProcedure, adminProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

const snapshotsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('revenueSnapshots');
};

const claimHistoryCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('claimHistory');
};

const REVENUE_SOURCES = [
  'nft_sales',
  'subscriptions',
  'credits',
  'licensing',
  'merch',
  'ads',
  'canon_royalties',
  'collabs',
  'appearance_fees',
] as const;

const revenueSourceEnum = z.enum(REVENUE_SOURCES);

export const revenueRouter = router({
  /** Get aggregated revenue dashboard for the authenticated creator */
  getDashboard: protectedProcedure.query(async ({ ctx }) => {
    const uid = ctx.user.uid;

    // Aggregate from snapshots (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const snapshot = await snapshotsCol()
      .where('creatorUid', '==', uid)
      .where('date', '>=', thirtyDaysAgo.toISOString().split('T')[0])
      .get();

    const bySource: Record<string, number> = {};
    let totalEarned = 0;
    let transactionCount = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const source = data.source as string;
      const amount = data.amountEth as number;
      bySource[source] = (bySource[source] || 0) + amount;
      totalEarned += amount;
      transactionCount += data.count || 1;
    }

    // Get recent claims
    const recentClaims = await claimHistoryCol()
      .where('creatorAddress', '==', ctx.user.address?.toLowerCase())
      .orderBy('claimedAt', 'desc')
      .limit(5)
      .get();

    const claims = recentClaims.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return {
      totalEarned30d: totalEarned,
      transactionCount30d: transactionCount,
      bySource,
      recentClaims: claims,
    };
  }),

  /** Get historical revenue data for charts */
  getHistory: protectedProcedure
    .input(
      z.object({
        days: z.number().min(7).max(365).default(30),
        source: revenueSourceEnum.optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);

      let query = snapshotsCol()
        .where('creatorUid', '==', ctx.user.uid)
        .where('date', '>=', startDate.toISOString().split('T')[0])
        .orderBy('date', 'asc');

      if (input.source) {
        query = snapshotsCol()
          .where('creatorUid', '==', ctx.user.uid)
          .where('source', '==', input.source)
          .where('date', '>=', startDate.toISOString().split('T')[0])
          .orderBy('date', 'asc');
      }

      const snapshot = await query.get();
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
    }),

  /** Record an on-chain claim from PaymentRouter */
  recordClaim: protectedProcedure
    .input(
      z.object({
        amountWei: z.string(),
        txHash: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await claimHistoryCol().add({
        creatorUid: ctx.user.uid,
        creatorAddress: ctx.user.address?.toLowerCase(),
        amountWei: input.amountWei,
        txHash: input.txHash,
        claimedAt: new Date(),
      });
      return { ok: true };
    }),

  /** Get claim history */
  getClaimHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      let query = claimHistoryCol()
        .where('creatorAddress', '==', ctx.user.address?.toLowerCase())
        .orderBy('claimedAt', 'desc')
        .limit(input.limit);

      if (input.cursor) {
        const cursorDoc = await claimHistoryCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      return {
        claims: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  /** Record a revenue event (admin/internal only — called by other routers server-side) */
  recordRevenue: adminProcedure
    .input(
      z.object({
        source: revenueSourceEnum,
        amountEth: z.number(),
        amountUsd: z.number().optional(),
        metadata: z
          .record(z.string().max(200))
          .optional()
          .refine((m) => !m || Object.keys(m).length <= 10, 'Max 10 metadata fields'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const date = new Date().toISOString().split('T')[0];
      const docId = `${ctx.user.uid}_${date}_${input.source}`;

      await snapshotsCol()
        .doc(docId)
        .set(
          {
            creatorUid: ctx.user.uid,
            creatorAddress: ctx.user.address?.toLowerCase(),
            date,
            source: input.source,
            amountEth: FieldValue.increment(input.amountEth),
            amountUsd: input.amountUsd
              ? FieldValue.increment(input.amountUsd)
              : FieldValue.increment(0),
            count: FieldValue.increment(1),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      return { ok: true };
    }),

  /** Admin: Manually trigger daily snapshot aggregation */
  snapshotDaily: adminProcedure.mutation(async () => {
    // This would aggregate from other collections (orders, subscriptions, etc.)
    // into revenueSnapshots. For now, snapshots are built incrementally via recordRevenue.
    return { ok: true, message: 'Snapshots are built incrementally via recordRevenue' };
  }),
});
