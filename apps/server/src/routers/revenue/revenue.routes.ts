/**
 * Revenue Dashboard Router
 *
 * Aggregates revenue data across all monetization streams and provides
 * historical snapshots for charts. Tracks on-chain claim history.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createPublicClient, http } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { protectedProcedure, adminProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});
const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
});

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

type RevenueSource = (typeof REVENUE_SOURCES)[number];
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

  /** Record an on-chain claim from PaymentRouter — verifies tx succeeded */
  recordClaim: protectedProcedure
    .input(
      z.object({
        amountWei: z.string(),
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid transaction hash'),
        chainId: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Deduplicate: reject if this txHash was already recorded
      const existingSnap = await claimHistoryCol()
        .where('txHash', '==', input.txHash)
        .limit(1)
        .get();
      if (!existingSnap.empty) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Claim already recorded for this transaction',
        });
      }

      // Verify the transaction succeeded on-chain
      const client = input.chainId === baseSepolia.id ? baseSepoliaClient : sepoliaClient;
      try {
        const receipt = await client.getTransactionReceipt({
          hash: input.txHash as `0x${string}`,
        });
        if (receipt.status !== 'success') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Claim transaction was reverted on-chain',
          });
        }
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Claim transaction not found on-chain',
        });
      }

      await claimHistoryCol().add({
        creatorUid: ctx.user.uid,
        creatorAddress: ctx.user.address?.toLowerCase(),
        amountWei: input.amountWei,
        txHash: input.txHash,
        onChainVerified: true,
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
          .record(z.string(), z.string().max(200))
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

  /** Admin: Manually trigger daily snapshot aggregation.
   *  Scans orders, subscription revenue, merch orders, content deals, and
   *  marketplace sales from the last N days and backfills revenueSnapshots. */
  snapshotDaily: adminProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(1) }))
    .mutation(async ({ input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.days);

      const collections: {
        col: string;
        sourceType: RevenueSource;
        amountField: string;
        creatorField: string;
        addressField?: string;
        universeField?: string;
      }[] = [
        {
          col: 'orders',
          sourceType: 'nft_sales',
          amountField: 'price',
          creatorField: 'sellerUid',
          addressField: 'sellerAddress',
          universeField: 'universeId',
        },
        {
          col: 'subscriptionRevenue',
          sourceType: 'subscriptions',
          amountField: 'amountWei',
          creatorField: 'creatorUid',
          addressField: 'creatorAddress',
          universeField: 'universeId',
        },
        {
          col: 'merchOrders',
          sourceType: 'merch',
          amountField: 'totalPrice',
          creatorField: 'sellerUid',
          universeField: 'universeId',
        },
        {
          col: 'contentDeals',
          sourceType: 'licensing',
          amountField: 'pricePaid',
          creatorField: 'sellerUid',
          universeField: 'universeId',
        },
        {
          col: 'marketplaceSales',
          sourceType: 'canon_royalties',
          amountField: 'creatorReceivable',
          creatorField: 'creatorUid',
          universeField: 'universeId',
        },
      ];

      let totalRecorded = 0;

      for (const {
        col,
        sourceType,
        amountField,
        creatorField,
        addressField,
        universeField,
      } of collections) {
        try {
          const snap = await db.collection(col).where('createdAt', '>=', since).get();

          for (const doc of snap.docs) {
            const data = doc.data();
            const creator = data[creatorField];
            const amount = data[amountField];
            if (!creator || !amount || amount === '0') continue;

            const date = (data.createdAt?.toDate?.() ?? new Date()).toISOString().split('T')[0];
            const docId = `${creator}_${date}_${sourceType}`;
            const amountNum =
              typeof amount === 'string' ? Number(BigInt(amount)) / 1e18 : Number(amount);

            await snapshotsCol()
              .doc(docId)
              .set(
                {
                  creatorUid: creator,
                  creatorAddress: addressField ? (data[addressField]?.toLowerCase() ?? null) : null,
                  universeId: universeField ? (data[universeField] ?? null) : null,
                  date,
                  source: sourceType,
                  amountEth: FieldValue.increment(amountNum),
                  count: FieldValue.increment(1),
                  updatedAt: new Date(),
                },
                { merge: true }
              );
            totalRecorded++;
          }
        } catch (err) {
          // Collection may not exist yet — skip silently
          console.warn(`[revenue snapshot] Skipped ${col}:`, err);
        }
      }

      return { ok: true, totalRecorded, days: input.days };
    }),
});
