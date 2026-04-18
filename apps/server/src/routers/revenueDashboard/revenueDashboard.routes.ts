/**
 * Revenue Dashboard Router
 *
 * Aggregates revenue data from multiple Firestore collections into a
 * creator analytics view. Supports summary, timeline, per-universe
 * breakdown, leaderboard, and CSV/JSON export for tax purposes.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { db } from '../../lib/firebase';
import { TRPCError } from '@trpc/server';

// ── Lazy-init collection accessors ──────────────────────────────────────
const col = (name: string) => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection(name);
};

const getNftSalesCol = () => col('nftSales');
const getSubscriptionPaymentsCol = () => col('subscriptionPayments');
const getLicensingDealsCol = () => col('licensingDeals');
const getAdRevenueCol = () => col('adRevenue');
const getCreditTransactionsCol = () => col('creditTransactions');
const getUniversesCol = () => col('cinematicUniverses');
const getProfilesCol = () => col('profiles');
const getExportsCol = () => col('revenueExports');

// ── Period helpers ──────────────────────────────────────────────────────
function periodToDate(period?: string): Date | null {
  if (!period || period === 'all') return null;
  const now = new Date();
  switch (period) {
    case 'day':
      now.setDate(now.getDate() - 1);
      return now;
    case 'week':
      now.setDate(now.getDate() - 7);
      return now;
    case 'month':
      now.setMonth(now.getMonth() - 1);
      return now;
    case 'quarter':
      now.setMonth(now.getMonth() - 3);
      return now;
    case 'year':
      now.setFullYear(now.getFullYear() - 1);
      return now;
    default:
      return null;
  }
}

/** Sum an amount field from query results, handling string (wei) and number values. */
function sumField(docs: FirebaseFirestore.QueryDocumentSnapshot[], field: string): number {
  let total = 0;
  for (const doc of docs) {
    const val = doc.data()[field];
    if (typeof val === 'number') {
      total += val;
    } else if (typeof val === 'string' && val !== '0') {
      // Assume wei string — convert to ETH-ish number
      try {
        total += Number(BigInt(val)) / 1e18;
      } catch {
        total += parseFloat(val) || 0;
      }
    }
  }
  return total;
}

/** Build a Firestore query with optional period and universe filters. */
function buildQuery(
  colRef: FirebaseFirestore.CollectionReference,
  userField: string,
  uid: string,
  since: Date | null,
  universeAddress?: string,
  dateField = 'createdAt'
) {
  let q: FirebaseFirestore.Query = colRef.where(userField, '==', uid);
  if (since) {
    q = q.where(dateField, '>=', since);
  }
  if (universeAddress) {
    q = q.where('universeAddress', '==', universeAddress.toLowerCase());
  }
  return q;
}

export const revenueDashboardRouter = router({
  /** Aggregated revenue summary across all streams */
  summary: protectedProcedure
    .input(
      z.object({
        period: z.enum(['day', 'week', 'month', 'all']).optional().default('month'),
        universeAddress: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const uid = ctx.user.uid;
      const since = periodToDate(input.period);
      const uAddr = input.universeAddress?.toLowerCase();

      // Query all revenue collections in parallel
      const [nftSnap, subSnap, licSnap, adSnap, creditSnap] = await Promise.all([
        buildQuery(getNftSalesCol(), 'sellerUid', uid, since, uAddr).limit(500).get(),
        buildQuery(getSubscriptionPaymentsCol(), 'creatorUid', uid, since, uAddr).limit(500).get(),
        buildQuery(getLicensingDealsCol(), 'licensorUid', uid, since, uAddr).limit(500).get(),
        buildQuery(getAdRevenueCol(), 'creatorUid', uid, since, uAddr).limit(500).get(),
        buildQuery(getCreditTransactionsCol(), 'userId', uid, since, uAddr).limit(1000).get(),
      ]);

      const nftSales = sumField(nftSnap.docs, 'amount');
      const subscriptions = sumField(subSnap.docs, 'amount');
      const licensing = sumField(licSnap.docs, 'amount');
      const ads = sumField(adSnap.docs, 'amount');

      // Credit transactions: separate earned vs spent
      let totalCreditsEarned = 0;
      let totalCreditsSpent = 0;
      for (const doc of creditSnap.docs) {
        const data = doc.data();
        const credits = typeof data.credits === 'number' ? data.credits : 0;
        if (data.type === 'earn' || data.type === 'fund' || data.type === 'purchase') {
          totalCreditsEarned += credits;
        } else if (data.type === 'spend' || data.type === 'debit') {
          totalCreditsSpent += credits;
        }
      }

      // Canon marketplace revenue (stored in nftSales with source marker)
      let canonMarketplace = 0;
      for (const doc of nftSnap.docs) {
        if (doc.data().source === 'canon_marketplace') {
          const val = doc.data().amount;
          canonMarketplace += typeof val === 'number' ? val : 0;
        }
      }

      const totalRevenue = nftSales + subscriptions + licensing + ads;

      // Top content by revenue
      const contentMap = new Map<string, { contentId: string; title: string; revenue: number }>();
      for (const snap of [nftSnap, subSnap, licSnap, adSnap]) {
        for (const doc of snap.docs) {
          const data = doc.data();
          const cid = data.contentId;
          if (!cid) continue;
          const amount = typeof data.amount === 'number' ? data.amount : 0;
          const existing = contentMap.get(cid);
          if (existing) {
            existing.revenue += amount;
          } else {
            contentMap.set(cid, {
              contentId: cid,
              title: data.contentTitle ?? data.title ?? cid,
              revenue: amount,
            });
          }
        }
      }
      const topContent = Array.from(contentMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10);

      return {
        totalRevenue,
        revenueBySource: {
          nftSales: nftSales - canonMarketplace,
          subscriptions,
          licensing,
          ads,
          tips: 0, // reserved for future tips collection
          canonMarketplace,
        },
        totalCreditsEarned,
        totalCreditsSpent,
        netCredits: totalCreditsEarned - totalCreditsSpent,
        topContent,
        period: input.period,
      };
    }),

  /** Daily/weekly revenue data points for charting */
  timeline: protectedProcedure
    .input(
      z.object({
        period: z.enum(['week', 'month', 'quarter', 'year']),
        universeAddress: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const uid = ctx.user.uid;
      const since = periodToDate(input.period)!;
      const uAddr = input.universeAddress?.toLowerCase();

      // Fetch all revenue sources in parallel
      const [nftSnap, subSnap, licSnap, adSnap] = await Promise.all([
        buildQuery(getNftSalesCol(), 'sellerUid', uid, since, uAddr).limit(1000).get(),
        buildQuery(getSubscriptionPaymentsCol(), 'creatorUid', uid, since, uAddr).limit(1000).get(),
        buildQuery(getLicensingDealsCol(), 'licensorUid', uid, since, uAddr).limit(1000).get(),
        buildQuery(getAdRevenueCol(), 'creatorUid', uid, since, uAddr).limit(1000).get(),
      ]);

      const sourceMap: Record<string, FirebaseFirestore.QueryDocumentSnapshot[]> = {
        nftSales: nftSnap.docs,
        subscriptions: subSnap.docs,
        licensing: licSnap.docs,
        ads: adSnap.docs,
      };

      // Aggregate by date + source
      const pointMap = new Map<string, { date: string; revenue: number; source: string }>();

      for (const [source, docs] of Object.entries(sourceMap)) {
        for (const doc of docs) {
          const data = doc.data();
          const createdAt = data.createdAt?.toDate?.() ?? new Date(data.createdAt);
          const dateStr = createdAt.toISOString().split('T')[0];
          const key = `${dateStr}_${source}`;
          const amount = typeof data.amount === 'number' ? data.amount : 0;

          const existing = pointMap.get(key);
          if (existing) {
            existing.revenue += amount;
          } else {
            pointMap.set(key, { date: dateStr, revenue: amount, source });
          }
        }
      }

      const dataPoints = Array.from(pointMap.values()).sort((a, b) => a.date.localeCompare(b.date));

      return { dataPoints };
    }),

  /** Revenue breakdown per universe the user owns */
  byUniverse: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).optional().default(20) }))
    .query(async ({ ctx, input }) => {
      const uid = ctx.user.uid;

      // Get all universes owned by this user
      const universesSnap = await getUniversesCol()
        .where('creator', '==', uid.toLowerCase())
        .limit(input.limit)
        .get();

      if (universesSnap.empty) return { universes: [] };

      const results = await Promise.all(
        universesSnap.docs.map(async (uDoc) => {
          const uData = uDoc.data();
          const uAddr = uDoc.id;

          // Revenue from nftSales for this universe
          const [nftSnap, subSnap] = await Promise.all([
            getNftSalesCol()
              .where('sellerUid', '==', uid)
              .where('universeAddress', '==', uAddr)
              .limit(500)
              .get(),
            getSubscriptionPaymentsCol()
              .where('creatorUid', '==', uid)
              .where('universeAddress', '==', uAddr)
              .limit(500)
              .get(),
          ]);

          const totalRevenue = sumField(nftSnap.docs, 'amount') + sumField(subSnap.docs, 'amount');

          return {
            universeAddress: uAddr,
            universeName: uData.name ?? uAddr,
            totalRevenue,
            holders: uData.holderCount ?? 0,
            subscribers: uData.subscriberCount ?? 0,
          };
        })
      );

      // Sort by revenue descending
      results.sort((a, b) => b.totalRevenue - a.totalRevenue);

      return { universes: results };
    }),

  /** Public leaderboard of top-earning creators */
  topEarners: publicProcedure
    .input(
      z.object({
        period: z.enum(['week', 'month', 'all']).optional().default('month'),
        limit: z.number().min(1).max(50).optional().default(10),
      })
    )
    .query(async ({ input }) => {
      const since = periodToDate(input.period);

      // Aggregate from nftSales (the largest revenue source)
      let q: FirebaseFirestore.Query = getNftSalesCol();
      if (since) {
        q = q.where('createdAt', '>=', since);
      }
      const snap = await q.limit(5000).get();

      // Group by seller
      const sellerMap = new Map<string, { uid: string; address: string; revenue: number }>();
      for (const doc of snap.docs) {
        const data = doc.data();
        const seller = data.sellerUid;
        if (!seller) continue;
        const amount = typeof data.amount === 'number' ? data.amount : 0;
        const existing = sellerMap.get(seller);
        if (existing) {
          existing.revenue += amount;
        } else {
          sellerMap.set(seller, {
            uid: seller,
            address: data.sellerAddress ?? '',
            revenue: amount,
          });
        }
      }

      const sorted = Array.from(sellerMap.values())
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, input.limit);

      // Enrich with profile names (best-effort)
      const enriched = await Promise.all(
        sorted.map(async (entry) => {
          let displayName: string | null = null;
          try {
            const profileDoc = await getProfilesCol().doc(entry.uid).get();
            if (profileDoc.exists) {
              displayName = profileDoc.data()?.displayName ?? null;
            }
          } catch {
            // Profile lookup is best-effort
          }
          return {
            displayName:
              displayName ??
              (entry.address
                ? `${entry.address.slice(0, 6)}...${entry.address.slice(-4)}`
                : 'Anonymous'),
            revenue: entry.revenue,
            period: input.period,
          };
        })
      );

      return { leaderboard: enriched };
    }),

  /** Export revenue data as CSV or JSON for tax/1099 purposes */
  export: protectedProcedure
    .input(
      z.object({
        period: z.enum(['month', 'quarter', 'year']),
        format: z.enum(['csv', 'json']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const uid = ctx.user.uid;
      const since = periodToDate(input.period)!;

      // Collect all transactions across sources
      const [nftSnap, subSnap, licSnap, adSnap] = await Promise.all([
        buildQuery(getNftSalesCol(), 'sellerUid', uid, since).limit(5000).get(),
        buildQuery(getSubscriptionPaymentsCol(), 'creatorUid', uid, since).limit(5000).get(),
        buildQuery(getLicensingDealsCol(), 'licensorUid', uid, since).limit(5000).get(),
        buildQuery(getAdRevenueCol(), 'creatorUid', uid, since).limit(5000).get(),
      ]);

      interface ExportRow {
        date: string;
        source: string;
        amount: number;
        contentId: string;
        transactionId: string;
      }

      const rows: ExportRow[] = [];

      const addRows = (docs: FirebaseFirestore.QueryDocumentSnapshot[], source: string) => {
        for (const doc of docs) {
          const data = doc.data();
          const createdAt = data.createdAt?.toDate?.() ?? new Date(data.createdAt ?? Date.now());
          rows.push({
            date: createdAt.toISOString(),
            source,
            amount: typeof data.amount === 'number' ? data.amount : 0,
            contentId: data.contentId ?? '',
            transactionId: doc.id,
          });
        }
      };

      addRows(nftSnap.docs, 'nft_sales');
      addRows(subSnap.docs, 'subscriptions');
      addRows(licSnap.docs, 'licensing');
      addRows(adSnap.docs, 'ads');

      rows.sort((a, b) => a.date.localeCompare(b.date));

      let content: string;
      let mimeType: string;

      if (input.format === 'csv') {
        const header = 'date,source,amount,contentId,transactionId';
        const csvRows = rows.map(
          (r) => `${r.date},${r.source},${r.amount},${r.contentId},${r.transactionId}`
        );
        content = [header, ...csvRows].join('\n');
        mimeType = 'text/csv';
      } else {
        content = JSON.stringify(rows, null, 2);
        mimeType = 'application/json';
      }

      // Store the export record in Firestore with the content
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `revenue-${input.period}-${timestamp}.${input.format}`;
      const exportId = `${uid}_${timestamp}`;

      await getExportsCol().doc(exportId).set({
        userId: uid,
        filename,
        format: input.format,
        period: input.period,
        rowCount: rows.length,
        content,
        mimeType,
        createdAt: new Date(),
      });

      return {
        exportId,
        filename,
        rowCount: rows.length,
        downloadUrl: `/api/exports/${exportId}`,
      };
    }),
});
