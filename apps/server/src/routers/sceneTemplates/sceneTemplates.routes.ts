/**
 * Scene Templates Router ("Studios")
 *
 * Reusable preset bundles a creator can save and others can fork into their
 * own scenes. A template bundles together:
 *   - stylePreset (visual look)
 *   - shotPreset  (composition: framing/angle/lens/focus)
 *   - cameraPreset (motion)
 *   - vfxPresets (post-processing)
 *   - starterPrompt (optional jumping-off text)
 *
 * Storage: `sceneTemplates` Firestore collection. Owner-only mutation; list
 * supports "mine" + "public" scopes. No on-chain footprint — discovery and
 * curation happens off-chain for v1.
 */

import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import {
  STYLE_PRESETS,
  SHOT_PRESETS,
  CAMERA_PRESETS,
  VFX_PRESETS,
  type StylePresetId,
  type ShotPresetId,
  type CameraPresetId,
  type CameraIntensity,
  type VfxPresetId,
} from '../../services/scene-controls/types';

// ── Collection ────────────────────────────────────────────────────────

const sceneTemplatesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('sceneTemplates');
};

// ── Schemas ───────────────────────────────────────────────────────────

const stylePresetSchema = z.enum(Object.keys(STYLE_PRESETS) as [StylePresetId, ...StylePresetId[]]);
const shotPresetSchema = z.enum(Object.keys(SHOT_PRESETS) as [ShotPresetId, ...ShotPresetId[]]);
const cameraPresetSchema = z.enum(
  Object.keys(CAMERA_PRESETS) as [CameraPresetId, ...CameraPresetId[]]
);
const vfxPresetSchema = z.enum(Object.keys(VFX_PRESETS) as [VfxPresetId, ...VfxPresetId[]]);

const bundleSchema = z.object({
  stylePreset: stylePresetSchema.nullable().optional(),
  shotPreset: shotPresetSchema.nullable().optional(),
  cameraPreset: cameraPresetSchema.nullable().optional(),
  cameraIntensity: z.enum(['subtle', 'standard', 'pronounced']).optional(),
  vfxPresets: z.array(vfxPresetSchema).optional(),
  starterPrompt: z.string().max(2000).optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  coverImageUrl: z.string().url().optional(),
  visibility: z.enum(['private', 'public']).default('private'),
  bundle: bundleSchema,
});

// ── Types ─────────────────────────────────────────────────────────────

export interface SceneTemplate {
  id: string;
  name: string;
  description?: string;
  coverImageUrl?: string;
  visibility: 'private' | 'public';
  creatorUid: string;
  /** Wallet address if the creator has one linked; SIWE flows always do, MCP API keys may not. */
  creatorAddress?: string;
  bundle: {
    stylePreset?: StylePresetId | null;
    shotPreset?: ShotPresetId | null;
    cameraPreset?: CameraPresetId | null;
    cameraIntensity?: CameraIntensity;
    vfxPresets?: VfxPresetId[];
    starterPrompt?: string;
  };
  useCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// ── Router ────────────────────────────────────────────────────────────

export const sceneTemplatesRouter = router({
  create: protectedProcedure.input(createSchema).mutation(async ({ input, ctx }) => {
    const id = randomUUID();
    const now = new Date();
    const doc: SceneTemplate = {
      id,
      name: input.name,
      description: input.description,
      coverImageUrl: input.coverImageUrl,
      visibility: input.visibility,
      creatorUid: ctx.user.uid,
      creatorAddress: ctx.user.address,
      bundle: input.bundle,
      useCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    // Firestore rejects undefined — strip them.
    const clean = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
    await sceneTemplatesCol().doc(id).set(clean);
    return doc;
  }),

  list: publicProcedure
    .input(
      z.object({
        scope: z.enum(['mine', 'public']).default('public'),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      let query = sceneTemplatesCol() as FirebaseFirestore.Query;
      if (input.scope === 'mine') {
        if (!ctx.user) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Sign in to view your templates',
          });
        }
        query = query.where('creatorUid', '==', ctx.user.uid);
      } else {
        query = query.where('visibility', '==', 'public');
      }
      const snap = await query.orderBy('createdAt', 'desc').limit(input.limit).get();
      return snap.docs.map((d) => d.data() as SceneTemplate);
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const snap = await sceneTemplatesCol().doc(input.id).get();
    if (!snap.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
    }
    const tpl = snap.data() as SceneTemplate;
    // Private templates only visible to the owner.
    if (tpl.visibility === 'private' && tpl.creatorUid !== ctx.user?.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This template is private' });
    }
    return tpl;
  }),

  /** Increments use_count and returns the bundle for client application. */
  use: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input, ctx }) => {
    const ref = sceneTemplatesCol().doc(input.id);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
    }
    const tpl = snap.data() as SceneTemplate;
    if (tpl.visibility === 'private' && tpl.creatorUid !== ctx.user?.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This template is private' });
    }
    await ref.update({ useCount: (tpl.useCount || 0) + 1, updatedAt: new Date() });
    return tpl.bundle;
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = sceneTemplatesCol().doc(input.id);
      const snap = await ref.get();
      if (!snap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found' });
      }
      const tpl = snap.data() as SceneTemplate;
      if (tpl.creatorUid !== ctx.user.uid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the creator can delete this template',
        });
      }
      await ref.delete();
      return { ok: true };
    }),
});
