/**
 * Shot Templates Router — PRD 7: Pose, Composition, Angle, and Scene Control
 *
 * CRUD for saved generation templates. A shot template bundles a camera angle,
 * a base prompt, and a set of guide-image controls (pose, style, scribble,
 * etc.) so creators can re-use them across episode shots for visual continuity.
 *
 * Firestore collection: `shotTemplates`
 */

import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { CONTROL_TYPES } from '../../services/scene-controls/controlled-gen';

// ── Collection ref ───────────────────────────────────────────────────

const col = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('shotTemplates');
};

// ── Schemas ──────────────────────────────────────────────────────────

const controlSchema = z.object({
  controlType: z.enum(CONTROL_TYPES),
  guideImageUrl: z.string().url(),
  guideContentHash: z.string().default(''),
  strength: z.number().min(0).max(1),
});

// ── Helpers ──────────────────────────────────────────────────────────

function serialize(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id,
    universeId: (data.universeId as string | null) ?? null,
    episodeId: (data.episodeId as string | null) ?? null,
    createdBy: data.createdBy as string,
    name: data.name as string,
    description: (data.description as string) || '',
    anglePreset: (data.anglePreset as string | null) ?? null,
    controls: (data.controls as z.infer<typeof controlSchema>[]) || [],
    basePrompt: (data.basePrompt as string) || '',
    createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
    updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt),
  };
}

// ── Router ───────────────────────────────────────────────────────────

export const shotTemplatesRouter = router({
  /**
   * List templates visible to the caller. Filters by universe and/or
   * episode if provided, otherwise returns the caller's own templates.
   */
  list: protectedProcedure
    .input(
      z.object({
        universeId: z.string().optional(),
        episodeId: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      let query: FirebaseFirestore.Query = col();

      if (input.universeId) {
        query = query.where('universeId', '==', input.universeId.toLowerCase());
      } else {
        query = query.where('createdBy', '==', ctx.user.uid.toLowerCase());
      }
      if (input.episodeId) {
        query = query.where('episodeId', '==', input.episodeId);
      }

      const snapshot = await query.orderBy('createdAt', 'desc').limit(input.limit).get();
      return snapshot.docs.map((doc) => serialize(doc.id, doc.data()));
    }),

  /**
   * Get a single template by id. Readable if the caller created it or
   * if it's attached to a universe (universe-scoped templates are public
   * within the universe).
   */
  get: publicProcedure.input(z.object({ shotTemplateId: z.string() })).query(async ({ input }) => {
    const doc = await col().doc(input.shotTemplateId).get();
    if (!doc.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Shot template not found' });
    }
    return serialize(doc.id, doc.data()!);
  }),

  /** Create a new shot template. */
  create: protectedProcedure
    .input(
      z.object({
        universeId: z.string().optional(),
        episodeId: z.string().optional(),
        name: z.string().min(1).max(100),
        description: z.string().max(2000).default(''),
        anglePreset: z.string().nullable().default(null),
        controls: z.array(controlSchema).max(8).default([]),
        basePrompt: z.string().max(4000).default(''),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = randomUUID();
      const now = new Date();

      await col()
        .doc(id)
        .set({
          universeId: input.universeId?.toLowerCase() ?? null,
          episodeId: input.episodeId ?? null,
          name: input.name,
          description: input.description,
          anglePreset: input.anglePreset,
          controls: input.controls,
          basePrompt: input.basePrompt,
          createdBy: ctx.user.uid.toLowerCase(),
          createdAt: now,
          updatedAt: now,
        });

      return serialize(id, {
        universeId: input.universeId?.toLowerCase() ?? null,
        episodeId: input.episodeId ?? null,
        name: input.name,
        description: input.description,
        anglePreset: input.anglePreset,
        controls: input.controls,
        basePrompt: input.basePrompt,
        createdBy: ctx.user.uid.toLowerCase(),
        createdAt: now,
        updatedAt: now,
      });
    }),

  /** Update an existing template. Creator only. */
  update: protectedProcedure
    .input(
      z.object({
        shotTemplateId: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(2000).optional(),
        anglePreset: z.string().nullable().optional(),
        controls: z.array(controlSchema).max(8).optional(),
        basePrompt: z.string().max(4000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ref = col().doc(input.shotTemplateId);
      const doc = await ref.get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Shot template not found' });
      }
      if (doc.data()?.createdBy !== ctx.user.uid.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can update this template',
        });
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.anglePreset !== undefined) updates.anglePreset = input.anglePreset;
      if (input.controls !== undefined) updates.controls = input.controls;
      if (input.basePrompt !== undefined) updates.basePrompt = input.basePrompt;

      await ref.update(updates);
      const fresh = await ref.get();
      return serialize(fresh.id, fresh.data()!);
    }),

  /** Delete a template. Creator only. */
  delete: protectedProcedure
    .input(z.object({ shotTemplateId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = col().doc(input.shotTemplateId);
      const doc = await ref.get();
      if (!doc.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Shot template not found' });
      }
      if (doc.data()?.createdBy !== ctx.user.uid.toLowerCase()) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can delete this template',
        });
      }
      await ref.delete();
      return { deleted: true, id: input.shotTemplateId };
    }),
});
