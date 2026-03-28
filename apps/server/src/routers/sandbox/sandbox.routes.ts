/**
 * Sandbox Router
 *
 * Allows users to save and manage draft creations without needing a universe.
 * Draft items can later be promoted to a universe.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { db } from '../../lib/firebase';

const sandboxCol = db.collection('sandboxDrafts');

export const sandboxRouter = router({
  // Save a draft item (image + optional video) to Firestore
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
      const doc = await sandboxCol.add({
        creatorAddress: ctx.user.address,
        title: input.title,
        prompt: input.prompt,
        imageUrl: input.imageUrl || null,
        videoUrl: input.videoUrl || null,
        model: input.model || null,
        tags: input.tags,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      });
      return { id: doc.id };
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
      const ref = sandboxCol.doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) throw new Error('Draft not found');
      if (snap.data()?.creatorAddress !== ctx.user.address) throw new Error('Unauthorized');

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
      const ref = sandboxCol.doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) throw new Error('Draft not found');
      if (snap.data()?.creatorAddress !== ctx.user.address) throw new Error('Unauthorized');
      await ref.delete();
      return { ok: true };
    }),

  // Get all drafts for the current user
  myDrafts: protectedProcedure.query(async ({ ctx }) => {
    const snap = await sandboxCol
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

  // Get a single draft
  getDraft: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const snap = await sandboxCol.doc(input.id).get();
    if (!snap.exists) return null;
    const d = snap.data()!;
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
