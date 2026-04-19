/**
 * Universe Tone Packs Router
 *
 * Per-universe "house look" presets — reusable bundles of relight presets
 * + custom prompt fragments that creators can apply to any image with one
 * click. Sits alongside `universeStyle` (single locked style) and is used
 * by the `editing.relight` mutation when `tonePackId` is supplied.
 *
 * Auth model: read = public (creators need to discover house looks before
 * applying), write = universe creator or team member (same rule as
 * universeStyle.update).
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { randomUUID } from 'crypto';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { ALL_RELIGHT_PRESETS } from '../../services/relight/presets';

const tonePacksCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('universeTonePacks');
};

const universesCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('cinematicUniverses');
};

async function assertUniverseAdmin(universeAddress: string, uid: string): Promise<void> {
  const universeDoc = await universesCol().doc(universeAddress.toLowerCase()).get();
  if (!universeDoc.exists) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Universe not found' });
  }
  const universe = universeDoc.data()!;
  const creatorUid = universe.creator ?? universe.creatorUid;
  if (creatorUid === uid || creatorUid === uid.toLowerCase()) return;

  const teamMembers: string[] = universe.teamMembers ?? universe.team ?? [];
  if (teamMembers.map((m: string) => m.toLowerCase()).includes(uid.toLowerCase())) return;

  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'Only the universe creator or team members can manage tone packs',
  });
}

const VALID_PRESET_IDS = new Set(ALL_RELIGHT_PRESETS.map((p) => p.id));

const presetIdsSchema = z
  .array(z.string())
  .max(8, 'A tone pack may stack at most 8 presets')
  .refine((ids) => ids.every((id) => VALID_PRESET_IDS.has(id)), {
    message: 'One or more preset IDs are unknown',
  });

const createInput = z.object({
  universeAddress: z.string().min(1),
  name: z.string().min(1).max(60),
  description: z.string().max(280).optional(),
  presetIds: presetIdsSchema.default([]),
  customPromptFragment: z.string().max(500).optional(),
  customNegativeFragment: z.string().max(300).optional(),
});

const updateInput = z.object({
  id: z.string().min(1),
  universeAddress: z.string().min(1),
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(280).optional(),
  presetIds: presetIdsSchema.optional(),
  customPromptFragment: z.string().max(500).optional(),
  customNegativeFragment: z.string().max(300).optional(),
});

export const universeTonePacksRouter = router({
  /** List all tone packs for a universe (public — relight UI needs to read these). */
  list: publicProcedure
    .input(z.object({ universeAddress: z.string().min(1) }))
    .query(async ({ input }) => {
      const snap = await tonePacksCol()
        .where('universeAddress', '==', input.universeAddress.toLowerCase())
        .get();
      return snap.docs
        .map((d) => {
          const data = d.data();
          return {
            id: d.id,
            universeAddress: data.universeAddress,
            name: data.name,
            description: data.description ?? '',
            presetIds: data.presetIds ?? [],
            customPromptFragment: data.customPromptFragment ?? '',
            customNegativeFragment: data.customNegativeFragment ?? '',
            createdBy: data.createdBy,
            createdAt: data.createdAt?.toDate?.() ?? data.createdAt,
            updatedAt: data.updatedAt?.toDate?.() ?? data.updatedAt,
          };
        })
        .sort((a, b) => {
          const at = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
          const bt = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
          return bt - at;
        });
    }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    await assertUniverseAdmin(input.universeAddress, ctx.user.uid);
    const id = randomUUID();
    const now = new Date();
    await tonePacksCol()
      .doc(id)
      .set({
        universeAddress: input.universeAddress.toLowerCase(),
        name: input.name,
        description: input.description ?? '',
        presetIds: input.presetIds,
        customPromptFragment: input.customPromptFragment ?? '',
        customNegativeFragment: input.customNegativeFragment ?? '',
        createdBy: ctx.user.uid,
        createdAt: now,
        updatedAt: now,
      });
    return { id };
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    await assertUniverseAdmin(input.universeAddress, ctx.user.uid);
    const ref = tonePacksCol().doc(input.id);
    const existing = await ref.get();
    if (!existing.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Tone pack not found' });
    }
    if (
      (existing.data()?.universeAddress ?? '').toLowerCase() !== input.universeAddress.toLowerCase()
    ) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Tone pack belongs to a different universe',
      });
    }
    const { id: _id, universeAddress: _ua, ...updates } = input;
    await ref.update({ ...updates, updatedAt: new Date() });
    return { ok: true };
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().min(1), universeAddress: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await assertUniverseAdmin(input.universeAddress, ctx.user.uid);
      const ref = tonePacksCol().doc(input.id);
      const existing = await ref.get();
      if (!existing.exists) return { ok: true };
      if (
        (existing.data()?.universeAddress ?? '').toLowerCase() !==
        input.universeAddress.toLowerCase()
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Tone pack belongs to a different universe',
        });
      }
      await ref.delete();
      return { ok: true };
    }),
});
