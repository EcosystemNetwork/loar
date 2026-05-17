/**
 * Cinematic References Router
 *
 * User-contributed library of visual references — film stills, photographs,
 * paintings — tagged with cinematographic vocabulary (framing, era, mood,
 * film, director). LOAR's lightweight answer to Flick's classical-scene
 * reference DB.
 *
 * Two roles:
 *   1. Inspiration — creators browse before generating to anchor their look.
 *   2. Prompt seed — clicking a reference can copy its tags into the prompt
 *      or pin its URL as an image-to-image source.
 *
 * Tags are free-text array (lowercased, deduped). No fixed enum because the
 * vocabulary creators use is broader than any preset list.
 */

import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';

const cinematicReferencesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('cinematicReferences');
};

const createSchema = z.object({
  title: z.string().min(1).max(120),
  imageUrl: z.string().url(),
  sourceUrl: z.string().url().optional(),
  film: z.string().max(120).optional(),
  director: z.string().max(120).optional(),
  year: z.number().int().min(1850).max(2100).optional(),
  notes: z.string().max(1000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  visibility: z.enum(['private', 'public']).default('public'),
});

export interface CinematicReference {
  id: string;
  title: string;
  imageUrl: string;
  sourceUrl?: string;
  film?: string;
  director?: string;
  year?: number;
  notes?: string;
  tags: string[];
  visibility: 'private' | 'public';
  creatorUid: string;
  creatorAddress?: string;
  pinCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function normalizeTags(tags: string[]): string[] {
  return Array.from(new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)));
}

export const cinematicReferencesRouter = router({
  create: protectedProcedure.input(createSchema).mutation(async ({ input, ctx }) => {
    const id = randomUUID();
    const now = new Date();
    const doc: CinematicReference = {
      id,
      title: input.title,
      imageUrl: input.imageUrl,
      sourceUrl: input.sourceUrl,
      film: input.film,
      director: input.director,
      year: input.year,
      notes: input.notes,
      tags: normalizeTags(input.tags),
      visibility: input.visibility,
      creatorUid: ctx.user.uid,
      creatorAddress: ctx.user.address,
      pinCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const clean = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
    await cinematicReferencesCol().doc(id).set(clean);
    return doc;
  }),

  list: publicProcedure
    .input(
      z.object({
        scope: z.enum(['mine', 'public']).default('public'),
        tag: z.string().optional(),
        limit: z.number().min(1).max(100).default(40),
      })
    )
    .query(async ({ input, ctx }) => {
      let query = cinematicReferencesCol() as FirebaseFirestore.Query;
      if (input.scope === 'mine') {
        if (!ctx.user) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Sign in to view your references',
          });
        }
        query = query.where('creatorUid', '==', ctx.user.uid);
      } else {
        query = query.where('visibility', '==', 'public');
      }
      if (input.tag) {
        query = query.where('tags', 'array-contains', input.tag.trim().toLowerCase());
      }
      const snap = await query.orderBy('createdAt', 'desc').limit(input.limit).get();
      return snap.docs.map((d) => d.data() as CinematicReference);
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const snap = await cinematicReferencesCol().doc(input.id).get();
    if (!snap.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Reference not found' });
    }
    const ref = snap.data() as CinematicReference;
    if (ref.visibility === 'private' && ref.creatorUid !== ctx.user?.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Reference is private' });
    }
    return ref;
  }),

  /**
   * Light "I used this" signal. Increments pinCount for trending sort,
   * returns the reference's tags + title for the client to splice into a prompt.
   */
  pin: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const ref = cinematicReferencesCol().doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Reference not found' });
    }
    const data = snap.data() as CinematicReference;
    if (data.visibility === 'private' && data.creatorUid !== ctx.user?.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Reference is private' });
    }
    await ref.update({ pinCount: (data.pinCount || 0) + 1, updatedAt: new Date() });
    return {
      title: data.title,
      imageUrl: data.imageUrl,
      tags: data.tags,
      film: data.film,
      director: data.director,
    };
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = cinematicReferencesCol().doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Reference not found' });
      }
      const data = snap.data() as CinematicReference;
      if (data.creatorUid !== ctx.user.uid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can delete this reference',
        });
      }
      await ref.delete();
      return { ok: true };
    }),

  /** List the most-pinned public tags for a discovery sidebar. */
  popularTags: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ input }) => {
      const snap = await cinematicReferencesCol()
        .where('visibility', '==', 'public')
        .limit(500)
        .get();
      const counts = new Map<string, number>();
      for (const doc of snap.docs) {
        const ref = doc.data() as CinematicReference;
        for (const tag of ref.tags || []) {
          counts.set(tag, (counts.get(tag) || 0) + 1);
        }
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, input.limit)
        .map(([tag, count]) => ({ tag, count }));
    }),
});
