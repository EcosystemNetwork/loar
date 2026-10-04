/**
 * Tripo world-building router — turns a universe's wiki canon into 3D.
 *
 *   tripo.entityTo3D        entity cover art → textured 3D model on the wiki
 *   tripo.batchEntityTo3D   same, for every modelable entity still missing one
 *   tripo.characterPuppet   character → T-pose → turnaround → body → rig →
 *                           motion library; turnaround feeds the entity's
 *                           reference bundle so video generation stays on-model
 *   tripo.segment           model → named-parts kit (kitbashing library)
 *   tripo.restyle           re-texture a model in the universe's canon style
 *   tripo.stylize           lego / voxel / minecraft variants
 *   tripo.convert           FBX / USDZ / OBJ / STL export (game engines, AR)
 *   tripo.placeEnvironment  place art → Gaussian-splat environment for sets
 *   tripo.getJob / listJobs poll + history
 *   tripo.worldOverview     public: a universe's 3D coverage for the World tab
 *
 * BYOK only — every dispatch spends the caller's own Tripo key (resolved up
 * front so a missing key is a clean FORBIDDEN with the "add a key" modal).
 * Pipelines live in services/tripo-world/.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  router,
  protectedProcedure,
  publicProcedure,
  requirePermission,
  expensiveProcedure,
} from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { assertSafeExternalUrl } from '../../lib/safe-fetch-url';
import { assertUniverseReadable } from '../../lib/universe-access';
import { normalizeUniverseId } from '../../lib/universe-id';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { NoKeyAvailableError } from '../../services/provider-keys/types';
import { canManageEntity, getEntitiesByUniverse, getEntity } from '../entities/entities.handlers';
import type { Entity } from '../entities/entities.types';
import { startTripoJob, threeDGenCol, type TripoJobKind } from '../../services/tripo-world/runner';
import {
  PUPPET_DEFAULT_ANIMATIONS,
  characterPuppetPipeline,
  convertPipeline,
  entityModelPipeline,
  placeSplatPipeline,
  restylePipeline,
  segmentPipeline,
  stylizePipeline,
  type EntityRef,
  type ModelSource,
} from '../../services/tripo-world/pipelines';
import type { TripoAnimation, TripoRigType } from '../../services/tripo3d';

/** Kinds that read as a physical object/creature and make a sensible mesh. */
export const MODELABLE_KINDS = ['person', 'species', 'thing', 'vehicle', 'technology'] as const;
/** Kinds that read as a location and become a splat environment. */
export const ENVIRONMENT_KINDS = ['place', 'realm', 'plane', 'dimension'] as const;
/** Kinds that can be rigged into a puppet. */
const PUPPET_KINDS = ['person', 'species', 'vehicle'] as const;

const RIG_TYPES = [
  'biped',
  'quadruped',
  'hexapod',
  'octopod',
  'avian',
  'serpentine',
  'aquatic',
] as const;

const PUPPET_ANIMATIONS = [
  'preset:idle',
  'preset:walk',
  'preset:run',
  'preset:jump',
  'preset:turn',
  'preset:climb',
  'preset:slash',
  'preset:shoot',
  'preset:hurt',
  'preset:fall',
  'preset:dive',
  'preset:quadruped:walk',
  'preset:hexapod:walk',
  'preset:octopod:walk',
  'preset:serpentine:march',
  'preset:aquatic:march',
] as const satisfies readonly TripoAnimation[];

const BATCH_MAX = 10;

// ── Helpers ──────────────────────────────────────────────────────────────

async function requireTripoKey(uid: string): Promise<string> {
  const { resolveProviderKey } = await import('../../lib/byok');
  const key = await resolveProviderKey(uid, 'tripo');
  if (!key) {
    const cause = new NoKeyAvailableError(
      'tripo',
      'Add your Tripo3D API key at /settings/api-keys to build 3D worlds.'
    );
    throw new TRPCError({ code: 'FORBIDDEN', message: cause.message, cause });
  }
  return key;
}

function safeUrl(url: string): string {
  try {
    assertSafeExternalUrl(url);
    return url;
  } catch (err) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: err instanceof Error ? err.message : 'URL rejected',
    });
  }
}

function toRef(e: Entity): EntityRef {
  return { id: e.id, name: e.name, kind: e.kind, universeId: e.universeAddress ?? null };
}

async function loadManagedEntity(entityId: string, address: string | undefined): Promise<Entity> {
  const entity = await getEntity(entityId);
  if (!entity) throw new TRPCError({ code: 'NOT_FOUND', message: 'Entity not found' });
  if (!(await canManageEntity(entity, address))) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only the entity creator or a universe manager can build its 3D assets',
    });
  }
  return entity;
}

function meta(e: Entity): Record<string, any> {
  return (e.metadata ?? {}) as Record<string, any>;
}

/** The best existing GLB for an entity: puppet body → Tripo model → legacy. */
export function entityModelUrl(e: Pick<Entity, 'metadata'>): string | null {
  const m = (e.metadata ?? {}) as Record<string, any>;
  return m.puppet?.modelUrl ?? m.model3d?.glbUrl ?? m.modelUrl ?? null;
}

const sourceSchema = z
  .object({ contentId: z.string().min(1).optional(), entityId: z.string().min(1).optional() })
  .refine((s) => !!s.contentId !== !!s.entityId, 'Pass exactly one of contentId / entityId');

async function resolveModelSource(
  src: { contentId?: string; entityId?: string },
  user: { uid: string; address?: string }
): Promise<ModelSource> {
  if (src.entityId) {
    const entity = await loadManagedEntity(src.entityId, user.address);
    const url = entityModelUrl(entity);
    if (!url) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This entity has no 3D model yet — generate one first',
      });
    }
    return {
      url,
      title: entity.name,
      universeId: entity.universeAddress ?? null,
      parentGenerationId: null,
      entity: toRef(entity),
    };
  }
  const doc = await db.collection('content').doc(src.contentId!).get();
  if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Content not found' });
  const c = doc.data()!;
  if (c.mediaType !== '3d' || !c.mediaUrl) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only 3D gallery items can be used' });
  }
  if (c.creatorUid && c.creatorUid !== user.uid) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the creator can modify this model' });
  }
  return {
    url: c.mediaUrl as string,
    title: (c.title as string | undefined) ?? '3D model',
    universeId: (c.universeId as string | null | undefined) ?? null,
    parentGenerationId: (c.generationId as string | null | undefined) ?? null,
    entity: null,
  };
}

/** The universe's canon style pack, flattened to a texture prompt. */
async function canonTextureStyle(
  universeId: string
): Promise<{ text?: string; styleImageUrl?: string; label: string } | null> {
  const uni = await db.collection('cinematicUniverses').doc(normalizeUniverseId(universeId)).get();
  const packId = uni.data()?.canonStylePackEntityId as string | undefined;
  if (!packId) return null;
  const pack = await getEntity(packId);
  if (!pack) return null;
  const m = meta(pack);
  const keywords = Array.isArray(m.styleKeywords) ? m.styleKeywords.join(', ') : '';
  const text = [m.stylePrompt, keywords].filter(Boolean).join('. ') || undefined;
  const styleImageUrl = (m.referenceImages?.[0]?.url as string | undefined) ?? undefined;
  if (!text && !styleImageUrl) return null;
  return { text, styleImageUrl, label: pack.name || 'canon style' };
}

function startJob(
  kind: TripoJobKind,
  uid: string,
  apiKey: string,
  run: Parameters<typeof startTripoJob>[0]['run'],
  extra: {
    universeId?: string | null;
    entityId?: string | null;
    sourceContentId?: string | null;
    meta?: Record<string, unknown>;
  } = {}
) {
  return startTripoJob({ kind, userId: uid, apiKey, run, ...extra });
}

const gen = expensiveProcedure.use(requirePermission('generation.3d'));

// ── Router ───────────────────────────────────────────────────────────────

export const tripoRouter = router({
  /** #1 — wiki entity art → 3D model on the entity page. */
  entityTo3D: gen
    .input(
      z.object({
        entityId: z.string().min(1),
        quality: z.enum(['hifi', 'game']).default('hifi'),
        /** Override the source art (defaults to the entity cover). */
        imageUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await loadManagedEntity(input.entityId, ctx.user.address);
      const imageUrl = safeUrl(input.imageUrl ?? entity.imageUrl ?? '');
      const apiKey = await requireTripoKey(ctx.user.uid);
      return startJob(
        'entity_model',
        ctx.user.uid,
        apiKey,
        entityModelPipeline({ entity: toRef(entity), imageUrl, quality: input.quality }),
        {
          entityId: entity.id,
          universeId: entity.universeAddress,
          meta: { quality: input.quality },
        }
      );
    }),

  /**
   * #1 at universe scale — queue entityTo3D for modelable entities that have
   * cover art but no model yet. Universe managers only; capped per call.
   */
  batchEntityTo3D: gen
    .input(
      z.object({
        universeId: z.string().min(1),
        quality: z.enum(['hifi', 'game']).default('hifi'),
        limit: z.number().int().min(1).max(BATCH_MAX).default(5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!(await isUniverseAdmin(input.universeId, ctx.user.address ?? ''))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Universe managers only' });
      }
      const apiKey = await requireTripoKey(ctx.user.uid);
      const { entities } = await getEntitiesByUniverse(input.universeId, undefined, 500);
      const pending = entities.filter(
        (e) =>
          (MODELABLE_KINDS as readonly string[]).includes(e.kind) &&
          !!e.imageUrl &&
          !entityModelUrl(e)
      );
      const jobs: Array<{ entityId: string; jobId: string }> = [];
      for (const e of pending.slice(0, input.limit)) {
        let imageUrl: string;
        try {
          imageUrl = safeUrl(e.imageUrl!);
        } catch {
          continue;
        }
        const { jobId } = await startJob(
          'entity_model',
          ctx.user.uid,
          apiKey,
          entityModelPipeline({ entity: toRef(e), imageUrl, quality: input.quality }),
          {
            entityId: e.id,
            universeId: e.universeAddress,
            meta: { quality: input.quality, batch: true },
          }
        );
        jobs.push({ entityId: e.id, jobId });
      }
      return { jobs, remaining: Math.max(0, pending.length - jobs.length) };
    }),

  /** #2 — character puppet: turnaround refs + rigged, animated body. */
  characterPuppet: gen
    .input(
      z.object({
        entityId: z.string().min(1),
        rigType: z.enum(RIG_TYPES).default('biped'),
        animations: z.array(z.enum(PUPPET_ANIMATIONS)).max(8).optional(),
        imageUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await loadManagedEntity(input.entityId, ctx.user.address);
      if (!(PUPPET_KINDS as readonly string[]).includes(entity.kind)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Puppets can be built for characters, species and vehicles',
        });
      }
      const imageUrl = safeUrl(input.imageUrl ?? entity.imageUrl ?? '');
      const apiKey = await requireTripoKey(ctx.user.uid);
      const animations =
        input.animations ??
        (input.rigType === 'biped'
          ? PUPPET_DEFAULT_ANIMATIONS
          : (['preset:idle', defaultGait(input.rigType)] as TripoAnimation[]));
      return startJob(
        'character_puppet',
        ctx.user.uid,
        apiKey,
        characterPuppetPipeline({
          entity: toRef(entity),
          imageUrl,
          rigType: input.rigType as TripoRigType,
          animations,
          tPose: input.rigType === 'biped',
        }),
        {
          entityId: entity.id,
          universeId: entity.universeAddress,
          meta: { rigType: input.rigType },
        }
      );
    }),

  /** #3 — split a model into a named-parts kit. */
  segment: gen
    .input(
      z.object({
        source: sourceSchema,
        granularity: z.enum(['simple', 'balanced', 'detailed']).default('balanced'),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const source = await resolveModelSource(input.source, ctx.user);
      const apiKey = await requireTripoKey(ctx.user.uid);
      return startJob(
        'segment',
        ctx.user.uid,
        apiKey,
        segmentPipeline({ source, granularity: input.granularity }),
        {
          entityId: source.entity?.id,
          universeId: source.universeId,
          sourceContentId: input.source.contentId,
        }
      );
    }),

  /** #6 — re-texture in the universe's canon style (or a custom prompt). */
  restyle: gen
    .input(
      z.object({
        source: sourceSchema,
        text: z.string().max(1024).optional(),
        styleImageUrl: z.string().url().optional(),
        /** Use the universe's canon style pack when no prompt/image is given. */
        useCanonStyle: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const source = await resolveModelSource(input.source, ctx.user);
      let style: { text?: string; styleImageUrl?: string; label: string } | null =
        input.text || input.styleImageUrl
          ? {
              text: input.text,
              styleImageUrl: input.styleImageUrl ? safeUrl(input.styleImageUrl) : undefined,
              label: 'restyled',
            }
          : null;
      if (!style && input.useCanonStyle && source.universeId) {
        style = await canonTextureStyle(source.universeId);
      }
      if (!style) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Give a style prompt or image, or set a canon style pack for this universe',
        });
      }
      const apiKey = await requireTripoKey(ctx.user.uid);
      return startJob('restyle', ctx.user.uid, apiKey, restylePipeline({ source, ...style }), {
        entityId: source.entity?.id,
        universeId: source.universeId,
        sourceContentId: input.source.contentId,
      });
    }),

  /** #6 — playful stylisations (merch, minigames). */
  stylize: gen
    .input(
      z.object({ source: sourceSchema, style: z.enum(['lego', 'voxel', 'voronoi', 'minecraft']) })
    )
    .mutation(async ({ input, ctx }) => {
      const source = await resolveModelSource(input.source, ctx.user);
      const apiKey = await requireTripoKey(ctx.user.uid);
      return startJob(
        'stylize',
        ctx.user.uid,
        apiKey,
        stylizePipeline({ source, style: input.style }),
        {
          entityId: source.entity?.id,
          universeId: source.universeId,
          sourceContentId: input.source.contentId,
        }
      );
    }),

  /** #5 — export for game engines, 3D printing and iOS AR. */
  convert: gen
    .input(
      z.object({
        source: sourceSchema,
        format: z.enum(['USDZ', 'FBX', 'OBJ', 'STL', '3MF', 'GLTF']),
        quad: z.boolean().default(false),
        faceLimit: z.number().int().min(1000).max(500_000).optional(),
        fbxPreset: z.enum(['blender', '3dsmax', 'mixamo']).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const source = await resolveModelSource(input.source, ctx.user);
      const apiKey = await requireTripoKey(ctx.user.uid);
      return startJob(
        'convert',
        ctx.user.uid,
        apiKey,
        convertPipeline({
          source,
          format: input.format,
          quad: input.quad,
          faceLimit: input.faceLimit,
          fbxPreset: input.fbxPreset,
        }),
        {
          entityId: source.entity?.id,
          universeId: source.universeId,
          sourceContentId: input.source.contentId,
          meta: { format: input.format },
        }
      );
    }),

  /** #4 / #7 — a place's art → explorable splat environment. */
  placeEnvironment: gen
    .input(z.object({ entityId: z.string().min(1), imageUrl: z.string().url().optional() }))
    .mutation(async ({ input, ctx }) => {
      const entity = await loadManagedEntity(input.entityId, ctx.user.address);
      if (!(ENVIRONMENT_KINDS as readonly string[]).includes(entity.kind)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Environments are built from places' });
      }
      const imageUrl = safeUrl(input.imageUrl ?? entity.imageUrl ?? '');
      const apiKey = await requireTripoKey(ctx.user.uid);
      return startJob(
        'place_splat',
        ctx.user.uid,
        apiKey,
        placeSplatPipeline({ entity: toRef(entity), imageUrl }),
        {
          entityId: entity.id,
          universeId: entity.universeAddress,
        }
      );
    }),

  getJob: protectedProcedure
    .input(z.object({ jobId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const doc = await threeDGenCol().doc(input.jobId).get();
      if (!doc.exists) return null;
      const d = doc.data()!;
      if (d.userId !== ctx.user.uid || d.provider !== 'tripo') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
      }
      return serializeJob(doc.id, d);
    }),

  /** The caller's Tripo jobs, newest first — optionally for one entity/universe. */
  listJobs: protectedProcedure
    .input(
      z.object({
        entityId: z.string().optional(),
        universeId: z.string().optional(),
        limit: z.number().int().min(1).max(50).default(20),
      })
    )
    .query(async ({ input, ctx }) => {
      // userId+createdAt is an existing index (threed.history); filter the rest in memory.
      const snap = await threeDGenCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(300)
        .get();
      return snap.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .filter(({ data }) => data.provider === 'tripo')
        .filter(({ data }) => !input.entityId || data.entityId === input.entityId)
        .filter(
          ({ data }) =>
            !input.universeId ||
            normalizeUniverseId(String(data.universeId ?? '')) ===
              normalizeUniverseId(input.universeId)
        )
        .slice(0, input.limit)
        .map(({ id, data }) => serializeJob(id, data));
    }),

  /**
   * Public: a universe's 3D coverage — every modelable/environment entity
   * with whatever 3D it has. Drives the wiki World tab and the set builder's
   * asset shelf.
   */
  worldOverview: publicProcedure
    .input(z.object({ universeId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      await assertUniverseReadable(input.universeId, ctx.user ?? null);
      const { entities } = await getEntitiesByUniverse(input.universeId, undefined, 500);
      const relevant = new Set<string>([...MODELABLE_KINDS, ...ENVIRONMENT_KINDS]);
      return entities
        .filter((e) => relevant.has(e.kind))
        .map((e) => {
          const m = meta(e);
          return {
            id: e.id,
            name: e.name,
            kind: e.kind,
            imageUrl: e.imageUrl ?? null,
            modelUrl: entityModelUrl(e),
            thumbnailUrl: (m.model3d?.thumbnailUrl ?? m.puppet?.thumbnailUrl ?? null) as
              | string
              | null,
            usdzUrl: (m.usdzUrl ?? null) as string | null,
            puppet: m.puppet?.riggedModelUrl
              ? {
                  riggedModelUrl: m.puppet.riggedModelUrl as string,
                  rigType: m.puppet.rigType as string,
                  animations: (m.puppet.animations ?? []) as Array<{
                    preset: string;
                    name: string;
                    url: string;
                  }>,
                  turnaround: (m.puppet.turnaround ?? {}) as Record<string, string>,
                }
              : null,
            environment: m.environment?.splatUrl
              ? {
                  splatUrl: m.environment.splatUrl as string,
                  format: m.environment.format as string,
                }
              : null,
          };
        });
    }),
});

function defaultGait(rig: (typeof RIG_TYPES)[number]): TripoAnimation {
  switch (rig) {
    case 'quadruped':
      return 'preset:quadruped:walk';
    case 'hexapod':
      return 'preset:hexapod:walk';
    case 'octopod':
      return 'preset:octopod:walk';
    case 'serpentine':
      return 'preset:serpentine:march';
    case 'aquatic':
      return 'preset:aquatic:march';
    default:
      return 'preset:walk';
  }
}

function serializeJob(id: string, d: FirebaseFirestore.DocumentData) {
  const ts = (v: any) =>
    v?.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : null;
  return {
    id,
    kind: d.kind as TripoJobKind,
    status: d.status as 'running' | 'completed' | 'failed',
    steps: (d.steps ?? []) as Array<{ name: string; status: string; progress?: number }>,
    entityId: (d.entityId ?? null) as string | null,
    universeId: (d.universeId ?? null) as string | null,
    partial: (d.partial ?? null) as Record<string, unknown> | null,
    result: (d.result ?? null) as Record<string, any> | null,
    failureReason: (d.failureReason ?? null) as string | null,
    createdAt: ts(d.createdAt),
    completedAt: ts(d.completedAt),
  };
}
