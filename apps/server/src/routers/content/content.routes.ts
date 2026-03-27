/**
 * Content Router
 *
 * Manages user-created content (videos, images) with classification:
 * - "fun": Non-monetized, can use copyrighted/fan materials
 * - "monetized": Commercial use, strict IP protection rules
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

const contentCol = db.collection('content');
const profilesCol = db.collection('profiles');

const contentClassification = z.enum(['fun', 'monetized']);

const createContentSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(2000).default(''),
  mediaUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  mediaType: z.enum(['video', 'image', 'ai-video', 'ai-image']),
  classification: contentClassification,
  tags: z.array(z.string().max(30)).max(15).default([]),
  // IP-related fields
  ipDeclaration: z.object({
    isOriginal: z.boolean(),
    usescopyrightedMaterial: z.boolean().default(false),
    copyrightNotes: z.string().max(500).optional(),
    license: z.enum(['all-rights-reserved', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc0', 'fan-work']).default('all-rights-reserved'),
  }),
  // Optional: link to a universe
  universeId: z.string().optional(),
  // Visibility within the user's profile
  visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
});

const updateContentSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(100).optional(),
  description: z.string().max(2000).optional(),
  thumbnailUrl: z.string().url().optional(),
  classification: contentClassification.optional(),
  tags: z.array(z.string().max(30)).max(15).optional(),
  ipDeclaration: z.object({
    isOriginal: z.boolean(),
    usescopyrightedMaterial: z.boolean().default(false),
    copyrightNotes: z.string().max(500).optional(),
    license: z.enum(['all-rights-reserved', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc0', 'fan-work']).default('all-rights-reserved'),
  }).optional(),
  visibility: z.enum(['public', 'private', 'unlisted']).optional(),
});

export const contentRouter = router({
  /** Create a new content item */
  create: protectedProcedure
    .input(createContentSchema)
    .mutation(async ({ ctx, input }) => {
      // Enforce IP rules for monetized content
      if (input.classification === 'monetized') {
        if (input.ipDeclaration.usescopyrightedMaterial) {
          throw new Error('Monetized content cannot use copyrighted materials. Switch to "Fun" classification or remove copyrighted content.');
        }
        if (input.ipDeclaration.license === 'fan-work') {
          throw new Error('Fan works cannot be monetized. Switch to "Fun" classification.');
        }
        if (!input.ipDeclaration.isOriginal) {
          throw new Error('Monetized content must be original work. Confirm originality or switch to "Fun" classification.');
        }
      }

      const now = new Date();
      const contentData = {
        ...input,
        creatorUid: ctx.user.uid,
        createdAt: now,
        updatedAt: now,
        views: 0,
        likes: 0,
      };

      const ref = await contentCol.add(contentData);

      // Increment content count on profile
      const profileRef = profilesCol.doc(ctx.user.uid);
      const profileDoc = await profileRef.get();
      if (profileDoc.exists) {
        await profileRef.update({ contentCount: FieldValue.increment(1) });
      }

      return { id: ref.id, ...contentData };
    }),

  /** Update an existing content item (owner only) */
  update: protectedProcedure
    .input(updateContentSchema)
    .mutation(async ({ ctx, input }) => {
      const ref = contentCol.doc(input.id);
      const doc = await ref.get();

      if (!doc.exists) throw new Error('Content not found');
      if (doc.data()!.creatorUid !== ctx.user.uid) throw new Error('Not authorized');

      const existing = doc.data()!;
      const newClassification = input.classification || existing.classification;
      const newIp = input.ipDeclaration || existing.ipDeclaration;

      // Re-validate IP rules if changing to monetized
      if (newClassification === 'monetized') {
        if (newIp.usescopyrightedMaterial) {
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
      const ref = contentCol.doc(input.id);
      const doc = await ref.get();

      if (!doc.exists) throw new Error('Content not found');
      if (doc.data()!.creatorUid !== ctx.user.uid) throw new Error('Not authorized');

      await ref.delete();

      // Decrement content count on profile
      const profileRef = profilesCol.doc(ctx.user.uid);
      const profileDoc = await profileRef.get();
      if (profileDoc.exists) {
        await profileRef.update({ contentCount: FieldValue.increment(-1) });
      }

      return { ok: true };
    }),

  /** Get a single content item by ID */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const doc = await contentCol.doc(input.id).get();
      if (!doc.exists) return null;

      const data = doc.data()!;
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
    .input(z.object({
      creatorUid: z.string(),
      classification: contentClassification.optional(),
      limit: z.number().min(1).max(50).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let query = contentCol
        .where('creatorUid', '==', input.creatorUid)
        .where('visibility', '==', 'public')
        .orderBy('createdAt', 'desc')
        .limit(input.limit + 1);

      if (input.classification) {
        query = contentCol
          .where('creatorUid', '==', input.creatorUid)
          .where('visibility', '==', 'public')
          .where('classification', '==', input.classification)
          .orderBy('createdAt', 'desc')
          .limit(input.limit + 1);
      }

      if (input.cursor) {
        const cursorDoc = await contentCol.doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const docs = snapshot.docs;
      const hasMore = docs.length > input.limit;

      return {
        items: docs.slice(0, input.limit).map((doc) => {
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
        }),
        nextCursor: hasMore ? docs[input.limit - 1]?.id : null,
      };
    }),

  /** Get the current user's own content (all visibilities) */
  myContent: protectedProcedure
    .input(z.object({
      classification: contentClassification.optional(),
      limit: z.number().min(1).max(50).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      let query = contentCol
        .where('creatorUid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit + 1);

      if (input.classification) {
        query = contentCol
          .where('creatorUid', '==', ctx.user.uid)
          .where('classification', '==', input.classification)
          .orderBy('createdAt', 'desc')
          .limit(input.limit + 1);
      }

      if (input.cursor) {
        const cursorDoc = await contentCol.doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const docs = snapshot.docs;
      const hasMore = docs.length > input.limit;

      return {
        items: docs.slice(0, input.limit).map((doc) => {
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
        }),
        nextCursor: hasMore ? docs[input.limit - 1]?.id : null,
      };
    }),

  /** Browse all public content (gallery feed) */
  feed: publicProcedure
    .input(z.object({
      classification: contentClassification.optional(),
      mediaType: z.enum(['video', 'image', 'ai-video', 'ai-image']).optional(),
      search: z.string().optional(),
      limit: z.number().min(1).max(50).default(20),
      cursor: z.string().optional(),
    }))
    .query(async ({ input }) => {
      let query = contentCol
        .where('visibility', '==', 'public')
        .orderBy('createdAt', 'desc')
        .limit(input.limit + 1);

      if (input.classification) {
        query = contentCol
          .where('visibility', '==', 'public')
          .where('classification', '==', input.classification)
          .orderBy('createdAt', 'desc')
          .limit(input.limit + 1);
      }

      if (input.cursor) {
        const cursorDoc = await contentCol.doc(input.cursor).get();
        if (cursorDoc.exists) {
          query = query.startAfter(cursorDoc);
        }
      }

      const snapshot = await query.get();
      const docs = snapshot.docs;
      const hasMore = docs.length > input.limit;

      let items = docs.slice(0, input.limit).map((doc) => {
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
          creatorUid: data.creatorUid,
          views: data.views || 0,
          likes: data.likes || 0,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() || null,
        };
      });

      // Client-side filters for fields Firestore can't compound-query easily
      if (input.mediaType) {
        items = items.filter((i) => i.mediaType === input.mediaType);
      }
      if (input.search) {
        const s = input.search.toLowerCase();
        items = items.filter(
          (i) =>
            i.title.toLowerCase().includes(s) ||
            i.description.toLowerCase().includes(s) ||
            i.tags.some((t: string) => t.toLowerCase().includes(s))
        );
      }

      return {
        items,
        nextCursor: hasMore ? docs[input.limit - 1]?.id : null,
      };
    }),
});

export type ContentRouter = typeof contentRouter;
