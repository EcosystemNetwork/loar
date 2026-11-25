/**
 * Tripo world-building router — turns a universe's wiki canon into 3D.
 *
 *   tripo.entityTo3D        entity cover art → textured 3D model on the wiki
 *   tripo.batchEntityTo3D   same, for the picked entities still missing one
 *   tripo.rigEntityModel    skeleton + motion clips on the model an entity already has
 *   tripo.animateCharacter  add more motion clips to a character that is already rigged
 *   tripo.animationCatalog  the motion presets each skeleton type accepts
 *   tripo.batchRigModels    same, for the picked riggable entities with a model but no rig
 *   tripo.characterPuppet   character → T-pose → turnaround → body → rig →
 *                           motion library; turnaround feeds the entity's
 *                           reference bundle so video generation stays on-model
 *   tripo.segment           model → named-parts kit (kitbashing library)
 *   tripo.restyle           re-texture a model in the universe's canon style
 *   tripo.stylize           lego / voxel / minecraft variants
 *   tripo.convert           FBX / USDZ / OBJ / STL export (game engines, AR)
 *   tripo.placeEnvironment  place art → Gaussian-splat environment for sets
 *   tripo.getJob / listJobs poll + history
 *   tripo.retryJob          re-run a failed job (finished steps are replayed, not re-billed)
 *   tripo.optimizeWebModels web copies for models made before optimisation (CPU only)
 *   tripo.buildPlan         managers: where the story uses each entity (drives the build/rig pickers)
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
import {
  retryTripoJob,
  startTripoJob,
  threeDGenCol,
  type TripoJobKind,
  type TripoJobStatus,
} from '../../services/tripo-world/runner';
import {
  PUPPET_DEFAULT_ANIMATIONS,
  backfillEntityWebModels,
  type CharacterPuppetArgs,
  type ConvertArgs,
  type EntityModelArgs,
  type EntityRef,
  type ModelSource,
  type PlaceSplatArgs,
  type AnimateModelArgs,
  type RigModelArgs,
  type RestyleArgs,
  type SegmentArgs,
  type StylizeArgs,
} from '../../services/tripo-world/pipelines';
import { webOptimizeUrl } from '../../services/tripo-world/optimize';
import { entityUsage, type SetUsageSource } from '../../services/tripo-world/build-plan';
import {
  TRIPO_BIPED_CLIPS,
  TRIPO_BIPED_LIBRARY,
  type TripoAnimation,
  type TripoRigType,
} from '../../services/tripo3d';

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

/** Every preset a request may name: the basics above + the biped library. */
const ANIMATION_IDS = [...PUPPET_ANIMATIONS, ...TRIPO_BIPED_CLIPS] as [
  TripoAnimation,
  ...TripoAnimation[],
];
const animationSchema = z.enum(ANIMATION_IDS);
/** Per request; the pipelines split these into Tripo's 5-per-task batches. */
const MAX_ANIMATIONS_PER_JOB = 10;

/** Gait clip per non-biped skeleton (Tripo has one motion for each). */
const NON_BIPED_GAITS: Partial<Record<TripoRigType, TripoAnimation>> = {
  quadruped: 'preset:quadruped:walk',
  hexapod: 'preset:hexapod:walk',
  octopod: 'preset:octopod:walk',
  serpentine: 'preset:serpentine:march',
  aquatic: 'preset:aquatic:march',
};

const BIPED_BASICS = PUPPET_ANIMATIONS.filter((a) => a.split(':').length === 2);

/** Presets a skeleton type accepts, grouped for pickers. */
export function animationCatalogFor(
  rigType: string
): Array<{ group: string; presets: TripoAnimation[] }> {
  if (rigType === 'biped') {
    return [
      { group: 'Basics', presets: [...BIPED_BASICS] },
      ...Object.entries(TRIPO_BIPED_LIBRARY).map(([group, presets]) => ({
        group,
        presets: [...presets] as TripoAnimation[],
      })),
    ];
  }
  const gait = NON_BIPED_GAITS[rigType as TripoRigType];
  return gait ? [{ group: 'Basics', presets: [gait] }] : [];
}

/** Presets in `wanted` the skeleton type can't play. */
function unsupportedAnimations(rigType: string, wanted: readonly string[]): string[] {
  const ok = new Set(animationCatalogFor(rigType).flatMap((g) => g.presets as string[]));
  return wanted.filter((a) => !ok.has(a));
}

const BATCH_MAX = 50;

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

/** Web-delivery copy of `entityModelUrl` (same precedence), when one exists. */
export function entityWebModelUrl(e: Pick<Entity, 'metadata'>): string | null {
  const m = (e.metadata ?? {}) as Record<string, any>;
  if (m.puppet?.modelUrl) return m.puppet.webModelUrl ?? null;
  if (m.model3d?.glbUrl) return m.model3d.webGlbUrl ?? null;
  return null;
}

/** Entity ids with a queued/running Tripo job of `kind` for this user. */
async function entitiesWithActiveJobs(uid: string, kind: TripoJobKind): Promise<Set<string>> {
  const snaps = await Promise.all(
    (['queued', 'running'] as const).map((status) =>
      threeDGenCol().where('userId', '==', uid).where('status', '==', status).limit(300).get()
    )
  );
  const ids = new Set<string>();
  for (const doc of snaps.flatMap((s) => s.docs)) {
    const d = doc.data();
    if (d.provider === 'tripo' && d.kind === kind && d.entityId) ids.add(d.entityId);
  }
  return ids;
}

/** Universes with a web-copy backfill in flight (per process). */
const optimizingUniverses = new Set<string>();

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
    // Web copies are meshopt-compressed — Tripo edits start from the original.
    url: (c.sourceMediaUrl ?? c.mediaUrl) as string,
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
  /** Serialisable pipeline args — stored on the job so it can resume/retry. */
  args: object,
  extra: {
    universeId?: string | null;
    entityId?: string | null;
    sourceContentId?: string | null;
    meta?: Record<string, unknown>;
  } = {}
) {
  return startTripoJob({
    kind,
    userId: uid,
    apiKey,
    args: args as Record<string, unknown>,
    ...extra,
  });
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
        { entity: toRef(entity), imageUrl, quality: input.quality } satisfies EntityModelArgs,
        {
          entityId: entity.id,
          universeId: entity.universeAddress,
          meta: { quality: input.quality },
        }
      );
    }),

  /**
   * #1 at universe scale — queue entityTo3D for the modelable entities the
   * manager picked (entityIds, chosen in the World tab's build picker from
   * buildPlan's usage signals) that have cover art but no model; places among
   * them get a splat when includeEnvironments is set. Without entityIds every
   * eligible entity is queued (backfill scripts only — the UI always picks).
   * Entities that already have a job in flight are skipped, so pressing it
   * twice never double-spends. Jobs queue and run MAX_ACTIVE_PER_USER at a
   * time. Universe managers only.
   */
  batchEntityTo3D: gen
    .input(
      z.object({
        universeId: z.string().min(1),
        quality: z.enum(['hifi', 'game']).default('hifi'),
        limit: z.number().int().min(1).max(BATCH_MAX).default(BATCH_MAX),
        includeEnvironments: z.boolean().default(false),
        entityIds: z.array(z.string().min(1)).min(1).max(BATCH_MAX).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!(await isUniverseAdmin(input.universeId, ctx.user.address ?? ''))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Universe managers only' });
      }
      const apiKey = await requireTripoKey(ctx.user.uid);
      const entities = pickEntities(
        (await getEntitiesByUniverse(input.universeId, undefined, 500)).entities,
        input.entityIds
      );
      const [busyModels, busyEnvs] = await Promise.all([
        entitiesWithActiveJobs(ctx.user.uid, 'entity_model'),
        input.includeEnvironments
          ? entitiesWithActiveJobs(ctx.user.uid, 'place_splat')
          : Promise.resolve(new Set<string>()),
      ]);
      const pendingModels = entities.filter(
        (e) =>
          (MODELABLE_KINDS as readonly string[]).includes(e.kind) &&
          !!e.imageUrl &&
          !entityModelUrl(e) &&
          !busyModels.has(e.id)
      );
      const pendingEnvs = input.includeEnvironments
        ? entities.filter(
            (e) =>
              (ENVIRONMENT_KINDS as readonly string[]).includes(e.kind) &&
              !!e.imageUrl &&
              !meta(e).environment?.splatUrl &&
              !busyEnvs.has(e.id)
          )
        : [];
      const pending = [
        ...pendingModels.map((e) => ({ e, kind: 'entity_model' as const })),
        ...pendingEnvs.map((e) => ({ e, kind: 'place_splat' as const })),
      ];

      const jobs: Array<{ entityId: string; jobId: string; kind: TripoJobKind }> = [];
      for (const { e, kind } of pending.slice(0, input.limit)) {
        let imageUrl: string;
        try {
          imageUrl = safeUrl(e.imageUrl!);
        } catch {
          continue;
        }
        const { jobId } =
          kind === 'entity_model'
            ? await startJob(
                kind,
                ctx.user.uid,
                apiKey,
                {
                  entity: toRef(e),
                  imageUrl,
                  quality: input.quality,
                } satisfies EntityModelArgs,
                {
                  entityId: e.id,
                  universeId: e.universeAddress,
                  meta: { quality: input.quality, batch: true },
                }
              )
            : await startJob(
                kind,
                ctx.user.uid,
                apiKey,
                { entity: toRef(e), imageUrl } satisfies PlaceSplatArgs,
                { entityId: e.id, universeId: e.universeAddress, meta: { batch: true } }
              );
        jobs.push({ entityId: e.id, jobId, kind });
      }
      return {
        jobs,
        remaining: Math.max(0, pending.length - jobs.length),
        skippedInFlight: busyModels.size + busyEnvs.size,
      };
    }),

  /** #2 — character puppet: turnaround refs + rigged, animated body. */
  characterPuppet: gen
    .input(
      z.object({
        entityId: z.string().min(1),
        rigType: z.enum(RIG_TYPES).default('biped'),
        animations: z.array(animationSchema).min(1).max(MAX_ANIMATIONS_PER_JOB).optional(),
        imageUrl: z.string().url().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await loadManagedEntity(input.entityId, ctx.user.address);
      assertPuppetKind(entity.kind);
      const imageUrl = safeUrl(input.imageUrl ?? entity.imageUrl ?? '');
      const apiKey = await requireTripoKey(ctx.user.uid);
      if (input.animations) assertAnimationsFit(input.rigType, input.animations);
      const animations =
        input.animations ??
        (input.rigType === 'biped'
          ? PUPPET_DEFAULT_ANIMATIONS
          : (['preset:idle', defaultGait(input.rigType)] as TripoAnimation[]));
      return startJob(
        'character_puppet',
        ctx.user.uid,
        apiKey,
        {
          entity: toRef(entity),
          imageUrl,
          rigType: input.rigType as TripoRigType,
          animations,
          tPose: input.rigType === 'biped',
        } satisfies CharacterPuppetArgs,
        {
          entityId: entity.id,
          universeId: entity.universeAddress,
          meta: { rigType: input.rigType },
        }
      );
    }),

  /**
   * #2b — rig the model the entity already has (no body regeneration, unlike
   * characterPuppet). `auto` lets Tripo's rig-check pick the skeleton.
   */
  rigEntityModel: gen
    .input(
      z.object({
        entityId: z.string().min(1),
        rigType: z.enum(['auto', ...RIG_TYPES]).default('auto'),
        animations: z.array(animationSchema).min(1).max(MAX_ANIMATIONS_PER_JOB).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await loadManagedEntity(input.entityId, ctx.user.address);
      assertPuppetKind(entity.kind);
      const modelUrl = entityModelUrl(entity);
      if (!modelUrl) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This entity has no 3D model yet — generate one first',
        });
      }
      if (input.animations && input.rigType !== 'auto') {
        assertAnimationsFit(input.rigType, input.animations);
      }
      const apiKey = await requireTripoKey(ctx.user.uid);
      return startJob(
        'rig_model',
        ctx.user.uid,
        apiKey,
        {
          entity: toRef(entity),
          modelUrl,
          rigType: input.rigType,
          animations: input.animations,
        } satisfies RigModelArgs,
        {
          entityId: entity.id,
          universeId: entity.universeAddress,
          meta: { rigType: input.rigType },
        }
      );
    }),

  /**
   * #2c — add motion clips to a character that is already rigged. Clips merge
   * into the puppet's motion library (same preset = replaced). One job per
   * character at a time so concurrent merges can't drop clips.
   */
  animateCharacter: gen
    .input(
      z.object({
        entityId: z.string().min(1),
        animations: z.array(animationSchema).min(1).max(MAX_ANIMATIONS_PER_JOB),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await loadManagedEntity(input.entityId, ctx.user.address);
      assertPuppetKind(entity.kind);
      const puppet = meta(entity).puppet as Record<string, any> | undefined;
      const rigType = puppet?.rigType as TripoRigType | undefined;
      if (!puppet?.riggedModelUrl || !rigType) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Rig this character first — animations play on its skeleton',
        });
      }
      assertAnimationsFit(rigType, input.animations);
      // Re-rig source if the stored rig task is gone: the unrigged body.
      const modelUrl = (puppet.riggedFrom ?? puppet.modelUrl ?? entityModelUrl(entity)) as
        | string
        | null;
      if (!modelUrl) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This character has no 3D body' });
      }
      const busy = await entitiesWithActiveJobs(ctx.user.uid, 'animate_model');
      if (busy.has(entity.id)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Animations are already being added to this character — wait for that job',
        });
      }
      const rigTaskId =
        (puppet.rigTaskId as string | undefined) ??
        (await rigTaskFromJob(puppet.jobId as string | undefined));
      const animations = [...new Set(input.animations)];
      const apiKey = await requireTripoKey(ctx.user.uid);
      return startJob(
        'animate_model',
        ctx.user.uid,
        apiKey,
        {
          entity: toRef(entity),
          rigTaskId,
          modelUrl,
          rigType,
          animations,
        } satisfies AnimateModelArgs,
        {
          entityId: entity.id,
          universeId: entity.universeAddress,
          meta: { rigType, clips: animations.length },
        }
      );
    }),

  /** The motion presets each skeleton type accepts (drives the studio's picker). */
  animationCatalog: publicProcedure
    .input(z.object({ rigType: z.enum(RIG_TYPES) }))
    .query(({ input }) => ({
      rigType: input.rigType,
      maxPerJob: MAX_ANIMATIONS_PER_JOB,
      groups: animationCatalogFor(input.rigType),
    })),

  /**
   * #2b at universe scale — rig the picked characters/species/vehicles
   * (entityIds; all eligible when omitted) that have a model but no rig yet.
   * Same in-flight skip + queueing as batchEntityTo3D.
   */
  batchRigModels: gen
    .input(
      z.object({
        universeId: z.string().min(1),
        rigType: z.enum(['auto', ...RIG_TYPES]).default('auto'),
        limit: z.number().int().min(1).max(BATCH_MAX).default(BATCH_MAX),
        entityIds: z.array(z.string().min(1)).min(1).max(BATCH_MAX).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!(await isUniverseAdmin(input.universeId, ctx.user.address ?? ''))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Universe managers only' });
      }
      const apiKey = await requireTripoKey(ctx.user.uid);
      const entities = pickEntities(
        (await getEntitiesByUniverse(input.universeId, undefined, 500)).entities,
        input.entityIds
      );
      const [busyRigs, busyPuppets] = await Promise.all([
        entitiesWithActiveJobs(ctx.user.uid, 'rig_model'),
        entitiesWithActiveJobs(ctx.user.uid, 'character_puppet'),
      ]);
      const pending = entities.filter(
        (e) =>
          (PUPPET_KINDS as readonly string[]).includes(e.kind) &&
          !!entityModelUrl(e) &&
          !meta(e).puppet?.riggedModelUrl &&
          !busyRigs.has(e.id) &&
          !busyPuppets.has(e.id)
      );
      const jobs: Array<{ entityId: string; jobId: string }> = [];
      for (const e of pending.slice(0, input.limit)) {
        const { jobId } = await startJob(
          'rig_model',
          ctx.user.uid,
          apiKey,
          {
            entity: toRef(e),
            modelUrl: entityModelUrl(e)!,
            rigType: input.rigType,
          } satisfies RigModelArgs,
          {
            entityId: e.id,
            universeId: e.universeAddress,
            meta: { rigType: input.rigType, batch: true },
          }
        );
        jobs.push({ entityId: e.id, jobId });
      }
      return {
        jobs,
        remaining: Math.max(0, pending.length - jobs.length),
        skippedInFlight: busyRigs.size + busyPuppets.size,
      };
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
        { source, granularity: input.granularity } satisfies SegmentArgs,
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
      return startJob('restyle', ctx.user.uid, apiKey, { source, ...style } satisfies RestyleArgs, {
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
        { source, style: input.style } satisfies StylizeArgs,
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
        {
          source,
          format: input.format,
          quad: input.quad,
          faceLimit: input.faceLimit,
          fbxPreset: input.fbxPreset,
        } satisfies ConvertArgs,
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
        { entity: toRef(entity), imageUrl } satisfies PlaceSplatArgs,
        {
          entityId: entity.id,
          universeId: entity.universeAddress,
        }
      );
    }),

  /** Re-run a failed job; Tripo steps it already finished are replayed, not re-billed. */
  retryJob: gen.input(z.object({ jobId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
    const doc = await threeDGenCol().doc(input.jobId).get();
    const d = doc.data();
    if (!d || d.userId !== ctx.user.uid || d.provider !== 'tripo') {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Job not found' });
    }
    if (d.status !== 'failed') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only failed jobs can be retried' });
    }
    if (!d.pipelineArgs) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This job predates retries — start it again from the entity page',
      });
    }
    const apiKey = await requireTripoKey(ctx.user.uid);
    await retryTripoJob(input.jobId, ctx.user.uid, apiKey);
    return { jobId: input.jobId };
  }),

  /**
   * Web-delivery copies for a universe's existing models (generated before
   * optimisation existed). CPU only — no Tripo calls, no key needed. Runs
   * in the background; the World tab refreshes as copies land.
   */
  optimizeWebModels: protectedProcedure
    .input(z.object({ universeId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      if (!(await isUniverseAdmin(input.universeId, ctx.user.address ?? ''))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Universe managers only' });
      }
      const key = normalizeUniverseId(input.universeId);
      if (optimizingUniverses.has(key)) return { queued: 0, alreadyRunning: true };
      const { entities } = await getEntitiesByUniverse(input.universeId, undefined, 500);
      const todo = entities.filter((e) => needsWebCopy(e));
      if (!todo.length) return { queued: 0, alreadyRunning: false };
      optimizingUniverses.add(key);
      const uid = ctx.user.uid;
      void (async () => {
        let made = 0;
        for (const e of todo) {
          made += await backfillEntityWebModels(e.id, uid, (url, filename) =>
            webOptimizeUrl(url, filename, uid)
          ).catch((err) => {
            console.error(`[tripo-world] web backfill for ${e.id} failed:`, err);
            return 0;
          });
        }
        console.log(
          `[tripo-world] web backfill ${key}: ${made} copies for ${todo.length} entities`
        );
      })().finally(() => optimizingUniverses.delete(key));
      return { queued: todo.length, alreadyRunning: false };
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
   * Managers: where the story uses each 3D-able entity (canon episodes that
   * name it, world sets that place it, wiki entries that mention it), so the
   * build/rig pickers can suggest what scenes actually need instead of
   * everything with a cover.
   */
  buildPlan: protectedProcedure
    .input(z.object({ universeId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      if (!(await isUniverseAdmin(input.universeId, ctx.user.address ?? ''))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Universe managers only' });
      }
      const { entities } = await getEntitiesByUniverse(input.universeId, undefined, 500);
      const relevant = new Set<string>([...MODELABLE_KINDS, ...ENVIRONMENT_KINDS]);
      const universeKey = normalizeUniverseId(input.universeId);
      const [episodes, sets] = await Promise.all([
        db
          .collection('episodes')
          .where('universeId', '==', entities[0]?.universeAddress ?? universeKey)
          .where('isCanon', '==', true)
          .limit(200)
          .get()
          .then((s) =>
            s.docs.map((d) => ({
              id: d.id,
              ...(d.data() as { title?: string; description?: string }),
            }))
          )
          .catch(() => []),
        db
          .collection('worldSets')
          .where('universeId', '==', universeKey)
          .limit(200)
          .get()
          .then((s) => s.docs.map((d) => d.data() as SetUsageSource))
          .catch(() => []),
      ]);
      return entityUsage(
        entities.filter((e) => relevant.has(e.kind)),
        entities,
        episodes,
        sets
      );
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
            webModelUrl: entityWebModelUrl(e),
            thumbnailUrl: (m.model3d?.thumbnailUrl ?? m.puppet?.thumbnailUrl ?? null) as
              | string
              | null,
            usdzUrl: (m.usdzUrl ?? null) as string | null,
            puppet: m.puppet?.riggedModelUrl
              ? {
                  riggedModelUrl: m.puppet.riggedModelUrl as string,
                  webRiggedModelUrl: (m.puppet.webRiggedModelUrl ?? null) as string | null,
                  rigType: m.puppet.rigType as string,
                  animations: (m.puppet.animations ?? []) as Array<{
                    preset: string;
                    name: string;
                    url: string;
                    webUrl?: string | null;
                  }>,
                  turnaround: (m.puppet.turnaround ?? {}) as Record<string, string>,
                }
              : null,
            needsWebCopy: needsWebCopy(e),
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

/** Narrow a universe's entities to the picked ids (all of them when none given). */
function pickEntities(entities: Entity[], ids: string[] | undefined): Entity[] {
  if (!ids) return entities;
  const wanted = new Set(ids);
  return entities.filter((e) => wanted.has(e.id));
}

/** Has a model (or puppet clip) but no web-delivery copy of it yet. */
function needsWebCopy(e: Pick<Entity, 'metadata'>): boolean {
  const m = (e.metadata ?? {}) as Record<string, any>;
  if (m.model3d?.glbUrl && !m.model3d.webGlbUrl) return true;
  const p = m.puppet;
  if (!p) return false;
  if (p.modelUrl && !p.webModelUrl) return true;
  if (p.riggedModelUrl && !p.webRiggedModelUrl) return true;
  return Array.isArray(p.animations) && p.animations.some((a: any) => a?.url && !a.webUrl);
}

function assertAnimationsFit(rigType: string, animations: readonly string[]) {
  const bad = unsupportedAnimations(rigType, animations);
  if (bad.length) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `A ${rigType} skeleton can't play: ${bad.join(', ')}`,
    });
  }
}

/** Rig task id of a puppet rigged before `puppet.rigTaskId` was stored. */
async function rigTaskFromJob(jobId: string | undefined): Promise<string | null> {
  if (!jobId) return null;
  const d = (await threeDGenCol().doc(jobId).get()).data();
  const step = ((d?.steps ?? []) as Array<{ name: string; taskId?: string; status: string }>).find(
    (st) => st.name === 'Rig skeleton' && st.status === 'success'
  );
  return step?.taskId ?? null;
}

function assertPuppetKind(kind: string) {
  if (!(PUPPET_KINDS as readonly string[]).includes(kind)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Rigs can be built for characters, species and vehicles',
    });
  }
}

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
    status: d.status as TripoJobStatus,
    steps: (d.steps ?? []) as Array<{
      name: string;
      status: string;
      progress?: number;
      reused?: boolean;
    }>,
    retryable: d.status === 'failed' && !!d.pipelineArgs,
    retryCount: (d.retryCount ?? 0) as number,
    entityId: (d.entityId ?? null) as string | null,
    universeId: (d.universeId ?? null) as string | null,
    partial: (d.partial ?? null) as Record<string, unknown> | null,
    result: (d.result ?? null) as Record<string, any> | null,
    failureReason: (d.failureReason ?? null) as string | null,
    createdAt: ts(d.createdAt),
    completedAt: ts(d.completedAt),
  };
}
