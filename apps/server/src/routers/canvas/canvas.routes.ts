/**
 * Canvas Router (Flick-style infinite canvas)
 *
 * Spatial node-based scene composition. A canvas is a board; a scene is a
 * node on that board (with x/y position, optional parentId for branching,
 * and a preset bundle + prompt). Owners freely drag, branch, and iterate.
 *
 * v1 stores the full canvas + scenes in Firestore. Generation per-scene is
 * a follow-up — for now we just persist the canvas state; the existing
 * image/video generation endpoints can be called from the client with the
 * scene's stored bundle.
 */

import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import {
  STYLE_PRESETS,
  SHOT_PRESETS,
  type StylePresetId,
  type ShotPresetId,
} from '../../services/scene-controls/types';

// ── Collections ───────────────────────────────────────────────────────

const canvasesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('canvases');
};
const canvasScenesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('canvasScenes');
};

// ── Schemas ───────────────────────────────────────────────────────────

const stylePresetSchema = z.enum(Object.keys(STYLE_PRESETS) as [StylePresetId, ...StylePresetId[]]);
const shotPresetSchema = z.enum(Object.keys(SHOT_PRESETS) as [ShotPresetId, ...ShotPresetId[]]);

const sceneBundleSchema = z.object({
  stylePreset: stylePresetSchema.nullable().optional(),
  shotPreset: shotPresetSchema.nullable().optional(),
  prompt: z.string().max(2000).optional(),
});

const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const createCanvasSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  visibility: z.enum(['private', 'public']).default('private'),
});

const addSceneSchema = z.object({
  canvasId: z.string(),
  position: positionSchema,
  parentId: z.string().nullable().optional(),
  bundle: sceneBundleSchema.optional(),
});

const updateSceneSchema = z.object({
  id: z.string(),
  position: positionSchema.optional(),
  bundle: sceneBundleSchema.optional(),
  generatedImageUrl: z.string().url().nullable().optional(),
  generatedVideoUrl: z.string().url().nullable().optional(),
});

// ── Types ─────────────────────────────────────────────────────────────

export interface Canvas {
  id: string;
  title: string;
  description?: string;
  visibility: 'private' | 'public';
  ownerUid: string;
  ownerAddress?: string;
  sceneCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CanvasScene {
  id: string;
  canvasId: string;
  parentId: string | null;
  position: { x: number; y: number };
  bundle: {
    stylePreset?: StylePresetId | null;
    shotPreset?: ShotPresetId | null;
    prompt?: string;
  };
  generatedImageUrl?: string | null;
  generatedVideoUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Helpers ───────────────────────────────────────────────────────────

async function assertCanvasOwner(canvasId: string, uid: string): Promise<Canvas> {
  const snap = await canvasesCol().doc(canvasId).get();
  if (!snap.exists) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Canvas not found' });
  }
  const canvas = snap.data() as Canvas;
  if (canvas.ownerUid !== uid) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You do not own this canvas' });
  }
  return canvas;
}

async function loadSceneOrThrow(id: string): Promise<CanvasScene> {
  const snap = await canvasScenesCol().doc(id).get();
  if (!snap.exists) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Scene not found' });
  }
  return snap.data() as CanvasScene;
}

// ── Router ────────────────────────────────────────────────────────────

export const canvasRouter = router({
  // ── Canvases ────────────────────────────────────────────────────

  list: publicProcedure
    .input(
      z.object({
        scope: z.enum(['mine', 'public']).default('mine'),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      let query = canvasesCol() as FirebaseFirestore.Query;
      if (input.scope === 'mine') {
        if (!ctx.user) {
          throw new TRPCError({
            code: 'UNAUTHORIZED',
            message: 'Sign in to view your canvases',
          });
        }
        query = query.where('ownerUid', '==', ctx.user.uid);
      } else {
        query = query.where('visibility', '==', 'public');
      }
      const snap = await query.orderBy('updatedAt', 'desc').limit(input.limit).get();
      return snap.docs.map((d) => d.data() as Canvas);
    }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input, ctx }) => {
    const snap = await canvasesCol().doc(input.id).get();
    if (!snap.exists) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Canvas not found' });
    }
    const canvas = snap.data() as Canvas;
    if (canvas.visibility === 'private' && canvas.ownerUid !== ctx.user?.uid) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'This canvas is private' });
    }
    return canvas;
  }),

  create: protectedProcedure.input(createCanvasSchema).mutation(async ({ input, ctx }) => {
    const id = randomUUID();
    const now = new Date();
    const doc: Canvas = {
      id,
      title: input.title,
      description: input.description,
      visibility: input.visibility,
      ownerUid: ctx.user.uid,
      ownerAddress: ctx.user.address,
      sceneCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const clean = Object.fromEntries(Object.entries(doc).filter(([, v]) => v !== undefined));
    await canvasesCol().doc(id).set(clean);
    return doc;
  }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertCanvasOwner(input.id, ctx.user.uid);
      // Cascade: delete all scenes for this canvas, then the canvas itself.
      const scenes = await canvasScenesCol().where('canvasId', '==', input.id).get();
      const batch = db!.batch();
      scenes.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(canvasesCol().doc(input.id));
      await batch.commit();
      return { ok: true };
    }),

  // ── Scenes (nodes on the canvas) ─────────────────────────────────

  listScenes: publicProcedure
    .input(z.object({ canvasId: z.string() }))
    .query(async ({ input, ctx }) => {
      // Visibility check via parent canvas.
      const cSnap = await canvasesCol().doc(input.canvasId).get();
      if (!cSnap.exists) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Canvas not found' });
      }
      const canvas = cSnap.data() as Canvas;
      if (canvas.visibility === 'private' && canvas.ownerUid !== ctx.user?.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'This canvas is private' });
      }
      const snap = await canvasScenesCol()
        .where('canvasId', '==', input.canvasId)
        .orderBy('createdAt', 'asc')
        .get();
      return snap.docs.map((d) => d.data() as CanvasScene);
    }),

  addScene: protectedProcedure.input(addSceneSchema).mutation(async ({ input, ctx }) => {
    const canvas = await assertCanvasOwner(input.canvasId, ctx.user.uid);
    if (input.parentId) {
      // Confirm parent belongs to this canvas
      const parent = await loadSceneOrThrow(input.parentId);
      if (parent.canvasId !== input.canvasId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'parentId must reference a scene on the same canvas',
        });
      }
    }
    const id = randomUUID();
    const now = new Date();
    const scene: CanvasScene = {
      id,
      canvasId: input.canvasId,
      parentId: input.parentId ?? null,
      position: input.position,
      bundle: input.bundle ?? {},
      createdAt: now,
      updatedAt: now,
    };
    const cleanScene = Object.fromEntries(Object.entries(scene).filter(([, v]) => v !== undefined));
    const batch = db!.batch();
    batch.set(canvasScenesCol().doc(id), cleanScene);
    batch.update(canvasesCol().doc(canvas.id), {
      sceneCount: (canvas.sceneCount || 0) + 1,
      updatedAt: now,
    });
    await batch.commit();
    return scene;
  }),

  updateScene: protectedProcedure.input(updateSceneSchema).mutation(async ({ input, ctx }) => {
    const scene = await loadSceneOrThrow(input.id);
    await assertCanvasOwner(scene.canvasId, ctx.user.uid);
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.position) patch.position = input.position;
    if (input.bundle) patch.bundle = { ...scene.bundle, ...input.bundle };
    if (input.generatedImageUrl !== undefined) patch.generatedImageUrl = input.generatedImageUrl;
    if (input.generatedVideoUrl !== undefined) patch.generatedVideoUrl = input.generatedVideoUrl;
    await canvasScenesCol().doc(input.id).update(patch);
    await canvasesCol().doc(scene.canvasId).update({ updatedAt: new Date() });
    return { ok: true };
  }),

  deleteScene: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const scene = await loadSceneOrThrow(input.id);
      const canvas = await assertCanvasOwner(scene.canvasId, ctx.user.uid);
      const batch = db!.batch();
      batch.delete(canvasScenesCol().doc(input.id));
      batch.update(canvasesCol().doc(canvas.id), {
        sceneCount: Math.max(0, (canvas.sceneCount || 1) - 1),
        updatedAt: new Date(),
      });
      await batch.commit();
      return { ok: true };
    }),
});
