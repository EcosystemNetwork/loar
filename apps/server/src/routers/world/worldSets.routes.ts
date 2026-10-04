/**
 * World sets — 3D stages built from a universe's canon (#4 set builder,
 * #7 explorable dioramas).
 *
 * A set is a splat environment (from a place entity) plus placed 3D assets
 * (entity models, puppets, parts kits isolated to one part), saved camera
 * angles, rendered shots, and hotspots that link into episodes for explore
 * mode. Stored in Firestore `worldSets`; universe managers edit, anyone who
 * can read the universe can view and explore.
 */
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { assertUniverseReadable } from '../../lib/universe-access';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { normalizeUniverseId } from '../../lib/universe-id';
import { assertSafeExternalUrl } from '../../lib/safe-fetch-url';

const MAX_OBJECTS = 60;
const MAX_CAMERAS = 24;
const MAX_SHOTS = 48;

const col = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('worldSets');
};

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

/** Asset URLs must be public http(s) — they are rendered by every viewer's browser. */
const assetUrl = z
  .string()
  .url()
  .max(2048)
  .refine((u) => {
    try {
      assertSafeExternalUrl(u);
      return true;
    } catch {
      return false;
    }
  }, 'Asset URL must be a public http(s) URL');

export const setObjectSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(120),
  entityId: z.string().max(128).nullable().optional(),
  url: assetUrl,
  /** Isolate one named node of a parts kit (tripo.segment output). */
  partName: z.string().max(200).nullable().optional(),
  position: vec3,
  rotationY: z.number().finite(),
  scale: z.number().positive().max(1000),
  /** Explore mode: clicking this object opens an episode / wiki page. */
  link: z
    .object({
      kind: z.enum(['episode', 'entity', 'url']),
      target: z.string().min(1).max(2048),
      label: z.string().max(120).optional(),
    })
    .nullable()
    .optional(),
  /** This object is the walkable player character in explore mode. */
  isPlayer: z.boolean().optional(),
  /** Animated puppet clips available on this object, keyed by name. */
  animations: z
    .array(z.object({ name: z.string().max(60), url: assetUrl }))
    .max(16)
    .optional(),
});

const cameraSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(80),
  position: vec3,
  target: vec3,
  fov: z.number().min(10).max(120),
});

const shotSchema = z.object({
  id: z.string().min(1).max(64),
  cameraId: z.string().max(64).nullable(),
  imageUrl: assetUrl,
  createdAt: z.string().max(40),
});

const environmentSchema = z
  .object({
    entityId: z.string().max(128).nullable(),
    splatUrl: assetUrl,
    format: z.string().max(10),
    /** Splat placement — Tripo splats are not metric, so let editors fit them. */
    position: vec3.default([0, 0, 0]),
    rotationY: z.number().finite().default(0),
    scale: z.number().positive().max(1000).default(1),
  })
  .nullable();

const setPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  environment: environmentSchema.optional(),
  objects: z.array(setObjectSchema).max(MAX_OBJECTS).optional(),
  cameras: z.array(cameraSchema).max(MAX_CAMERAS).optional(),
  shots: z.array(shotSchema).max(MAX_SHOTS).optional(),
  spawn: vec3.optional(),
  /** Listed on the universe's World tab for everyone to explore. */
  published: z.boolean().optional(),
});

export type WorldSetPatch = z.infer<typeof setPatchSchema>;

async function assertManager(universeId: string, address: string | undefined) {
  if (!address || !(await isUniverseAdmin(universeId, address))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only universe managers can edit sets',
    });
  }
}

function serialize(id: string, d: FirebaseFirestore.DocumentData) {
  const ts = (v: any) =>
    v?.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : null;
  return {
    id,
    universeId: d.universeId as string,
    name: (d.name ?? 'Untitled set') as string,
    description: (d.description ?? '') as string,
    environment: (d.environment ?? null) as z.infer<typeof environmentSchema>,
    objects: (d.objects ?? []) as z.infer<typeof setObjectSchema>[],
    cameras: (d.cameras ?? []) as z.infer<typeof cameraSchema>[],
    shots: (d.shots ?? []) as z.infer<typeof shotSchema>[],
    spawn: (d.spawn ?? [0, 0, 4]) as [number, number, number],
    published: !!d.published,
    createdBy: (d.createdBy ?? null) as string | null,
    createdAt: ts(d.createdAt),
    updatedAt: ts(d.updatedAt),
  };
}

export type WorldSet = ReturnType<typeof serialize>;

export const worldSetsRouter = router({
  /** Sets in a universe. Managers see drafts; everyone else only published sets. */
  list: publicProcedure
    .input(z.object({ universeId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      await assertUniverseReadable(input.universeId, ctx.user ?? null);
      const universeId = normalizeUniverseId(input.universeId);
      const snap = await col().where('universeId', '==', universeId).limit(100).get();
      const manager = ctx.user?.address
        ? await isUniverseAdmin(universeId, ctx.user.address)
        : false;
      return snap.docs
        .map((d) => serialize(d.id, d.data()))
        .filter((s) => manager || s.published)
        .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    }),

  get: publicProcedure
    .input(z.object({ setId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const doc = await col().doc(input.setId).get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Set not found' });
      const set = serialize(doc.id, doc.data()!);
      await assertUniverseReadable(set.universeId, ctx.user ?? null);
      const canEdit = ctx.user?.address
        ? await isUniverseAdmin(set.universeId, ctx.user.address)
        : false;
      if (!set.published && !canEdit) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Set not found' });
      }
      return { set, canEdit };
    }),

  create: protectedProcedure
    .input(
      z.object({
        universeId: z.string().min(1),
        name: z.string().min(1).max(120),
        environment: environmentSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = normalizeUniverseId(input.universeId);
      await assertManager(universeId, ctx.user.address);
      const id = randomUUID();
      const now = new Date();
      await col()
        .doc(id)
        .set({
          universeId,
          name: input.name,
          description: '',
          environment: input.environment ?? null,
          objects: [],
          cameras: [],
          shots: [],
          spawn: [0, 0, 4],
          published: false,
          createdBy: ctx.user.address ?? ctx.user.uid,
          createdAt: now,
          updatedAt: now,
        });
      return { setId: id };
    }),

  update: protectedProcedure
    .input(z.object({ setId: z.string().min(1), patch: setPatchSchema }))
    .mutation(async ({ input, ctx }) => {
      const ref = col().doc(input.setId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Set not found' });
      await assertManager(doc.data()!.universeId, ctx.user.address);
      const players = input.patch.objects?.filter((o) => o.isPlayer).length ?? 0;
      if (players > 1) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only one player object per set' });
      }
      await ref.update({ ...input.patch, updatedAt: new Date() });
      return serialize(doc.id, { ...doc.data(), ...input.patch, updatedAt: new Date() });
    }),

  delete: protectedProcedure
    .input(z.object({ setId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const ref = col().doc(input.setId);
      const doc = await ref.get();
      if (!doc.exists) return { success: true };
      await assertManager(doc.data()!.universeId, ctx.user.address);
      await ref.delete();
      return { success: true };
    }),
});
