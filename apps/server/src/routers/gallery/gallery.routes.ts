/**
 * Gallery Router — Artist discovery, content browsing, commissions.
 *
 * Aggregates content, profiles, and licensing data into a browsable
 * gallery experience. Supports universe-scoped and global views.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { isUniverseAdmin } from '../../lib/safe-admin';

const contentCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('content');
};
const featuredCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('galleryFeatured');
};
const commissionsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('commissionRequests');
};
const profilesCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('profiles');
};
const registrationsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('contentRegistrations');
};

const mediaTypeEnum = z.enum(['video', 'image', 'audio', '3d', 'all']).default('all');
const sortByEnum = z.enum(['newest', 'trending', 'price_asc', 'price_desc']).default('newest');

export const galleryRouter = router({
  /** Browse content with filters */
  browse: publicProcedure
    .input(
      z.object({
        universeId: z.string().optional(),
        creatorUid: z.string().optional(),
        mediaType: mediaTypeEnum,
        sortBy: sortByEnum,
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query: FirebaseFirestore.Query = contentCol().where('visibility', '==', 'public');

      if (input.universeId) {
        query = query.where('universeId', '==', input.universeId);
      }
      if (input.creatorUid) {
        query = query.where('creatorUid', '==', input.creatorUid);
      }
      if (input.mediaType !== 'all') {
        // Match both raw types (video/image) and AI-generated variants (ai-video/ai-image)
        const typeVariants =
          input.mediaType === 'video'
            ? ['video', 'ai-video']
            : input.mediaType === 'image'
              ? ['image', 'ai-image']
              : [input.mediaType];
        query = query.where('mediaType', 'in', typeVariants);
      }

      // Sorting
      switch (input.sortBy) {
        case 'trending':
          query = query.orderBy('views', 'desc');
          break;
        case 'newest':
        default:
          query = query.orderBy('createdAt', 'desc');
          break;
      }

      if (input.cursor) {
        const cursorDoc = await contentCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.limit(input.limit).get();

      const items = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      // Enrich with licensing data if available
      const contentHashes = items.map((i: any) => i.contentHash).filter(Boolean);

      const licensingMap: Record<string, any> = {};
      if (contentHashes.length > 0) {
        // Firestore `in` queries support up to 30 values
        const chunks = [];
        for (let i = 0; i < contentHashes.length; i += 30) {
          chunks.push(contentHashes.slice(i, i + 30));
        }
        for (const chunk of chunks) {
          const regSnapshot = await registrationsCol()
            .where('contentHash', 'in', chunk)
            .where('active', '==', true)
            .get();
          for (const doc of regSnapshot.docs) {
            const data = doc.data();
            licensingMap[data.contentHash] = {
              buyPrice: data.buyPrice,
              rentPricePerDay: data.rentPricePerDay,
              licenseFee: data.licenseFee,
              registrationId: doc.id,
            };
          }
        }
      }

      return {
        items: items.map((item: any) => ({
          ...item,
          licensing: licensingMap[item.contentHash] || null,
        })),
        nextCursor:
          snapshot.docs.length === input.limit ? snapshot.docs[snapshot.docs.length - 1].id : null,
      };
    }),

  /** Get trending content (most viewed in recent period) */
  trending: publicProcedure
    .input(
      z.object({
        universeId: z.string().optional(),
        limit: z.number().int().min(1).max(20).default(10),
      })
    )
    .query(async ({ input }) => {
      let query: FirebaseFirestore.Query = contentCol().where('visibility', '==', 'public');

      if (input.universeId) {
        query = query.where('universeId', '==', input.universeId);
      }

      const snapshot = await query.orderBy('views', 'desc').limit(input.limit).get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /** Get admin-curated featured content for a universe */
  featured: publicProcedure.input(z.object({ universeId: z.string() })).query(async ({ input }) => {
    const now = new Date();
    const snapshot = await featuredCol()
      .where('universeId', '==', input.universeId)
      .orderBy('position', 'asc')
      .get();

    // Filter out expired features
    const active = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((f: any) => !f.expiresAt || f.expiresAt.toDate() > now);

    // Fetch the actual content docs
    const contentIds = active.map((f: any) => f.contentId);
    if (contentIds.length === 0) return [];

    const contentDocs = await Promise.all(
      contentIds.map((id: string) => contentCol().doc(id).get())
    );

    return contentDocs.filter((d) => d.exists).map((d) => ({ id: d.id, ...d.data() }));
  }),

  /** Set featured content for a universe (admin only) */
  setFeatured: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        contentIds: z.array(z.string()).max(10),
        expiresAt: z.date().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const isAdmin = await isUniverseAdmin(input.universeId, ctx.user.uid);
      if (!isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe admin can set featured content',
        });
      }

      // Clear existing featured for this universe
      const existing = await featuredCol().where('universeId', '==', input.universeId).get();

      const batch = db!.batch();
      existing.docs.forEach((d) => batch.delete(d.ref));

      // Add new featured entries
      input.contentIds.forEach((contentId, index) => {
        const ref = featuredCol().doc();
        batch.set(ref, {
          universeId: input.universeId,
          contentId,
          featuredBy: ctx.user.uid,
          position: index,
          expiresAt: input.expiresAt || null,
          featuredAt: new Date(),
        });
      });

      await batch.commit();
      return { ok: true, count: input.contentIds.length };
    }),

  /** Get a creator's portfolio — all public content with stats */
  creatorPortfolio: publicProcedure
    .input(
      z.object({
        creatorUid: z.string(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input }) => {
      // Fetch profile
      const profileDoc = await profilesCol().doc(input.creatorUid).get();
      const profile = profileDoc.exists ? { id: profileDoc.id, ...profileDoc.data() } : null;

      // Fetch content
      const contentSnapshot = await contentCol()
        .where('creatorUid', '==', input.creatorUid)
        .where('visibility', '==', 'public')
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      const content = contentSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Aggregate stats
      let totalViews = 0;
      let totalLikes = 0;
      content.forEach((c: any) => {
        totalViews += c.views || 0;
        totalLikes += c.likes || 0;
      });

      return {
        profile,
        content,
        stats: {
          totalContent: contentSnapshot.size,
          totalViews,
          totalLikes,
        },
      };
    }),

  // ── Commissions ──────────────────────────────────────────────────────

  /** Send a commission request to an artist */
  requestCommission: protectedProcedure
    .input(
      z.object({
        toUid: z.string(),
        message: z.string().min(10).max(2000),
        mediaType: z.string(),
        budget: z.string().optional(),
        universeId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (input.toUid === ctx.user.uid) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot commission yourself' });
      }

      const commission = {
        fromUid: ctx.user.uid,
        fromAddress: ctx.user.address || null,
        toUid: input.toUid,
        message: input.message,
        mediaType: input.mediaType,
        budget: input.budget || null,
        universeId: input.universeId || null,
        status: 'PENDING' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ref = await commissionsCol().add(commission);
      return { id: ref.id, ...commission };
    }),

  /** Get received and sent commission requests */
  myCommissions: protectedProcedure
    .input(
      z.object({
        direction: z.enum(['received', 'sent']).default('received'),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      const field = input.direction === 'received' ? 'toUid' : 'fromUid';
      const snapshot = await commissionsCol()
        .where(field, '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /** Accept or decline a commission request */
  respondToCommission: protectedProcedure
    .input(
      z.object({
        commissionId: z.string(),
        accept: z.boolean(),
        responseMessage: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ref = commissionsCol().doc(input.commissionId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Commission not found' });

      const data = doc.data()!;
      if (data.toUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the commission recipient' });
      }
      if (data.status !== 'PENDING') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Commission already responded to' });
      }

      await ref.update({
        status: input.accept ? 'ACCEPTED' : 'DECLINED',
        responseMessage: input.responseMessage || null,
        respondedAt: new Date(),
        updatedAt: new Date(),
      });

      return { ok: true, status: input.accept ? 'ACCEPTED' : 'DECLINED' };
    }),
});
