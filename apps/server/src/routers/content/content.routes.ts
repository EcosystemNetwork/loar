/**
 * Content Router
 *
 * Manages user-created content (videos, images) with three-lane rights classification:
 * - "fan": Non-commercial / derivative. May use third-party IP. Cannot be monetized.
 * - "original": Creator-owned. Must be the creator's original work. Eligible for all revenue flows.
 * - "licensed": Used under a licensing grant. Requires `licensingProof` and `reviewStatus`.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { triggerContentThumbnailAsync } from '../../services/content-cover-image';
import { recordAssetEventAsync } from '../../services/lineage';
import type { AssetOutputKind } from '../../services/lineage/types';

const contentCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('content');
};
const profilesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('profiles');
};

const contentClassification = z.enum(['fan', 'original', 'licensed']);

const ipDeclarationSchema = z.object({
  isOriginal: z.boolean(),
  usesCopyrightedMaterial: z.boolean().default(false),
  copyrightNotes: z.string().max(500).optional(),
  license: z
    .enum(['all-rights-reserved', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc0', 'fan-work'])
    .default('all-rights-reserved'),
});

const licensingProofSchema = z.object({
  licensorName: z.string().min(1).max(200),
  licenseType: z.enum(['exclusive', 'non-exclusive', 'sublicense']),
  territory: z.string().max(200),
  termEnd: z.string().optional(),
  approvedUses: z.array(z.string()),
  restrictedUses: z.array(z.string()).default([]),
  royaltySplit: z.number().min(0).max(100),
  documentUrl: z.string().url().optional(),
});

const createContentSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(2000).default(''),
  mediaUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  mediaType: z.enum(['video', 'image', 'ai-video', 'ai-image', 'audio', '3d']),
  format: z.enum(['short', 'long']).optional(),
  classification: contentClassification,
  tags: z.array(z.string().max(30)).max(15).default([]),
  ipDeclaration: ipDeclarationSchema,
  licensingProof: licensingProofSchema.optional(),
  universeId: z.string().optional(),
  visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
  /** PRD 10: lineage parent — the generationId / editJobId this was derived from. */
  sourceGenerationId: z.string().optional(),
});

const updateContentSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  thumbnailUrl: z.string().url().optional(),
  format: z.enum(['short', 'long']).optional(),
  classification: contentClassification.optional(),
  tags: z.array(z.string().max(30)).max(15).optional(),
  ipDeclaration: ipDeclarationSchema.optional(),
  licensingProof: licensingProofSchema.optional(),
  visibility: z.enum(['public', 'private', 'unlisted']).optional(),
});

export const contentRouter = router({
  /** Create a new content item */
  create: protectedProcedure.input(createContentSchema).mutation(async ({ ctx, input }) => {
    // Enforce IP rules for monetized content
    if (input.classification === 'original' || input.classification === 'licensed') {
      if (input.ipDeclaration.usesCopyrightedMaterial) {
        throw new Error(
          'Monetized content cannot use third-party copyrighted material. Switch to "Non-Commercial" or use the Rights-Cleared lane with documentation.'
        );
      }
      if (input.ipDeclaration.license === 'fan-work') {
        throw new Error('Fan works cannot be monetized. Switch to "Non-Commercial".');
      }
      if (!input.ipDeclaration.isOriginal) {
        throw new Error(
          'Monetized content must be original work. Confirm originality or switch to "Non-Commercial".'
        );
      }
    }
    if (input.classification === 'licensed' && !input.licensingProof) {
      throw new Error(
        'Rights-Cleared content requires licensing details. Complete the licensing proof section.'
      );
    }

    const now = new Date();
    const reviewStatus = input.classification === 'licensed' ? 'pending' : 'not_required';
    const contentData = {
      ...input,
      creatorUid: ctx.user.uid,
      createdAt: now,
      updatedAt: now,
      views: 0,
      likes: 0,
      reviewStatus,
    };

    const ref = await contentCol().add(contentData);

    // Increment content count on profile
    const profileRef = profilesCol().doc(ctx.user.uid);
    const profileDoc = await profileRef.get();
    if (profileDoc.exists) {
      await profileRef.update({ contentCount: FieldValue.increment(1) });
    }

    if (!input.thumbnailUrl) {
      triggerContentThumbnailAsync({
        id: ref.id,
        mediaUrl: input.mediaUrl,
        mediaType: input.mediaType,
        creatorUid: ctx.user.uid,
      });
    }

    // PRD 10: publish lineage event.
    const outputKind: AssetOutputKind = input.mediaType.includes('image')
      ? 'image'
      : input.mediaType === 'audio'
        ? 'audio'
        : input.mediaType === '3d'
          ? '3d'
          : 'video';
    recordAssetEventAsync({
      assetId: ref.id,
      parentAssetId: input.sourceGenerationId ?? null,
      kind: 'publish',
      tool: 'publish',
      step: 'publish',
      prompt: input.description || null,
      promptRefs: [],
      creditCost: 0,
      creatorUid: ctx.user.uid,
      creatorAddress: ctx.user.address ?? null,
      universeId: input.universeId ?? null,
      rightsClass: input.classification,
      outputUrl: input.mediaUrl,
      outputKind,
      status: 'completed',
    });

    return { id: ref.id, ...contentData };
  }),

  /** Update an existing content item (owner only) */
  update: protectedProcedure.input(updateContentSchema).mutation(async ({ ctx, input }) => {
    const ref = contentCol().doc(input.id);
    const doc = await ref.get();

    if (!doc.exists) throw new Error('Content not found');
    if (doc.data()!.creatorUid !== ctx.user.uid) throw new Error('Not authorized');

    const existing = doc.data()!;

    // Canon-locked content cannot be edited — changes require governance vote
    if (existing.canonLocked) {
      throw new Error(
        'This content is canon-locked. Changes to canon content require a community governance vote.'
      );
    }

    // Content under moderation review cannot be modified
    const blockedStatuses = ['flagged', 'under_review', 'hidden', 'removed'];
    if (blockedStatuses.includes(existing.contentStatus)) {
      throw new Error('This content cannot be modified while it is under moderation review.');
    }

    // Minted NFT content — media URL is immutable, but metadata can be updated
    if (existing.mintedAsNft && (input.classification || input.ipDeclaration)) {
      // Allow title/description/tags changes but not reclassification
      throw new Error(
        'Minted content cannot change classification or IP declaration. The media is permanently stored on IPFS.'
      );
    }

    const newClassification = input.classification || existing.classification;
    const newIp = input.ipDeclaration || existing.ipDeclaration;

    // Re-validate IP rules if changing to a monetized lane
    if (newClassification === 'original' || newClassification === 'licensed') {
      if (newIp.usesCopyrightedMaterial) {
        throw new Error('Monetized content cannot use copyrighted materials.');
      }
      if (newIp.license === 'fan-work') {
        throw new Error('Fan works cannot be monetized.');
      }
      if (!newIp.isOriginal) {
        throw new Error('Monetized content must be original work.');
      }
    }

    const { id, ...updates } = input;
    await ref.update({ ...updates, updatedAt: new Date() });
    return { ok: true };
  }),

  /** Delete a content item (owner only) */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ref = contentCol().doc(input.id);
      const doc = await ref.get();

      if (!doc.exists) throw new Error('Content not found');
      if (doc.data()!.creatorUid !== ctx.user.uid) throw new Error('Not authorized');

      const data = doc.data()!;
      if (data.canonLocked) {
        throw new Error(
          'Canon-locked content cannot be deleted. It is part of the permanent universe narrative.'
        );
      }
      if (data.mintedAsNft) {
        throw new Error(
          'Minted NFT content cannot be deleted. The media is permanently stored on IPFS.'
        );
      }

      await ref.delete();

      // Decrement content count on profile
      const profileRef = profilesCol().doc(ctx.user.uid);
      const profileDoc = await profileRef.get();
      if (profileDoc.exists) {
        await profileRef.update({ contentCount: FieldValue.increment(-1) });
      }

      return { ok: true };
    }),

  /** Get a single content item by ID */
  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const doc = await contentCol().doc(input.id).get();
    if (!doc.exists) return null;

    const data = doc.data()!;
    // Hide flagged/removed/hidden content from public access
    const status = data.contentStatus || 'active';
    if (status !== 'active' && status !== 'reinstated') return null;

    return {
      id: doc.id,
      title: data.title,
      description: data.description,
      mediaUrl: data.mediaUrl,
      thumbnailUrl: data.thumbnailUrl || null,
      mediaType: data.mediaType,
      classification: data.classification,
      tags: data.tags || [],
      ipDeclaration: data.ipDeclaration,
      creatorUid: data.creatorUid,
      universeId: data.universeId || null,
      visibility: data.visibility,
      views: data.views || 0,
      likes: data.likes || 0,
      createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
    };
  }),

  /** Get content by creator UID (respects visibility) */
  getByCreator: publicProcedure
    .input(
      z.object({
        creatorUid: z.string(),
        classification: contentClassification.optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query: FirebaseFirestore.Query = contentCol()
        .where('creatorUid', '==', input.creatorUid)
        .where('visibility', '==', 'public');

      if (input.classification) {
        query = query.where('classification', '==', input.classification);
      }

      query = query.orderBy('createdAt', 'desc');

      // Cursor-based pagination: start after the cursor document
      if (input.cursor) {
        const cursorDoc = await contentCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      // Fetch one extra to determine hasMore
      const snapshot = await query.limit(input.limit + 1).get();
      const docs = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          description: data.description,
          mediaUrl: data.mediaUrl,
          thumbnailUrl: data.thumbnailUrl || null,
          mediaType: data.mediaType,
          classification: data.classification,
          tags: data.tags || [],
          views: data.views || 0,
          likes: data.likes || 0,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        };
      });

      const hasMore = docs.length > input.limit;

      return {
        items: docs.slice(0, input.limit),
        nextCursor: hasMore ? docs[input.limit - 1]?.id : null,
      };
    }),

  /** Get the current user's own content (all visibilities) */
  myContent: protectedProcedure
    .input(
      z.object({
        classification: contentClassification.optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      let query: FirebaseFirestore.Query = contentCol().where('creatorUid', '==', ctx.user.uid);

      if (input.classification) {
        query = query.where('classification', '==', input.classification);
      }

      query = query.orderBy('createdAt', 'desc');

      // Cursor-based pagination: start after the cursor document
      if (input.cursor) {
        const cursorDoc = await contentCol().doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      // Fetch one extra to determine hasMore
      const snapshot = await query.limit(input.limit + 1).get();
      const docs = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title,
          description: data.description,
          mediaUrl: data.mediaUrl,
          thumbnailUrl: data.thumbnailUrl || null,
          mediaType: data.mediaType,
          classification: data.classification,
          tags: data.tags || [],
          ipDeclaration: data.ipDeclaration,
          visibility: data.visibility,
          views: data.views || 0,
          likes: data.likes || 0,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        };
      });

      const hasMore = docs.length > input.limit;

      return {
        items: docs.slice(0, input.limit),
        nextCursor: hasMore ? docs[input.limit - 1]?.id : null,
      };
    }),

  /** Browse all public content (gallery feed) */
  feed: publicProcedure
    .input(
      z.object({
        classification: contentClassification.optional(),
        mediaType: z.enum(['video', 'image', 'ai-video', 'ai-image', 'audio', '3d']).optional(),
        format: z.enum(['short', 'long']).optional(),
        search: z.string().optional(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const needsJsFilter = !!(input.mediaType || input.format || input.search);

      let query: FirebaseFirestore.Query = contentCol().where('visibility', '==', 'public');

      if (input.classification) {
        query = query.where('classification', '==', input.classification);
      }

      query = query.orderBy('createdAt', 'desc');

      // Filter out moderated content from public feeds
      const HIDDEN_STATUSES = ['flagged', 'under_review', 'hidden', 'removed'];

      if (!needsJsFilter) {
        // Fast path: no JS filters needed, use Firestore cursor pagination
        if (input.cursor) {
          const cursorDoc = await contentCol().doc(input.cursor).get();
          if (cursorDoc.exists) {
            query = query.startAfter(cursorDoc);
          }
        }

        // Over-fetch to account for moderation filtering, then trim
        const snapshot = await query.limit((input.limit + 1) * 3).get();
        const items = snapshot.docs
          .filter((doc) => {
            const status = doc.data().contentStatus;
            return !status || !HIDDEN_STATUSES.includes(status);
          })
          .map((doc) => {
            const data = doc.data();
            return {
              id: doc.id,
              title: data.title,
              description: data.description,
              mediaUrl: data.mediaUrl,
              thumbnailUrl: data.thumbnailUrl || null,
              mediaType: data.mediaType,
              format: (data.format as 'short' | 'long') || null,
              classification: data.classification,
              reviewStatus: data.reviewStatus || null,
              tags: data.tags || [],
              creatorUid: data.creatorUid,
              generationId: data.generationId || null,
              views: data.views || 0,
              likes: data.likes || 0,
              createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
            };
          });

        const hasMore = items.length > input.limit;

        return {
          items: items.slice(0, input.limit),
          nextCursor: hasMore ? items[input.limit - 1]?.id : null,
        };
      }

      // Slow path: JS filters required — load a bounded set and filter in memory
      const snapshot = await query.limit(1000).get();

      let allItems = snapshot.docs
        .filter((doc) => {
          const status = doc.data().contentStatus;
          return !status || !HIDDEN_STATUSES.includes(status);
        })
        .map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            title: data.title,
            description: data.description,
            mediaUrl: data.mediaUrl,
            thumbnailUrl: data.thumbnailUrl || null,
            mediaType: data.mediaType,
            format: (data.format as 'short' | 'long') || null,
            classification: data.classification,
            tags: data.tags || [],
            creatorUid: data.creatorUid,
            generationId: data.generationId || null,
            views: data.views || 0,
            likes: data.likes || 0,
            createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
          };
        });

      // Client-side filters for fields Firestore can't compound-query easily
      if (input.mediaType) {
        allItems = allItems.filter((i) => i.mediaType === input.mediaType);
      }
      if (input.format) {
        allItems = allItems.filter((i) => i.format === input.format);
      }
      if (input.search) {
        const s = input.search.toLowerCase();
        allItems = allItems.filter(
          (i) =>
            i.title.toLowerCase().includes(s) ||
            i.description.toLowerCase().includes(s) ||
            i.tags.some((t: string) => t.toLowerCase().includes(s))
        );
      }

      // Find cursor position for in-memory pagination
      let startIdx = 0;
      if (input.cursor) {
        const idx = allItems.findIndex((d) => d.id === input.cursor);
        if (idx >= 0) startIdx = idx + 1;
      }

      const page = allItems.slice(startIdx, startIdx + input.limit + 1);
      const hasMore = page.length > input.limit;

      return {
        items: page.slice(0, input.limit),
        nextCursor: hasMore ? page[input.limit - 1]?.id : null,
      };
    }),
});

export type ContentRouter = typeof contentRouter;
