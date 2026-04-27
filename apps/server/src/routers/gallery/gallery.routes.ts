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
import { getExcludedUniverseIds } from '../universes/universes.handlers';

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

// PRD 10 moderation gate. Any read that returns content to the public must
// filter these statuses. Undefined/legacy docs pass through (treated as active).
const HIDDEN_STATUSES = ['flagged', 'under_review', 'hidden', 'removed'] as const;
const isVisible = (status: unknown): boolean =>
  !status || !HIDDEN_STATUSES.includes(status as (typeof HIDDEN_STATUSES)[number]);

/**
 * Single DTO shape for every public read of a gallery content doc. Keeps
 * browse / trending / featured / portfolio shaped identically so the client
 * can assume lineage + classification + moderation fields everywhere.
 */
function serializeGalleryItem(
  d: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
) {
  const data = d.data() ?? {};
  return {
    id: d.id,
    title: data.title || 'Untitled',
    description: data.description || '',
    mediaUrl: data.mediaUrl || null,
    thumbnailUrl: data.thumbnailUrl || null,
    mediaType: data.mediaType || 'image',
    classification: data.classification || 'original',
    tags: data.tags || [],
    creatorUid: data.creatorUid || null,
    creatorAddress: data.creatorAddress || null,
    universeId: data.universeId || null,
    contentHash: data.contentHash || null,
    generationId: data.generationId || null,
    generationModel: data.generationModel || null,
    views: data.views || 0,
    likes: data.likes || 0,
    visibility: data.visibility || 'public',
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? null,
    // Lineage refs — clients render "derived from" links / family tree.
    parentGenerationId: data.parentGenerationId || null,
    sourceImageUrl: data.sourceImageUrl || null,
    sourceVideoGenerationId: data.sourceVideoGenerationId || null,
    sourceAudioGenerationId: data.sourceAudioGenerationId || null,
  };
}

export const galleryRouter = router({
  /** Browse content with filters */
  browse: publicProcedure
    .input(
      z.object({
        universeId: z.string().optional(),
        creatorUid: z.string().optional(),
        mediaType: mediaTypeEnum,
        origin: z.enum(['all', 'generated', 'uploaded']).default('all'),
        sortBy: sortByEnum,
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input, ctx }) => {
      const excluded = await getExcludedUniverseIds({ viewerAddress: ctx.user?.address });

      // Scoped browse into a single universe that's private/hidden (and the
      // viewer isn't the owner) returns nothing — never leak universe content.
      if (input.universeId && excluded.has(input.universeId.toLowerCase())) {
        return { items: [], nextCursor: null };
      }

      let query: FirebaseFirestore.Query = contentCol().where('visibility', '==', 'public');

      if (input.universeId) {
        query = query.where('universeId', '==', input.universeId);
      }
      if (input.creatorUid) {
        query = query.where('creatorUid', '==', input.creatorUid);
      }

      // Compute final mediaType filter by intersecting mediaType + origin filters.
      // Both affect the same Firestore field, so we combine them into one `in` clause.
      const allTypes = ['video', 'ai-video', 'image', 'ai-image', 'audio', '3d'];
      let allowedByMedia: string[];
      if (input.mediaType === 'all') {
        allowedByMedia = allTypes;
      } else if (input.mediaType === 'video') {
        allowedByMedia = ['video', 'ai-video'];
      } else if (input.mediaType === 'image') {
        allowedByMedia = ['image', 'ai-image'];
      } else {
        allowedByMedia = [input.mediaType];
      }

      // All 3D in the gallery is AI-generated today — content.routes.ts only
      // accepts image/video uploads, and every `publishToGallery({mediaType:'3d'})`
      // call site is a Meshy-backed generator (threed.routes, character-pipeline).
      // So '3d' lives in the `generated` bucket, not `uploaded`.
      let allowedByOrigin: string[];
      if (input.origin === 'generated') {
        allowedByOrigin = ['ai-video', 'ai-image', '3d'];
      } else if (input.origin === 'uploaded') {
        allowedByOrigin = ['video', 'image', 'audio'];
      } else {
        allowedByOrigin = allTypes;
      }

      const finalTypes = allowedByMedia.filter((t) => allowedByOrigin.includes(t));
      if (finalTypes.length === 0) {
        return { items: [], nextCursor: null };
      }
      // Only apply filter if not matching all types (avoids unnecessary in clause)
      if (finalTypes.length < allTypes.length) {
        query = query.where('mediaType', 'in', finalTypes);
      }

      // Sorting — always tiebreak on __name__ so cursor pagination is stable
      // even when two docs share a sort value (same createdAt or views).
      // Without the tiebreaker, startAfter(cursorDoc) can duplicate or skip
      // items once a filter changes between pages.
      switch (input.sortBy) {
        case 'trending':
          query = query.orderBy('views', 'desc').orderBy('__name__', 'desc');
          break;
        case 'newest':
        default:
          query = query.orderBy('createdAt', 'desc').orderBy('__name__', 'desc');
          break;
      }

      if (input.cursor) {
        const cursorDoc = await contentCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.limit(input.limit).get();

      const items = snapshot.docs
        .filter((d) => {
          const data = d.data();
          if (!isVisible(data.contentStatus)) return false;
          const uniId = (data.universeId as string | undefined)?.toLowerCase();
          if (uniId && excluded.has(uniId)) return false;
          return true;
        })
        .map(serializeGalleryItem);

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
    .query(async ({ input, ctx }) => {
      const excluded = await getExcludedUniverseIds({ viewerAddress: ctx.user?.address });

      if (input.universeId && excluded.has(input.universeId.toLowerCase())) {
        return [];
      }

      let query: FirebaseFirestore.Query = contentCol().where('visibility', '==', 'public');

      if (input.universeId) {
        query = query.where('universeId', '==', input.universeId);
      }

      const snapshot = await query.orderBy('views', 'desc').limit(input.limit).get();

      return snapshot.docs
        .filter((d) => {
          const data = d.data();
          if (!isVisible(data.contentStatus)) return false;
          const uniId = (data.universeId as string | undefined)?.toLowerCase();
          if (uniId && excluded.has(uniId)) return false;
          return true;
        })
        .map(serializeGalleryItem);
    }),

  /**
   * Get the lineage neighborhood for a single content doc:
   *   - `parent`: the one content doc this was derived from, if any
   *   - `derivatives`: content docs that list this one as their parent
   *
   * Lives on the public gallery router because the detail view needs it for
   * any visitor, not just the creator. Moderated content is filtered out of
   * the response on both sides so hidden/removed items never surface via the
   * family tree.
   */
  lineage: publicProcedure
    .input(
      z.object({
        contentId: z.string().min(1),
        derivativeLimit: z.number().int().min(1).max(20).default(12),
      })
    )
    .query(async ({ input, ctx }) => {
      const rootDoc = await contentCol().doc(input.contentId).get();
      if (!rootDoc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Content not found' });
      }
      const root = rootDoc.data()!;

      const excluded = await getExcludedUniverseIds({ viewerAddress: ctx.user?.address });
      const rootUniverseId = (root.universeId as string | undefined)?.toLowerCase();
      // Don't resolve lineage rooted in a private/hidden universe for non-owners.
      if (rootUniverseId && excluded.has(rootUniverseId)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Content not found' });
      }

      const isContentVisible = (data: FirebaseFirestore.DocumentData): boolean => {
        if (!isVisible(data.contentStatus)) return false;
        const uniId = (data.universeId as string | undefined)?.toLowerCase();
        if (uniId && excluded.has(uniId)) return false;
        return true;
      };

      let parent: ReturnType<typeof serializeGalleryItem> | null = null;
      const parentGenId: string | undefined = root.parentGenerationId;
      if (parentGenId) {
        const parentSnap = await contentCol()
          .where('generationId', '==', parentGenId)
          .limit(1)
          .get();
        const parentDoc = parentSnap.docs[0];
        if (parentDoc && isContentVisible(parentDoc.data())) {
          parent = serializeGalleryItem(parentDoc);
        }
      }

      // Derivatives = docs whose parentGenerationId points at this content's
      // generationId. The unique field is generationId, not the content doc id.
      let derivatives: ReturnType<typeof serializeGalleryItem>[] = [];
      const rootGenId: string | undefined = root.generationId;
      if (rootGenId) {
        const derivSnap = await contentCol()
          .where('parentGenerationId', '==', rootGenId)
          .orderBy('createdAt', 'desc')
          .limit(input.derivativeLimit)
          .get();
        derivatives = derivSnap.docs
          .filter((d) => isContentVisible(d.data()))
          .map(serializeGalleryItem);
      }

      return { parent, derivatives };
    }),

  /** Get admin-curated featured content for a universe */
  featured: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input, ctx }) => {
      const excluded = await getExcludedUniverseIds({ viewerAddress: ctx.user?.address });
      if (excluded.has(input.universeId.toLowerCase())) return [];

      const now = new Date();
      const snapshot = await featuredCol()
        .where('universeId', '==', input.universeId)
        .orderBy('position', 'asc')
        .get();

      // Filter out expired features
      const active = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((f: any) => !f.expiresAt || f.expiresAt.toDate() > now);

      // Fetch the actual content docs in one batched getAll() to avoid the
      // N+1 Firestore reads the per-id Promise.all was doing.
      const contentIds = active.map((f: any) => f.contentId);
      if (contentIds.length === 0) return [];

      const refs = contentIds.map((id: string) => contentCol().doc(id));
      const contentDocs = await db!.getAll(...refs);

      return contentDocs
        .filter((d) => d.exists && isVisible(d.data()?.contentStatus))
        .map(serializeGalleryItem);
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
    .query(async ({ input, ctx }) => {
      const excluded = await getExcludedUniverseIds({ viewerAddress: ctx.user?.address });

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

      const content = contentSnapshot.docs
        .filter((d) => {
          const data = d.data();
          if (!isVisible(data.contentStatus)) return false;
          const uniId = (data.universeId as string | undefined)?.toLowerCase();
          if (uniId && excluded.has(uniId)) return false;
          return true;
        })
        .map(serializeGalleryItem);

      // Aggregate stats — across the visible set only, so hidden content
      // doesn't inflate a creator's public view/like counts.
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
          totalContent: content.length,
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

  /**
   * Claim an orphan content doc (one without a universeId) into a universe
   * the caller admins. First-come-first-served; once claimed the content
   * is scoped to that universe and won't re-appear to other claimers.
   */
  claimOrphan: protectedProcedure
    .input(
      z.object({
        contentId: z.string().min(1),
        universeId: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const address = ctx.user.address;
      if (!address) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Wallet address required' });
      }

      const isAdmin = await isUniverseAdmin(input.universeId, address);
      if (!isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You can only claim content into a universe you admin',
        });
      }

      const ref = contentCol().doc(input.contentId);
      const doc = await ref.get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Content not found' });
      }

      const data = doc.data()!;
      if (data.universeId) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This content already belongs to a universe',
        });
      }

      // Only AI-generated outputs are swappable into a universe. Uploads
      // belong to whoever uploaded them and should not be retargeted — we
      // identify AI-gen by the `ai-` mediaType prefix written by every
      // generation route (e.g. `ai-video`, `ai-image`).
      const mediaType = data.mediaType as string | undefined;
      if (!mediaType?.startsWith('ai-')) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only AI-generated content can be claimed to a universe',
        });
      }

      // Can't resurrect moderated content into a universe.
      if (!isVisible(data.contentStatus)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This content has been moderated and cannot be claimed',
        });
      }

      // Orphan claims must be made by the original creator — otherwise a universe
      // admin could siphon any un-tagged content (e.g. legacy videos produced
      // before universe scoping) into their own universe.
      const creatorUid = data.creatorUid ?? data.createdBy ?? null;
      if (creatorUid && creatorUid !== ctx.user.uid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the original creator can claim this content',
        });
      }

      await ref.update({
        universeId: input.universeId,
        claimedBy: ctx.user.uid,
        claimedByAddress: address,
        claimedAt: new Date(),
        updatedAt: new Date(),
      });

      return { ok: true, universeId: input.universeId };
    }),
});
