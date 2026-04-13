/**
 * Analytics Router — Engagement tracking and data insights
 * Records views, mints, trending data. Valuable for AI training and studios.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { db } from '../../lib/firebase';
import { z } from 'zod';

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

  getRecentActivity: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input }) => {
      const snapshot = await viewsCol().orderBy('viewedAt', 'desc').limit(input.limit).get();

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

  // ---- Platform-wide Stats ----

  getPlatformStats: publicProcedure.query(async () => {
    const snapshot = await analyticsCol().get();

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
