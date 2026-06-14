/**
 * Feed Router
 *
 * Personalized "For You" recommendation feed and global trending.
 * Uses pre-computed content signals weighted by user preferences.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, adminProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';

const preferencesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userPreferences');
};

const signalsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('contentSignals');
};

const contentCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('content');
};

const HIDDEN_STATUSES = ['flagged', 'under_review', 'hidden', 'removed'];

/**
 * Signal docs only carry trending metadata (score, views, genres) — no media
 * URLs or title. Join each signal with its content doc so the feed can render
 * thumbnails, and drop items whose content is missing or moderated.
 */
async function enrichWithContent(signals: any[]): Promise<any[]> {
  if (signals.length === 0) return [];

  const refs = signals.map((s) => contentCol().doc(s.contentId || s.id));
  const contentDocs = await db!.getAll(...refs);
  const byId = new Map(contentDocs.map((d) => [d.id, d]));

  const enriched: any[] = [];
  for (const signal of signals) {
    const contentId = signal.contentId || signal.id;
    const doc = byId.get(contentId);
    if (!doc?.exists) continue;

    const data = doc.data()!;
    if (data.visibility && data.visibility !== 'public') continue;
    if (data.contentStatus && HIDDEN_STATUSES.includes(data.contentStatus)) continue;

    enriched.push({
      ...signal,
      title: data.title || null,
      description: data.description || null,
      mediaUrl: data.mediaUrl || null,
      thumbnailUrl: data.thumbnailUrl || null,
      mediaType: data.mediaType || null,
      format: data.format || null,
      classification: data.classification || null,
      creatorUid: data.creatorUid || signal.creatorUid || null,
      universeId: data.universeId ?? signal.universeId ?? null,
      views: data.views ?? signal.totalViews ?? 0,
    });
  }
  return enriched;
}

export const feedRouter = router({
  /** Get personalized "For You" feed */
  getForYou: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get user preferences
      const prefDoc = await preferencesCol().doc(ctx.user.uid).get();
      const prefs = prefDoc.exists ? prefDoc.data() : null;

      // Get top content by trending score
      let query = signalsCol()
        .orderBy('trendingScore', 'desc')
        .limit(input.limit * 2); // fetch extra for re-ranking

      if (input.cursor) {
        const cursorDoc = await signalsCol().doc(input.cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      let items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as any[];

      // Apply personalization weights if preferences exist
      if (prefs) {
        const genreWeights = (prefs.genreWeights || {}) as Record<string, number>;
        const creatorWeights = (prefs.creatorWeights || {}) as Record<string, number>;

        items = items.map((item) => {
          let score = item.trendingScore || 0;

          // Genre match boost
          const genres = (item.genres || []) as string[];
          for (const genre of genres) {
            score += (genreWeights[genre] || 0) * 2;
          }

          // Creator follow boost
          if (creatorWeights[item.creatorUid]) {
            score += creatorWeights[item.creatorUid] * 3;
          }

          // Recency decay (items older than 7 days lose score)
          const ageMs = Date.now() - (item.updatedAt?._seconds || 0) * 1000;
          const ageDays = ageMs / (1000 * 60 * 60 * 24);
          if (ageDays > 7) {
            score *= Math.max(0.3, 1 - ageDays / 30);
          }

          return { ...item, personalScore: score };
        });

        // Re-sort by personalized score
        items.sort((a, b) => b.personalScore - a.personalScore);
      }

      // Take limit
      items = items.slice(0, input.limit);

      // Join with content docs for media URLs/title (signals lack them)
      items = await enrichWithContent(items);

      return {
        items,
        nextCursor:
          snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1]?.id : undefined,
      };
    }),

  /** Get global trending feed (no personalization) */
  getGlobalTrending: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = signalsCol().orderBy('trendingScore', 'desc').limit(input.limit);

      if (input.cursor) {
        const cursorDoc = await signalsCol().doc(input.cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      const signals = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as any[];

      // Signals only store trending metadata (no media URLs). Join with the
      // content collection so trending cards can actually render thumbnails.
      let items = await enrichWithContent(signals);

      // Fallback: contentSignals is admin-rebuilt and may be empty/stale. If we
      // have nothing to show (and aren't paginating), surface recent public
      // content directly so discovery is never blank.
      if (items.length === 0 && !input.cursor) {
        const recent = await contentCol()
          .where('visibility', '==', 'public')
          .orderBy('createdAt', 'desc')
          .limit(input.limit * 3)
          .get();
        items = recent.docs
          .map((doc) => ({ id: doc.id, contentId: doc.id, ...doc.data() }))
          .filter((d: any) => !d.contentStatus || !HIDDEN_STATUSES.includes(d.contentStatus))
          .filter((d: any) => d.mediaUrl || d.thumbnailUrl)
          .slice(0, input.limit)
          .map((d: any) => ({
            id: d.id,
            contentId: d.contentId,
            title: d.title || null,
            description: d.description || null,
            mediaUrl: d.mediaUrl || null,
            thumbnailUrl: d.thumbnailUrl || null,
            mediaType: d.mediaType || null,
            universeId: d.universeId ?? null,
            creatorUid: d.creatorUid || null,
            views: d.views ?? 0,
            totalViews: d.views ?? 0,
          }));

        return { items, nextCursor: undefined };
      }

      return {
        items,
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  /** Record user interaction for preference learning */
  recordInteraction: protectedProcedure
    .input(
      z.object({
        contentId: z.string(),
        type: z.enum(['view', 'like', 'share', 'bookmark', 'mint']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get the content to extract genres and creator
      const contentDoc = await contentCol().doc(input.contentId).get();
      if (!contentDoc.exists) return { ok: true };

      const content = contentDoc.data()!;
      const prefRef = preferencesCol().doc(ctx.user.uid);
      const prefDoc = await prefRef.get();

      const weights: Record<string, number> = {
        view: 1,
        like: 3,
        share: 5,
        bookmark: 4,
        mint: 10,
      };
      const weight = weights[input.type] || 1;

      if (prefDoc.exists) {
        const prefs = prefDoc.data()!;
        const genreWeights = { ...(prefs.genreWeights || {}) };
        const creatorWeights = { ...(prefs.creatorWeights || {}) };

        // Boost genre weights
        for (const tag of content.tags || []) {
          genreWeights[tag] = (genreWeights[tag] || 0) + weight;
        }

        // Boost creator weight
        if (content.creatorUid) {
          creatorWeights[content.creatorUid] = (creatorWeights[content.creatorUid] || 0) + weight;
        }

        await prefRef.update({
          genreWeights,
          creatorWeights,
          updatedAt: new Date(),
        });
      } else {
        const genreWeights: Record<string, number> = {};
        for (const tag of content.tags || []) {
          genreWeights[tag] = weight;
        }

        await prefRef.set({
          genreWeights,
          creatorWeights: content.creatorUid ? { [content.creatorUid]: weight } : {},
          updatedAt: new Date(),
        });
      }

      return { ok: true };
    }),

  /** Admin: Rebuild content signals from analytics */
  rebuildSignals: adminProcedure.mutation(async () => {
    const contentSnap = await contentCol().where('visibility', '==', 'public').limit(1000).get();

    const batch = db!.batch();
    for (const doc of contentSnap.docs) {
      const data = doc.data();
      const signalRef = signalsCol().doc(doc.id);

      batch.set(
        signalRef,
        {
          contentId: doc.id,
          universeId: data.universeId || null,
          creatorUid: data.creatorUid,
          genres: data.tags || [],
          totalViews: data.views || 0,
          totalEngagement: (data.likes || 0) + (data.shares || 0),
          trendingScore: (data.views || 0) * 0.3 + (data.likes || 0) * 2 + (data.shares || 0) * 5,
          updatedAt: new Date(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    return { ok: true, processed: contentSnap.size };
  }),
});
