/**
 * Universe Style Router
 *
 * Visual style locking per universe. When a style is configured and locked,
 * every AI generation within that universe auto-inherits these style references
 * (prompt prefix, negative prompt, reference images, color grading, etc.).
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { z } from 'zod';
import { db } from '../../lib/firebase';
import { TRPCError } from '@trpc/server';

const universeStylesCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('universeStyles');
};

const universesCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('cinematicUniverses');
};

/** Verify that the caller is the universe creator or a team member. */
async function assertUniverseAdmin(universeAddress: string, uid: string): Promise<void> {
  const universeDoc = await universesCol().doc(universeAddress.toLowerCase()).get();
  if (!universeDoc.exists) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Universe not found' });
  }
  const universe = universeDoc.data()!;
  const creatorUid = universe.creator ?? universe.creatorUid;

  // Check creator
  if (creatorUid === uid || creatorUid === uid.toLowerCase()) return;

  // Check team members
  const teamMembers: string[] = universe.teamMembers ?? universe.team ?? [];
  if (teamMembers.map((m: string) => m.toLowerCase()).includes(uid.toLowerCase())) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Only the universe creator or team members can update style settings',
  });
}

const styleUpdateSchema = z.object({
  universeAddress: z.string(),
  colorPalette: z.string().max(500).optional(),
  visualStyle: z.string().max(100).optional(),
  stylePrompt: z.string().max(2000).optional(),
  negativePrompt: z.string().max(1000).optional(),
  referenceImages: z.array(z.string().url()).max(5).optional(),
  lutPreset: z.string().max(100).optional(),
  aspectRatio: z.string().max(20).optional(),
  cinematicStyle: z.string().max(200).optional(),
  lightingPreset: z.string().max(200).optional(),
  era: z.string().max(200).optional(),
  locked: z.boolean().optional(),
});

export const universeStyleRouter = router({
  /** Get style config for a universe (public — generators need to see constraints) */
  get: publicProcedure.input(z.object({ universeAddress: z.string() })).query(async ({ input }) => {
    const doc = await universeStylesCol().doc(input.universeAddress.toLowerCase()).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }),

  /** Create or update style config (universe creator/team only) */
  update: protectedProcedure.input(styleUpdateSchema).mutation(async ({ input, ctx }) => {
    await assertUniverseAdmin(input.universeAddress, ctx.user.uid);

    const docId = input.universeAddress.toLowerCase();
    const ref = universeStylesCol().doc(docId);
    const existing = await ref.get();

    const { universeAddress, ...fields } = input;
    const data = {
      ...fields,
      universeAddress: docId,
      updatedAt: new Date(),
      updatedBy: ctx.user.uid,
    };

    if (existing.exists) {
      await ref.update(data);
    } else {
      await ref.set({ ...data, locked: data.locked ?? false, createdAt: new Date() });
    }

    return { ok: true, id: docId };
  }),

  /** Toggle lock state (universe creator/team only) */
  lock: protectedProcedure
    .input(z.object({ universeAddress: z.string(), locked: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      await assertUniverseAdmin(input.universeAddress, ctx.user.uid);

      const docId = input.universeAddress.toLowerCase();
      const ref = universeStylesCol().doc(docId);
      const existing = await ref.get();

      if (existing.exists) {
        await ref.update({ locked: input.locked, updatedAt: new Date(), updatedBy: ctx.user.uid });
      } else {
        await ref.set({
          universeAddress: docId,
          locked: input.locked,
          updatedAt: new Date(),
          updatedBy: ctx.user.uid,
          createdAt: new Date(),
        });
      }

      return { ok: true, locked: input.locked };
    }),

  /** Get composed style prompt for generation injection */
  getStylePrompt: publicProcedure
    .input(z.object({ universeAddress: z.string() }))
    .query(async ({ input }) => {
      const doc = await universeStylesCol().doc(input.universeAddress.toLowerCase()).get();
      if (!doc.exists) return null;

      const style = doc.data()!;
      if (!style.locked) return null;

      // Compose a coherent style prefix from all defined fields
      const parts: string[] = [];

      if (style.stylePrompt) parts.push(style.stylePrompt);
      if (style.cinematicStyle) parts.push(`in the style of ${style.cinematicStyle}`);
      if (style.visualStyle) parts.push(`${style.visualStyle} aesthetic`);
      if (style.lightingPreset) parts.push(`${style.lightingPreset} lighting`);
      if (style.era) parts.push(`set in ${style.era}`);
      if (style.colorPalette) parts.push(`color palette: ${style.colorPalette}`);
      if (style.lutPreset) parts.push(`color grading: ${style.lutPreset}`);

      const prefix = parts.length > 0 ? parts.join(', ') : '';

      return {
        prefix,
        negativePrompt: style.negativePrompt ?? '',
        referenceImages: style.referenceImages ?? [],
      };
    }),
});
