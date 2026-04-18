/**
 * Sandbox Router
 *
 * Allows users to save and manage draft creations without needing a universe.
 * Draft items can later be promoted to a universe.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';

const sandboxCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('sandboxDrafts');
};
const contentCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('content');
};
const profilesCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('profiles');
};

export const sandboxRouter = router({
  // Save a draft item (image + optional video) to Firestore.
  // Auto-creates a gallery content record so all generated media is immediately visible.
  saveDraft: protectedProcedure
    .input(
      z.object({
        title: z.string().min(1).max(200),
        prompt: z.string().min(1).max(2000),
        imageUrl: z.string().url().optional(),
        videoUrl: z.string().url().optional(),
        model: z.string().optional(),
        tags: z.array(z.string()).max(10).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const hasMedia = !!(input.videoUrl || input.imageUrl);
      const mediaType = input.videoUrl ? 'ai-video' : input.imageUrl ? 'ai-image' : 'image';

      const doc = await sandboxCol().add({
        creatorAddress: ctx.user.address,
        title: input.title,
        prompt: input.prompt,
        imageUrl: input.imageUrl || null,
        videoUrl: input.videoUrl || null,
        model: input.model || null,
        tags: input.tags,
        status: hasMedia ? 'promoted' : 'draft',
        createdAt: now,
        updatedAt: now,
      });

      // Auto-publish to gallery when media is present (skip if already published by generation route)
      let contentId: string | null = null;
      if (hasMedia) {
        const mediaUrl = input.videoUrl || input.imageUrl || '';

        // Check if a content record already exists for this media URL (auto-created by generation route)
        const existing = await contentCol()
          .where('mediaUrl', '==', mediaUrl)
          .where('creatorUid', '==', ctx.user.uid)
          .limit(1)
          .get();

        if (!existing.empty) {
          // Already in gallery — update title/tags and link to this draft
          const existingDoc = existing.docs[0];
          contentId = existingDoc.id;
          await existingDoc.ref.update({
            title: input.title,
            tags: input.tags || [],
            description: input.prompt || '',
            updatedAt: now,
          });
        } else {
          // Not yet in gallery — create content record
          const contentData = {
            title: input.title,
            description: input.prompt || '',
            mediaUrl,
            thumbnailUrl: input.imageUrl || null,
            mediaType,
            classification: 'original' as const,
            tags: input.tags || [],
            ipDeclaration: {
              isOriginal: true,
              usesCopyrightedMaterial: false,
              license: 'all-rights-reserved',
            },
            visibility: 'public',
            creatorUid: ctx.user.uid,
            createdAt: now,
            updatedAt: now,
            views: 0,
            likes: 0,
            reviewStatus: 'not_required',
            promotedFromDraft: doc.id,
            generationModel: input.model || null,
          };
          const contentRef = await contentCol().add(contentData);
          contentId = contentRef.id;

          // Update profile content count
          const profileRef = profilesCol().doc(ctx.user.uid);
          const profileDoc = await profileRef.get();
          if (profileDoc.exists) {
            await profileRef.update({ contentCount: FieldValue.increment(1) });
          }
        }

        // Link draft to content
        await doc.update({ promotedTo: contentId, status: 'promoted', updatedAt: now });
      }

      return { id: doc.id, contentId };
    }),

  // Update an existing draft
  updateDraft: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        title: z.string().min(1).max(200).optional(),
        videoUrl: z.string().url().optional(),
        imageUrl: z.string().url().optional(),
        tags: z.array(z.string()).max(10).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ref = sandboxCol().doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });
      if (snap.data()?.creatorAddress !== ctx.user.address)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.videoUrl !== undefined) updates.videoUrl = input.videoUrl;
      if (input.imageUrl !== undefined) updates.imageUrl = input.imageUrl;
      if (input.tags !== undefined) updates.tags = input.tags;

      await ref.update(updates);
      return { ok: true };
    }),

  // Delete a draft
  deleteDraft: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ref = sandboxCol().doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });
      if (snap.data()?.creatorAddress !== ctx.user.address)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });
      await ref.delete();
      return { ok: true };
    }),

  // Get all drafts for the current user
  myDrafts: protectedProcedure.query(async ({ ctx }) => {
    const snap = await sandboxCol()
      .where('creatorAddress', '==', ctx.user.address)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    return snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title as string,
        prompt: d.prompt as string,
        imageUrl: d.imageUrl as string | null,
        videoUrl: d.videoUrl as string | null,
        model: d.model as string | null,
        tags: d.tags as string[],
        status: d.status as string,
        createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? null,
        updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      };
    });
  }),

  /**
   * Promote a sandbox draft into a universe as gallery content.
   * The draft becomes a content item in the universe (still mutable, stored in Firebase).
   * Users can later mint it as an NFT or submit it for canon.
   */
  /**
   * Promote a sandbox draft to gallery content.
   * If universeId is provided, it goes into that universe's gallery.
   * If omitted, it goes into the creator's general gallery (no universe).
   */
  promoteToUniverse: protectedProcedure
    .input(
      z.object({
        draftId: z.string(),
        universeId: z.string().optional(),
        classification: z.enum(['fan', 'original', 'licensed']).default('original'),
        visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const ref = sandboxCol().doc(input.draftId);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Draft not found' });

      const draft = snap.data()!;
      if (draft.creatorAddress !== ctx.user.address)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });
      const now = new Date();
      const mediaUrl = draft.videoUrl || draft.imageUrl || '';
      const mediaType = draft.videoUrl ? 'ai-video' : draft.imageUrl ? 'ai-image' : 'image';

      // Check if content record already exists (auto-created by saveDraft or generation route)
      let contentId: string;
      const existing = await contentCol()
        .where('mediaUrl', '==', mediaUrl)
        .where('creatorUid', '==', ctx.user.uid)
        .limit(1)
        .get();

      if (!existing.empty) {
        // Update existing content record with universe/classification/visibility
        const existingDoc = existing.docs[0];
        contentId = existingDoc.id;
        const updates: Record<string, any> = {
          classification: input.classification,
          visibility: input.visibility,
          updatedAt: now,
        };
        if (input.universeId) updates.universeId = input.universeId;
        await existingDoc.ref.update(updates);
      } else {
        // Create new content record
        const contentData: Record<string, any> = {
          title: draft.title,
          description: draft.prompt || '',
          mediaUrl,
          thumbnailUrl: draft.imageUrl || null,
          mediaType,
          classification: input.classification,
          tags: draft.tags || [],
          ipDeclaration: {
            isOriginal: true,
            usesCopyrightedMaterial: false,
            license: 'all-rights-reserved',
          },
          visibility: input.visibility,
          creatorUid: ctx.user.uid,
          createdAt: now,
          updatedAt: now,
          views: 0,
          likes: 0,
          reviewStatus: 'not_required',
          promotedFromDraft: input.draftId,
          generationModel: draft.model || null,
        };
        if (input.universeId) contentData.universeId = input.universeId;
        const contentRef = await contentCol().add(contentData);
        contentId = contentRef.id;

        // Update profile content count
        const profileRef = profilesCol().doc(ctx.user.uid);
        const profileDoc = await profileRef.get();
        if (profileDoc.exists) {
          await profileRef.update({ contentCount: FieldValue.increment(1) });
        }
      }

      // Mark draft as promoted
      await ref.update({
        status: 'promoted',
        promotedTo: contentId,
        ...(input.universeId ? { promotedUniverseId: input.universeId } : {}),
        updatedAt: now,
      });

      return { contentId, universeId: input.universeId ?? null };
    }),

  // Get a single draft
  getDraft: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const snap = await sandboxCol().doc(input.id).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
    if (d.creatorAddress !== ctx.user.address) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your draft' });
    }
    return {
      id: snap.id,
      title: d.title as string,
      prompt: d.prompt as string,
      imageUrl: d.imageUrl as string | null,
      videoUrl: d.videoUrl as string | null,
      model: d.model as string | null,
      tags: d.tags as string[],
      status: d.status as string,
      createdAt: d.createdAt?.toDate?.()?.toISOString?.() ?? null,
    };
  }),
});
