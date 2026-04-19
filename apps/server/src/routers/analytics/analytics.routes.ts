/**
 * Analytics Router — Engagement tracking and data insights
 * Records views, mints, trending data. Valuable for AI training and studios.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { db } from '../../lib/firebase';
import { z } from 'zod';

// ── Rate limiting for public analytics writes ─────────────────────────
const analyticsRateLimit = new Map<string, { count: number; resetAt: number }>();
const ANALYTICS_LIMIT = 30; // max writes per key per minute
const ANALYTICS_WINDOW = 60_000;

function checkAnalyticsRate(key: string): void {
  const now = Date.now();
  const entry = analyticsRateLimit.get(key);
  if (entry && now < entry.resetAt) {
    if (entry.count >= ANALYTICS_LIMIT) {
      throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded' });
    }
    entry.count++;
  } else {
    analyticsRateLimit.set(key, { count: 1, resetAt: now + ANALYTICS_WINDOW });
  }
  // Periodic cleanup
  if (analyticsRateLimit.size > 5000) {
    for (const [k, v] of analyticsRateLimit) {
      if (now > v.resetAt) analyticsRateLimit.delete(k);
    }
  }
}

const analyticsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('analytics');
};
const viewsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('episodeViews');
};
const engagementCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('engagement');
};
const trendingCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('trending');
};

export const analyticsRouter = router({
  // ---- Record Events ----

  recordView: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        episodeId: z.string(),
        viewerAddress: z.string().optional(),
        duration: z.number().optional(), // seconds watched
      })
    )
    .mutation(async ({ input }) => {
      checkAnalyticsRate(`view:${input.universeId}:${input.viewerAddress || 'anon'}`);
      await viewsCol().add({
        ...input,
        viewedAt: new Date(),
      });

      // Update universe metrics
      const metricsRef = analyticsCol().doc(input.universeId);
      const metricsDoc = await metricsRef.get();

      if (metricsDoc.exists) {
        const data = metricsDoc.data()!;
        await metricsRef.update({
          totalViews: (data.totalViews || 0) + 1,
          lastActivity: new Date(),
        });
      } else {
        await metricsRef.set({
          universeId: input.universeId,
          totalViews: 1,
          totalMints: 0,
          totalVotes: 0,
          totalSubscribers: 0,
          totalRevenue: '0',
          lastActivity: new Date(),
          createdAt: new Date(),
        });
      }

      return { ok: true };
    }),

  recordEngagement: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        episodeId: z.string(),
        type: z.enum(['like', 'share', 'comment', 'bookmark']),
        userAddress: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      checkAnalyticsRate(`engage:${input.universeId}:${input.userAddress || 'anon'}`);
      await engagementCol().add({
        ...input,
        createdAt: new Date(),
      });

      return { ok: true };
    }),

  // ---- Universe Metrics ----

  getUniverseMetrics: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const doc = await analyticsCol().doc(input.universeId).get();
      if (!doc.exists) {
        return {
          universeId: input.universeId,
          totalViews: 0,
          totalMints: 0,
          totalVotes: 0,
          totalSubscribers: 0,
          totalRevenue: '0',
        };
      }
      return { id: doc.id, ...doc.data() };
    }),

  // ---- Episode Analytics ----

  getEpisodeMetrics: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        episodeId: z.string(),
      })
    )
    .query(async ({ input }) => {
      const [views, engagement] = await Promise.all([
        viewsCol()
          .where('universeId', '==', input.universeId)
          .where('episodeId', '==', input.episodeId)
          .get(),
        engagementCol()
          .where('universeId', '==', input.universeId)
          .where('episodeId', '==', input.episodeId)
          .get(),
      ]);

      const engagementBreakdown: Record<string, number> = {};
      engagement.docs.forEach((d) => {
        const type = d.data().type;
        engagementBreakdown[type] = (engagementBreakdown[type] || 0) + 1;
      });

      const totalDuration = views.docs.reduce((sum, d) => sum + (d.data().duration || 0), 0);

      return {
        views: views.size,
        avgWatchDuration: views.size > 0 ? Math.round(totalDuration / views.size) : 0,
        engagement: engagementBreakdown,
        totalEngagement: engagement.size,
      };
    }),

  // ---- Trending ----

  getTrending: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      const snapshot = await analyticsCol().orderBy('totalViews', 'desc').limit(input.limit).get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  getRecentActivity: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        universeId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query: FirebaseFirestore.Query = viewsCol();
      if (input.universeId) {
        query = query.where('universeId', '==', input.universeId);
      }
      const snapshot = await query.orderBy('viewedAt', 'desc').limit(input.limit).get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  // ---- Data Export (for AI training / studio insights) ----

  exportUniverseData: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        includeViews: z.boolean().default(true),
        includeEngagement: z.boolean().default(true),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify caller owns/created this universe before exporting data
      const universesCol = db!.collection('cinematicUniverses');
      const universeDoc = await universesCol.doc(input.universeId).get();
      if (universeDoc.exists) {
        const universeData = universeDoc.data();
        if (
          universeData?.creatorUid !== ctx.user.uid &&
          universeData?.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the universe creator can export analytics',
          });
        }
      }

      const dateFrom = input.dateFrom ? new Date(input.dateFrom) : new Date(0);
      const dateTo = input.dateTo ? new Date(input.dateTo) : new Date();

      const results: Record<string, any> = {
        universeId: input.universeId,
        exportedAt: new Date().toISOString(),
      };

      // Metrics
      const metricsDoc = await analyticsCol().doc(input.universeId).get();
      results.metrics = metricsDoc.exists ? metricsDoc.data() : null;

      if (input.includeViews) {
        const views = await viewsCol()
          .where('universeId', '==', input.universeId)
          .where('viewedAt', '>=', dateFrom)
          .where('viewedAt', '<=', dateTo)
          .orderBy('viewedAt', 'desc')
          .limit(1000)
          .get();

        results.views = views.docs.map((d) => d.data());
        results.viewCount = views.size;
      }

      if (input.includeEngagement) {
        const engagement = await engagementCol()
          .where('universeId', '==', input.universeId)
          .where('createdAt', '>=', dateFrom)
          .where('createdAt', '<=', dateTo)
          .orderBy('createdAt', 'desc')
          .limit(1000)
          .get();

        results.engagement = engagement.docs.map((d) => d.data());
        results.engagementCount = engagement.size;
      }

      return results;
    }),

  // ---- Funnel (wallet-based) ----
  //
  // 3-stage wallet funnel, joined across collections:
  //   1. Viewed   — distinct `viewerAddress` in episodeViews
  //   2. Engaged  — wallets from step 1 that also produced an engagement event
  //   3. Minted   — wallets from step 1 that also minted an NFT for this universe
  //
  // Queries are bounded by `daysAgo` (default 90) to keep Firestore usage
  // predictable for creators with heavy traffic.
  getFunnel: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        daysAgo: z.number().min(1).max(365).default(90),
      })
    )
    .query(async ({ input, ctx }) => {
      if (!db) throw new Error('Firebase is not configured');

      // Authorise: only the creator can see funnels.
      const universeDoc = await db.collection('cinematicUniverses').doc(input.universeId).get();
      if (universeDoc.exists) {
        const udata = universeDoc.data();
        if (
          udata?.creatorUid !== ctx.user.uid &&
          udata?.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the universe creator can view funnel analytics',
          });
        }
      }

      const since = new Date(Date.now() - input.daysAgo * 24 * 60 * 60 * 1000);

      // Stage 1 + 2: views and engagement for this universe in range
      const [viewsSnap, engagementSnap, episodesSnap] = await Promise.all([
        viewsCol().where('universeId', '==', input.universeId).where('viewedAt', '>=', since).get(),
        engagementCol()
          .where('universeId', '==', input.universeId)
          .where('createdAt', '>=', since)
          .get(),
        db.collection('episodes').where('universeId', '==', input.universeId).get(),
      ]);

      const viewedWallets = new Set<string>();
      for (const doc of viewsSnap.docs) {
        const addr = (doc.data().viewerAddress as string | undefined)?.toLowerCase();
        if (addr) viewedWallets.add(addr);
      }

      const engagedWallets = new Set<string>();
      for (const doc of engagementSnap.docs) {
        const addr = (doc.data().userAddress as string | undefined)?.toLowerCase();
        if (addr) engagedWallets.add(addr);
      }

      // Stage 3: mints. episode IDs for this universe → nftMints lookup.
      // Firestore `in` is limited to 30 values; chunk the episode ids.
      const episodeIds = episodesSnap.docs.map((d) => d.id);
      const mintedWallets = new Set<string>();
      if (episodeIds.length > 0) {
        const nftMints = db.collection('nftMints');
        for (let i = 0; i < episodeIds.length; i += 30) {
          const chunk = episodeIds.slice(i, i + 30);
          const mintsSnap = await nftMints
            .where('episodeId', 'in', chunk)
            .where('mintedAt', '>=', since)
            .get();
          for (const doc of mintsSnap.docs) {
            const addr = (doc.data().buyerAddress as string | undefined)?.toLowerCase();
            if (addr) mintedWallets.add(addr);
          }
        }
      }

      // Intersections with viewedWallets (true funnel progression)
      const engagedFromViewed = new Set<string>();
      for (const w of engagedWallets) if (viewedWallets.has(w)) engagedFromViewed.add(w);

      const mintedFromEngaged = new Set<string>();
      for (const w of mintedWallets) if (engagedFromViewed.has(w)) mintedFromEngaged.add(w);

      const viewed = viewedWallets.size;
      const engaged = engagedFromViewed.size;
      const minted = mintedFromEngaged.size;

      return {
        daysAgo: input.daysAgo,
        since: since.toISOString(),
        stages: [
          {
            key: 'viewed',
            label: 'Viewed',
            count: viewed,
            conversionFromPrev: null as number | null,
          },
          {
            key: 'engaged',
            label: 'Engaged',
            count: engaged,
            conversionFromPrev: viewed > 0 ? engaged / viewed : null,
          },
          {
            key: 'minted',
            label: 'Minted',
            count: minted,
            conversionFromPrev: engaged > 0 ? minted / engaged : null,
          },
        ],
        // Raw counts for extra context
        rawViewedWallets: viewed,
        rawEngagedWallets: engagedWallets.size,
        rawMintedWallets: mintedWallets.size,
      };
    }),

  // ---- Cohort Retention ----
  //
  // Group wallets by ISO week of first view, then track how many wallets
  // come back in each subsequent week. Output is a Mon-aligned weekly matrix
  // capped at `weeks` (default 6). A viewer "returned" in week N+k if they
  // recorded any view event in that week.
  getCohorts: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        weeks: z.number().min(2).max(12).default(6),
      })
    )
    .query(async ({ input, ctx }) => {
      if (!db) throw new Error('Firebase is not configured');

      const universeDoc = await db.collection('cinematicUniverses').doc(input.universeId).get();
      if (universeDoc.exists) {
        const udata = universeDoc.data();
        if (
          udata?.creatorUid !== ctx.user.uid &&
          udata?.creator?.toLowerCase() !== ctx.user.address?.toLowerCase()
        ) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the universe creator can view cohort analytics',
          });
        }
      }

      const now = new Date();
      const since = new Date(now.getTime() - input.weeks * 7 * 24 * 60 * 60 * 1000);

      const viewsSnap = await viewsCol()
        .where('universeId', '==', input.universeId)
        .where('viewedAt', '>=', since)
        .orderBy('viewedAt', 'asc')
        .get();

      // weekStart(Date) → Monday 00:00 UTC of that week, as epoch ms
      function weekStart(d: Date): number {
        const day = d.getUTCDay(); // 0=Sun..6=Sat
        const mondayOffset = (day + 6) % 7; // days since Monday
        const mondayUtc = Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate() - mondayOffset
        );
        return mondayUtc;
      }
      function weekLabel(ms: number): string {
        const d = new Date(ms);
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      }

      // wallet → sorted array of distinct week starts they had activity in
      const walletWeeks = new Map<string, Set<number>>();
      for (const doc of viewsSnap.docs) {
        const data = doc.data();
        const addr = (data.viewerAddress as string | undefined)?.toLowerCase();
        if (!addr) continue;
        const viewedAt: Date | undefined = data.viewedAt?.toDate?.() ?? data.viewedAt;
        if (!viewedAt) continue;
        const ws = weekStart(viewedAt instanceof Date ? viewedAt : new Date(viewedAt));
        if (!walletWeeks.has(addr)) walletWeeks.set(addr, new Set());
        walletWeeks.get(addr)!.add(ws);
      }

      // Build cohorts keyed by wallet's first-seen week
      const cohorts = new Map<
        number,
        { wallets: Set<string>; retention: Map<number, Set<string>> }
      >();
      for (const [addr, weekSet] of walletWeeks) {
        const sorted = [...weekSet].sort((a, b) => a - b);
        const firstWeek = sorted[0];
        if (!cohorts.has(firstWeek)) {
          cohorts.set(firstWeek, { wallets: new Set(), retention: new Map() });
        }
        const cohort = cohorts.get(firstWeek)!;
        cohort.wallets.add(addr);
        for (const w of sorted) {
          const offset = Math.round((w - firstWeek) / (7 * 24 * 60 * 60 * 1000));
          if (offset < input.weeks) {
            if (!cohort.retention.has(offset)) cohort.retention.set(offset, new Set());
            cohort.retention.get(offset)!.add(addr);
          }
        }
      }

      const sortedCohorts = [...cohorts.entries()].sort((a, b) => a[0] - b[0]);
      const results = sortedCohorts.map(([weekMs, data]) => {
        const size = data.wallets.size;
        const retention: { weekOffset: number; count: number; rate: number }[] = [];
        for (let i = 0; i < input.weeks; i++) {
          const count = data.retention.get(i)?.size ?? 0;
          retention.push({
            weekOffset: i,
            count,
            rate: size > 0 ? count / size : 0,
          });
        }
        return {
          cohortWeek: weekLabel(weekMs),
          size,
          retention,
        };
      });

      return {
        weeks: input.weeks,
        since: since.toISOString(),
        cohorts: results,
      };
    }),

  // ---- Platform-wide Stats ----

  getPlatformStats: publicProcedure.query(async () => {
    const snapshot = await analyticsCol().limit(1000).get();

    let totalViews = 0;
    let totalMints = 0;
    let totalRevenue = BigInt(0);
    const universeCount = snapshot.size;

    snapshot.docs.forEach((d) => {
      const data = d.data();
      totalViews += data.totalViews || 0;
      totalMints += data.totalMints || 0;
      totalRevenue += BigInt(data.totalRevenue || '0');
    });

    return {
      universeCount,
      totalViews,
      totalMints,
      totalRevenue: totalRevenue.toString(),
    };
  }),
});
