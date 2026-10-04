/**
 * Tripo world-building pipelines — the bodies `startTripoJob` runs.
 *
 * Each pipeline is a pure chain of Tripo steps plus the persistence that
 * makes its output part of the universe: entity fields the wiki/set
 * builder read, `mediaAttachments` rows the entity MediaGallery shows,
 * and gallery `content` docs (with lineage) for the universe gallery.
 *
 * Inputs a pipeline hands Tripo are always permanent URLs we host, or a
 * fresh Tripo task id from an earlier step of the same job — never a
 * stored Tripo task id, since Tripo garbage-collects old tasks.
 *
 * Pipelines are built from JSON-serialisable args (stored on the job doc)
 * via TRIPO_PIPELINES, so the runner can resume or retry them. A re-run
 * replays finished Tripo steps, so every write here is idempotent:
 * attachments dedupe on their contentHash, gallery posts on generationId,
 * entity fields are plain overwrites.
 *
 * Every GLB output gets a web-delivery copy (`ctx.optimize`, ~20× smaller).
 * Viewers use the copy; the original stays the source for edits, exports
 * and asset packs.
 */
import { db } from '../../lib/firebase';
import { publishToGallery, type PublishGalleryInput } from '../../lib/gallery-publish';
import { createAttachment, getAttachmentsByTarget } from '../../routers/media/media.handlers';
import {
  tripo3dService,
  tripoMultiviewUrls,
  type TripoAnimation,
  type TripoConvertFormat,
  type TripoQuality,
  type TripoRigType,
  type TripoStylizeStyle,
  type TripoTask,
} from '../tripo3d';
import { normalizeTripoRigType } from '../../lib/threed-provider';
import { setReferenceBundle } from '../../routers/entities/entities.reference-bundle';
import { MAX_REFS_PER_SLOT, type ReferenceBundle } from '../../routers/entities/entities.types';
import { fetchGlbJson, listPartNames } from './glb';
import {
  urlExt,
  type TripoJobContext,
  type TripoJobKind,
  type TripoPipelineFactory,
} from './runner';

export interface EntityRef {
  id: string;
  name: string;
  kind: string;
  /** The entity's `universeAddress` — also the gallery's `universeId`. */
  universeId: string | null;
}

export interface ModelSource {
  /** Permanent GLB URL (full-fidelity original). */
  url: string;
  title: string;
  universeId: string | null;
  /** Gallery lineage parent for derivatives. */
  parentGenerationId: string | null;
  /** Entity the model belongs to, when known — derivatives attach there too. */
  entity: EntityRef | null;
}

const slug = (s: string) =>
  s
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'model';

function modelUrlOf(task: TripoTask): string {
  const url = task.output?.model_url || task.output?.model_urls?.[0];
  if (!url) throw new Error(`Tripo task ${task.task_id} finished without a model`);
  return url;
}

/** Keep a Tripo GLB and make its web copy. */
async function keepModel(ctx: TripoJobContext, raw: string, filename: string) {
  const url = await ctx.keep(raw, filename);
  if (!url) throw new Error(`Could not store ${filename}`);
  // Same URL back = already web-sized; null = optimisation failed.
  const webUrl = (await ctx.optimize(url, filename)) ?? null;
  return { url, webUrl };
}

async function attach(
  userId: string,
  entity: EntityRef,
  a: {
    key: string;
    url: string;
    category: '3d' | 'image' | 'video';
    subCategory: string;
    label: string;
    mimeType: string;
    filename: string;
    generationId: string;
  }
) {
  const contentHash = `tripo:${a.generationId}:${a.key}`;
  try {
    // Idempotent: a resumed/retried job replays the same task ids.
    const existing = await getAttachmentsByTarget('entity', entity.id);
    if (existing.some((x) => x.contentHash === contentHash)) return;
    await createAttachment(userId, {
      contentHash,
      originalFilename: a.filename,
      mimeType: a.mimeType,
      size: 0,
      url: a.url,
      targetType: 'entity',
      targetId: entity.id,
      targetName: entity.name,
      category: a.category,
      label: a.label,
      subCategory: a.subCategory,
      generationId: a.generationId,
    } as Parameters<typeof createAttachment>[1]);
  } catch (err) {
    console.error(`[tripo-world] attach ${a.key} to entity ${entity.id} failed:`, err);
  }
}

/** The display + original pair for a model attachment. */
async function attachModel(
  userId: string,
  entity: EntityRef,
  m: {
    url: string;
    webUrl: string | null;
    subCategory: string;
    label: string;
    filename: string;
    generationId: string;
    key?: string;
  }
) {
  const key = m.key ?? 'glb';
  await attach(userId, entity, {
    key,
    url: m.url,
    category: '3d',
    subCategory: m.subCategory,
    label: `${m.label} — GLB (full detail)`,
    mimeType: 'model/gltf-binary',
    filename: m.filename,
    generationId: m.generationId,
  });
  if (m.webUrl && m.webUrl !== m.url) {
    // MediaGallery's hero viewer prefers subCategory 'web' (findBestGlb).
    await attach(userId, entity, {
      key: `${key}-web`,
      url: m.webUrl,
      category: '3d',
      subCategory: 'web',
      label: `${m.label} — web preview`,
      mimeType: 'model/gltf-binary',
      filename: m.filename.replace(/\.glb$/i, '-web.glb'),
      generationId: m.generationId,
    });
  }
}

/** publishToGallery, at most once per generationId (re-runs replay task ids). */
async function publishOnce(input: PublishGalleryInput) {
  try {
    const dup = await db
      .collection('content')
      .where('generationId', '==', input.generationId)
      .limit(1)
      .get();
    if (!dup.empty) return;
    await publishToGallery(input);
  } catch (err) {
    console.error(`[tripo-world] gallery publish ${input.generationId} failed:`, err);
  }
}

/**
 * World-building data lives under `entity.metadata` (the entity schema's
 * open bag): `modelUrl` (legacy key `hasModel()` + create flow already
 * read), `model3d`, `puppet`, `environment`, `usdzUrl`.
 */
async function patchEntityMetadata(entityId: string, fields: Record<string, unknown>) {
  const update: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(fields)) update[`metadata.${k}`] = v;
  await db.collection('entities').doc(entityId).update(update);
}

/**
 * Feed the turnaround into the entity's reference bundle so every video /
 * image generation that targets this character (generation.generate's
 * `useReferenceBundle`, on by default) is conditioned on it. Only fills
 * free `character` slots — refs a creator picked by hand always win.
 */
async function mergeTurnaroundIntoBundle(entityId: string, urls: string[]) {
  const doc = await db.collection('entities').doc(entityId).get();
  const bundle = (doc.data()?.referenceBundle ?? null) as ReferenceBundle | null;
  const current = bundle?.slots?.character ?? [];
  const merged = [...current, ...urls.filter((u) => !current.includes(u))].slice(
    0,
    MAX_REFS_PER_SLOT
  );
  if (merged.length === current.length) return;
  await setReferenceBundle(entityId, {
    slots: { ...(bundle?.slots ?? {}), character: merged },
    locks: bundle?.locks ?? { face: true, silhouette: true },
    identityStrength: bundle?.identityStrength ?? 0.7,
  });
}

// ── #1 Entity → 3D model ─────────────────────────────────────────────────

export interface EntityModelArgs {
  entity: EntityRef;
  imageUrl: string;
  quality: TripoQuality;
}

export function entityModelPipeline(args: EntityModelArgs) {
  return async (ctx: TripoJobContext) => {
    const { entity } = args;
    const task = await ctx.step('Generate 3D model', () =>
      tripo3dService.imageToModel({
        input: args.imageUrl,
        quality: args.quality,
        renderVideo: true,
        apiKey: ctx.apiKey,
      })
    );
    const base = slug(entity.name);
    const [{ url: glbUrl, webUrl: webGlbUrl }, thumbnailUrl, videoUrl] = await Promise.all([
      keepModel(ctx, modelUrlOf(task), `${base}.glb`),
      ctx.keep(task.output?.rendered_image_url, `${base}-preview.png`),
      ctx.keep(task.output?.rendered_video_url, `${base}-turntable.mp4`),
    ]);
    const generationId = `tripo:model:${task.task_id}`;

    await patchEntityMetadata(entity.id, {
      modelUrl: glbUrl,
      model3d: {
        glbUrl,
        webGlbUrl,
        thumbnailUrl,
        videoUrl,
        quality: args.quality,
        provider: 'tripo',
        jobId: ctx.genId,
        generatedAt: new Date(),
      },
    });
    await attachModel(ctx.userId, entity, {
      url: glbUrl,
      webUrl: webGlbUrl,
      subCategory: 'game_ready',
      label: `3D model (${args.quality === 'game' ? 'game-ready' : 'high detail'})`,
      filename: `${base}.glb`,
      generationId,
    });
    if (thumbnailUrl) {
      await attach(ctx.userId, entity, {
        key: 'thumbnail',
        url: thumbnailUrl,
        category: 'image',
        subCategory: 'concept_art',
        label: '3D model thumbnail',
        mimeType: 'image/png',
        filename: `${base}-preview.png`,
        generationId,
      });
    }
    if (videoUrl) {
      await attach(ctx.userId, entity, {
        key: 'turntable',
        url: videoUrl,
        category: 'video',
        subCategory: 'turntable',
        label: '3D turntable',
        mimeType: 'video/mp4',
        filename: `${base}-turntable.mp4`,
        generationId,
      });
    }
    await publishOnce({
      creatorUid: ctx.userId,
      mediaUrl: webGlbUrl ?? glbUrl,
      sourceMediaUrl: webGlbUrl && webGlbUrl !== glbUrl ? glbUrl : null,
      mediaType: '3d',
      title: entity.name,
      description: `3D model of ${entity.name}, generated from its wiki art with Tripo.`,
      thumbnailUrl,
      universeId: entity.universeId,
      generationId,
      generationModel: `tripo:image-to-model:${args.quality}`,
      tags: ['3d', entity.kind, 'world'],
      sourceImageUrl: args.imageUrl,
    });
    return { glbUrl, webGlbUrl, thumbnailUrl, videoUrl, entityId: entity.id };
  };
}

// ── #2 Character puppet ──────────────────────────────────────────────────

export const PUPPET_DEFAULT_ANIMATIONS: TripoAnimation[] = [
  'preset:idle',
  'preset:walk',
  'preset:run',
  'preset:turn',
];

export interface CharacterPuppetArgs {
  entity: EntityRef;
  imageUrl: string;
  rigType: TripoRigType;
  animations: TripoAnimation[];
  /** Normalise the art into a T-pose first (bipeds only). */
  tPose: boolean;
}

export function characterPuppetPipeline(args: CharacterPuppetArgs) {
  return async (ctx: TripoJobContext) => {
    const { entity } = args;
    const base = slug(entity.name);

    // 1. Pose: a clean full-body T-pose rigs far better than action art.
    let sheetInput = args.imageUrl;
    if (args.tPose) {
      const posed = await ctx.step('Pose for rigging', () =>
        tripo3dService.imageToImage({
          input: args.imageUrl,
          template: 't_pose',
          apiKey: ctx.apiKey,
        })
      );
      const posedUrl = posed.output?.generated_image_url ?? posed.output?.image_urls?.[0];
      if (posedUrl) sheetInput = posedUrl;
    }

    // 2. Turnaround sheet — these four views double as the character's
    //    consistency references for image/video generation.
    const mv = await ctx.step('Turnaround sheet', () =>
      tripo3dService.imageToMultiview({ input: sheetInput, apiKey: ctx.apiKey })
    );
    const raw = tripoMultiviewUrls(mv);
    const views = ['front', 'left', 'back', 'right'] as const;
    const kept = await Promise.all(
      views.map((v) => ctx.keep(raw[v], `${base}-turnaround-${v}.png`))
    );
    const turnaround = Object.fromEntries(
      views.map((v, i) => [v, kept[i]]).filter(([, url]) => !!url)
    ) as Partial<Record<(typeof views)[number], string>>;
    if (!turnaround.front) throw new Error('Tripo returned no front view for the turnaround');
    await ctx.patch({ partial: { turnaround } });
    await patchEntityMetadata(entity.id, {
      'puppet.turnaround': turnaround,
      'puppet.jobId': ctx.genId,
    });
    await mergeTurnaroundIntoBundle(
      entity.id,
      [turnaround.front, turnaround.left, turnaround.right].filter((u): u is string => !!u)
    ).catch((err) => console.error('[tripo-world] reference bundle merge failed:', err));
    for (const v of views) {
      const url = turnaround[v];
      if (!url) continue;
      await attach(ctx.userId, entity, {
        key: `turnaround-${v}`,
        url,
        category: 'image',
        subCategory: 'turnaround',
        label: `Turnaround — ${v}`,
        mimeType: 'image/png',
        filename: `${base}-turnaround-${v}.png`,
        generationId: `tripo:multiview:${mv.task_id}`,
      });
    }

    // 3. Body from the four views.
    const body = await ctx.step('Build 3D body', () =>
      tripo3dService.multiviewToModel({
        multiviewTaskId: mv.task_id,
        quality: 'hifi',
        renderVideo: true,
        apiKey: ctx.apiKey,
      })
    );
    const [{ url: modelUrl, webUrl: webModelUrl }, thumbnailUrl] = await Promise.all([
      keepModel(ctx, modelUrlOf(body), `${base}.glb`),
      ctx.keep(body.output?.rendered_image_url, `${base}-preview.png`),
    ]);

    // 4. Skeleton.
    const rig = await ctx.step('Rig skeleton', () =>
      tripo3dService.rigModel({ input: body.task_id, rigType: args.rigType, apiKey: ctx.apiKey })
    );
    const { url: riggedUrl, webUrl: webRiggedUrl } = await keepModel(
      ctx,
      modelUrlOf(rig),
      `${base}-rigged.glb`
    );

    // 5. Motion library — one GLB per preset.
    const animations: Array<{ preset: string; name: string; url: string; webUrl: string | null }> =
      [];
    if (args.animations.length) {
      const anim = await ctx.step('Animations', () =>
        tripo3dService.retargetAnimations({
          input: rig.task_id,
          animations: args.animations,
          apiKey: ctx.apiKey,
        })
      );
      const urls = anim.output?.model_urls?.length
        ? anim.output.model_urls
        : anim.output?.model_url
          ? [anim.output.model_url]
          : [];
      // Sequential: each clip is a full mesh + motion and optimisation is
      // queued process-wide anyway.
      for (const [i, preset] of (args.animations as string[]).entries()) {
        const name = preset.split(':').pop()!;
        if (!urls[i]) continue;
        const { url, webUrl } = await keepModel(ctx, urls[i], `${base}-${name}.glb`);
        animations.push({ preset, name, url, webUrl });
      }
    }

    const puppet = {
      turnaround,
      modelUrl,
      webModelUrl,
      riggedModelUrl: riggedUrl,
      webRiggedModelUrl: webRiggedUrl,
      thumbnailUrl,
      rigType: args.rigType,
      animations,
      jobId: ctx.genId,
      provider: 'tripo',
      generatedAt: new Date(),
    };
    await patchEntityMetadata(entity.id, { puppet, modelUrl });
    await attachModel(ctx.userId, entity, {
      key: 'rigged',
      url: riggedUrl,
      webUrl: webRiggedUrl,
      subCategory: 'rigged',
      label: `Rigged ${args.rigType}`,
      filename: `${base}-rigged.glb`,
      generationId: `rig:tripo:${rig.task_id}`,
    });
    // `rig:tripo:<taskId>` is the id threed.animate decodes, so the rigged
    // model also works with the existing per-model animation testbench.
    await publishOnce({
      creatorUid: ctx.userId,
      mediaUrl: webRiggedUrl ?? riggedUrl,
      sourceMediaUrl: webRiggedUrl && webRiggedUrl !== riggedUrl ? riggedUrl : null,
      mediaType: '3d',
      title: `${entity.name} — rigged`,
      description: `Rigged ${args.rigType} puppet of ${entity.name}.`,
      thumbnailUrl,
      universeId: entity.universeId,
      generationId: `rig:tripo:${rig.task_id}`,
      generationModel: `tripo-rigging:${args.rigType}`,
      tags: ['character', '3d', 'rigged', 'puppet'],
      sourceImageUrl: args.imageUrl,
    });
    const { generatedAt: _omit, ...summary } = puppet;
    return { ...summary, entityId: entity.id };
  };
}

// ── #2b Rig an existing model ────────────────────────────────────────────

export interface RigModelArgs {
  entity: EntityRef;
  /** Permanent full-fidelity GLB to rig (never the meshopt web copy). */
  modelUrl: string;
  /** `auto` asks Tripo's rig-check which skeleton the mesh needs. */
  rigType: TripoRigType | 'auto';
  /** Omitted = idle + the rig's default gait (full set for bipeds). */
  animations?: TripoAnimation[];
}

/** Default motion set for a skeleton type. */
export function defaultPuppetAnimations(rigType: TripoRigType): TripoAnimation[] {
  switch (rigType) {
    case 'biped':
      return PUPPET_DEFAULT_ANIMATIONS;
    case 'quadruped':
      return ['preset:idle', 'preset:quadruped:walk'];
    case 'hexapod':
      return ['preset:idle', 'preset:hexapod:walk'];
    case 'octopod':
      return ['preset:idle', 'preset:octopod:walk'];
    case 'serpentine':
      return ['preset:idle', 'preset:serpentine:march'];
    case 'aquatic':
      return ['preset:idle', 'preset:aquatic:march'];
    default:
      return ['preset:idle'];
  }
}

/**
 * Skeleton + motion clips for the model the entity already has, so you don't
 * rebuild the body from the cover art the way the full puppet pipeline does.
 * Writes the same `metadata.puppet` fields the puppet does. It never touches
 * the puppet's turnaround or body, so a later full puppet still works.
 */
export function rigModelPipeline(args: RigModelArgs) {
  return async (ctx: TripoJobContext) => {
    const { entity } = args;
    const base = slug(entity.name);
    // Re-uploaded on resume too: tokens are cheap, and replayed steps poll
    // their stored task instead of using this input.
    const fileToken = await tripo3dService.uploadRemoteGlb(args.modelUrl, ctx.apiKey);

    let rigType: TripoRigType;
    if (args.rigType === 'auto') {
      const check = await ctx.step('Detect skeleton', () =>
        tripo3dService.rigCheck({ input: fileToken, apiKey: ctx.apiKey })
      );
      if (check.output?.riggable === false) {
        throw new Error(
          'Tripo says this model cannot be rigged — try a cleaner single-object mesh'
        );
      }
      rigType = normalizeTripoRigType(check.output?.rig_type);
      await ctx.patch({ partial: { rigType } });
    } else {
      rigType = args.rigType;
    }

    const rig = await ctx.step('Rig skeleton', () =>
      tripo3dService.rigModel({ input: fileToken, rigType, apiKey: ctx.apiKey })
    );
    const { url: riggedUrl, webUrl: webRiggedUrl } = await keepModel(
      ctx,
      modelUrlOf(rig),
      `${base}-rigged.glb`
    );

    const presets = args.animations ?? defaultPuppetAnimations(rigType);
    const animations: Array<{ preset: string; name: string; url: string; webUrl: string | null }> =
      [];
    if (presets.length) {
      const anim = await ctx.step('Animations', () =>
        tripo3dService.retargetAnimations({
          input: rig.task_id,
          animations: presets,
          apiKey: ctx.apiKey,
        })
      );
      const urls = anim.output?.model_urls?.length
        ? anim.output.model_urls
        : anim.output?.model_url
          ? [anim.output.model_url]
          : [];
      for (const [i, preset] of (presets as string[]).entries()) {
        const name = preset.split(':').pop()!;
        if (!urls[i]) continue;
        const { url, webUrl } = await keepModel(ctx, urls[i], `${base}-${name}.glb`);
        animations.push({ preset, name, url, webUrl });
      }
    }

    await patchEntityMetadata(entity.id, {
      'puppet.riggedModelUrl': riggedUrl,
      'puppet.webRiggedModelUrl': webRiggedUrl,
      'puppet.rigType': rigType,
      'puppet.animations': animations,
      'puppet.jobId': ctx.genId,
      'puppet.provider': 'tripo',
      'puppet.riggedFrom': args.modelUrl,
      'puppet.generatedAt': new Date(),
    });
    await attachModel(ctx.userId, entity, {
      key: 'rigged',
      url: riggedUrl,
      webUrl: webRiggedUrl,
      subCategory: 'rigged',
      label: `Rigged ${rigType}`,
      filename: `${base}-rigged.glb`,
      generationId: `rig:tripo:${rig.task_id}`,
    });
    await publishOnce({
      creatorUid: ctx.userId,
      mediaUrl: webRiggedUrl ?? riggedUrl,
      sourceMediaUrl: webRiggedUrl && webRiggedUrl !== riggedUrl ? riggedUrl : null,
      mediaType: '3d',
      title: `${entity.name} — rigged`,
      description: `Rigged ${rigType} model of ${entity.name}.`,
      thumbnailUrl: null,
      universeId: entity.universeId,
      generationId: `rig:tripo:${rig.task_id}`,
      generationModel: `tripo-rigging:${rigType}`,
      tags: ['3d', entity.kind, 'rigged'],
      sourceImageUrl: null,
    });
    return {
      riggedModelUrl: riggedUrl,
      webRiggedModelUrl: webRiggedUrl,
      rigType,
      animations,
      entityId: entity.id,
    };
  };
}

// ── #3 Parts library ─────────────────────────────────────────────────────

export interface SegmentArgs {
  source: ModelSource;
  granularity: 'simple' | 'balanced' | 'detailed';
}

export function segmentPipeline(args: SegmentArgs) {
  return async (ctx: TripoJobContext) => {
    const base = slug(args.source.title);
    const token = await tripo3dService.uploadRemoteGlb(args.source.url, ctx.apiKey);
    const seg = await ctx.step('Split into parts', () =>
      tripo3dService.segmentMesh({
        input: token,
        granularity: args.granularity,
        apiKey: ctx.apiKey,
      })
    );
    const done = await ctx.step('Close open faces', () =>
      tripo3dService.completeMesh({ segmentTaskId: seg.task_id, apiKey: ctx.apiKey })
    );
    const rawUrl =
      done.output?.model_url ?? done.output?.seg_model_url ?? seg.output?.seg_model_url;
    const { url: partsModelUrl, webUrl: webPartsModelUrl } = await keepModel(
      ctx,
      rawUrl ?? modelUrlOf(done),
      `${base}-parts.glb`
    );
    const parts = listPartNames(await fetchGlbJson(partsModelUrl));
    if (!parts.length) throw new Error('Segmentation produced no named parts');

    const generationId = `tripo:segment:${seg.task_id}`;
    await publishOnce({
      creatorUid: ctx.userId,
      mediaUrl: webPartsModelUrl ?? partsModelUrl,
      sourceMediaUrl: webPartsModelUrl && webPartsModelUrl !== partsModelUrl ? partsModelUrl : null,
      mediaType: '3d',
      title: `${args.source.title} — parts kit`,
      description: `${parts.length} remixable parts: ${parts.slice(0, 12).join(', ')}`,
      universeId: args.source.universeId,
      generationId,
      generationModel: 'tripo:segment',
      tags: ['3d', 'parts', 'kitbash'],
      parentGenerationId: args.source.parentGenerationId,
    });
    return {
      partsModelUrl,
      webPartsModelUrl,
      parts,
      generationId,
      sourceUrl: args.source.url,
    };
  };
}

// ── #6 Universe look: restyle / stylize ──────────────────────────────────

export interface RestyleArgs {
  source: ModelSource;
  text?: string;
  styleImageUrl?: string;
  label: string;
}

export function restylePipeline(args: RestyleArgs) {
  return async (ctx: TripoJobContext) => {
    const base = slug(`${args.source.title}-${args.label}`);
    const token = await tripo3dService.uploadRemoteGlb(args.source.url, ctx.apiKey);
    const task = await ctx.step('Re-texture', () =>
      tripo3dService.textureModel({
        input: token,
        text: args.text,
        styleImageUrl: args.styleImageUrl,
        quality: 'detailed',
        apiKey: ctx.apiKey,
      })
    );
    return publishDerivative(ctx, args.source, task, base, {
      title: `${args.source.title} — ${args.label}`,
      description: args.text ?? 'Re-textured to match the universe style.',
      model: 'tripo:texture',
      tag: 'restyled',
    });
  };
}

export interface StylizeArgs {
  source: ModelSource;
  style: TripoStylizeStyle;
}

export function stylizePipeline(args: StylizeArgs) {
  return async (ctx: TripoJobContext) => {
    const base = slug(`${args.source.title}-${args.style}`);
    const token = await tripo3dService.uploadRemoteGlb(args.source.url, ctx.apiKey);
    const task = await ctx.step(`Stylize (${args.style})`, () =>
      tripo3dService.stylizeModel({ input: token, style: args.style, apiKey: ctx.apiKey })
    );
    return publishDerivative(ctx, args.source, task, base, {
      title: `${args.source.title} — ${args.style}`,
      description: `${args.style} version of ${args.source.title}.`,
      model: `tripo:stylize:${args.style}`,
      tag: args.style,
    });
  };
}

async function publishDerivative(
  ctx: TripoJobContext,
  source: ModelSource,
  task: TripoTask,
  base: string,
  meta: { title: string; description: string; model: string; tag: string }
) {
  const [{ url: glbUrl, webUrl: webGlbUrl }, thumbnailUrl] = await Promise.all([
    keepModel(ctx, modelUrlOf(task), `${base}.glb`),
    ctx.keep(task.output?.rendered_image_url, `${base}-preview.png`),
  ]);
  const generationId = `${meta.model}:${task.task_id}`;
  if (source.entity) {
    // Original only: a second 'web' attachment would take over the entity's
    // hero viewer from its canonical model.
    await attach(ctx.userId, source.entity, {
      key: 'glb',
      url: glbUrl,
      category: '3d',
      subCategory: meta.tag,
      label: `${meta.title} — GLB`,
      mimeType: 'model/gltf-binary',
      filename: `${base}.glb`,
      generationId,
    });
  }
  await publishOnce({
    creatorUid: ctx.userId,
    mediaUrl: webGlbUrl ?? glbUrl,
    sourceMediaUrl: webGlbUrl && webGlbUrl !== glbUrl ? glbUrl : null,
    mediaType: '3d',
    title: meta.title.slice(0, 100),
    description: meta.description,
    thumbnailUrl,
    universeId: source.universeId,
    generationId,
    generationModel: meta.model,
    tags: ['3d', meta.tag],
    parentGenerationId: source.parentGenerationId,
  });
  return { glbUrl, webGlbUrl, thumbnailUrl, generationId };
}

// ── #5 Export / AR ───────────────────────────────────────────────────────

export interface ConvertArgs {
  source: ModelSource;
  format: TripoConvertFormat;
  quad: boolean;
  faceLimit?: number;
  fbxPreset?: 'blender' | '3dsmax' | 'mixamo';
}

export function convertPipeline(args: ConvertArgs) {
  return async (ctx: TripoJobContext) => {
    const base = slug(args.source.title);
    const token = await tripo3dService.uploadRemoteGlb(args.source.url, ctx.apiKey);
    const task = await ctx.step(`Convert to ${args.format}`, () =>
      tripo3dService.convertModel({
        input: token,
        format: args.format,
        quad: args.quad,
        faceLimit: args.faceLimit,
        fbxPreset: args.fbxPreset,
        apiKey: ctx.apiKey,
      })
    );
    const raw = modelUrlOf(task);
    const ext = urlExt(raw, args.format.toLowerCase());
    const url = await ctx.keep(raw, `${base}.${ext}`);
    // USDZ is what iOS AR Quick Look needs — remember it on the entity so
    // the viewer can offer "View in your space".
    if (args.format === 'USDZ' && args.source.entity) {
      await patchEntityMetadata(args.source.entity.id, { usdzUrl: url });
    }
    return { url, format: args.format, ext, sourceUrl: args.source.url };
  };
}

// ── #4 / #7 Place → explorable environment ───────────────────────────────

export interface PlaceSplatArgs {
  entity: EntityRef;
  imageUrl: string;
}

export function placeSplatPipeline(args: PlaceSplatArgs) {
  return async (ctx: TripoJobContext) => {
    const task = await ctx.step('Build environment', () =>
      tripo3dService.imageToSplat({ input: args.imageUrl, apiKey: ctx.apiKey })
    );
    const raw = task.output?.splat_url ?? task.output?.model_url;
    if (!raw) throw new Error('Tripo returned no splat file');
    const ext = urlExt(raw, 'ply');
    const splatUrl = await ctx.keep(raw, `${slug(args.entity.name)}-environment.${ext}`);
    await patchEntityMetadata(args.entity.id, {
      environment: {
        splatUrl,
        format: ext,
        sourceImageUrl: args.imageUrl,
        provider: 'tripo',
        jobId: ctx.genId,
        generatedAt: new Date(),
      },
    });
    return { splatUrl, format: ext, entityId: args.entity.id };
  };
}

// ── Registry (resume / retry rebuild pipelines from stored args) ─────────

export const TRIPO_PIPELINES: Partial<Record<TripoJobKind, TripoPipelineFactory>> = {
  entity_model: entityModelPipeline,
  character_puppet: characterPuppetPipeline,
  rig_model: rigModelPipeline,
  segment: segmentPipeline,
  restyle: restylePipeline,
  stylize: stylizePipeline,
  convert: convertPipeline,
  place_splat: placeSplatPipeline,
};

// ── Web copies for models generated before optimisation existed ──────────

/**
 * Add web copies to an entity's existing models (no Tripo calls — CPU
 * only). Returns how many copies it created. Idempotent: skips anything
 * that already has one.
 */
export async function backfillEntityWebModels(
  entityId: string,
  userId: string,
  optimize: (url: string, filename: string) => Promise<string | null>
): Promise<number> {
  const snap = await db.collection('entities').doc(entityId).get();
  const e = snap.data();
  if (!e) return 0;
  const m = (e.metadata ?? {}) as Record<string, any>;
  const entity: EntityRef = {
    id: entityId,
    name: e.name ?? 'model',
    kind: e.kind ?? 'thing',
    universeId: e.universeAddress ?? null,
  };
  const base = slug(entity.name);
  const update: Record<string, unknown> = {};
  let made = 0;

  if (m.model3d?.glbUrl && !m.model3d.webGlbUrl) {
    const web = await optimize(m.model3d.glbUrl, `${base}.glb`);
    if (web) {
      update['metadata.model3d.webGlbUrl'] = web;
      made++;
      const generationId =
        web !== m.model3d.glbUrl ? await modelGenerationId(entityId, m.model3d.glbUrl) : null;
      if (generationId) {
        await attach(userId, entity, {
          key: 'glb-web',
          url: web,
          category: '3d',
          subCategory: 'web',
          label: '3D model — web preview',
          mimeType: 'model/gltf-binary',
          filename: `${base}-web.glb`,
          generationId,
        });
        await pointGalleryAtWebCopy(generationId, m.model3d.glbUrl, web);
      }
    }
  }
  if (m.puppet?.modelUrl && !m.puppet.webModelUrl) {
    const web = await optimize(m.puppet.modelUrl, `${base}.glb`);
    if (web) {
      update['metadata.puppet.webModelUrl'] = web;
      made++;
    }
  }
  if (m.puppet?.riggedModelUrl && !m.puppet.webRiggedModelUrl) {
    const web = await optimize(m.puppet.riggedModelUrl, `${base}-rigged.glb`);
    if (web) {
      update['metadata.puppet.webRiggedModelUrl'] = web;
      made++;
    }
  }
  if (Array.isArray(m.puppet?.animations) && m.puppet.animations.some((a: any) => !a.webUrl)) {
    const clips = [];
    for (const clip of m.puppet.animations as Array<Record<string, any>>) {
      if (clip.webUrl || !clip.url) {
        clips.push(clip);
        continue;
      }
      const web = await optimize(clip.url, `${base}-${clip.name}.glb`);
      if (web) made++;
      clips.push({ ...clip, webUrl: web ?? null });
    }
    update['metadata.puppet.animations'] = clips;
  }
  if (Object.keys(update).length) {
    update.updatedAt = new Date();
    await db.collection('entities').doc(entityId).update(update);
  }
  return made;
}

/** The generationId of the attachment holding `glbUrl` (to pair the web copy with it). */
async function modelGenerationId(entityId: string, glbUrl: string): Promise<string | null> {
  const rows = await getAttachmentsByTarget('entity', entityId);
  return rows.find((r) => r.url === glbUrl && r.generationId)?.generationId ?? null;
}

async function pointGalleryAtWebCopy(generationId: string, original: string, web: string) {
  const snap = await db
    .collection('content')
    .where('generationId', '==', generationId)
    .limit(5)
    .get();
  await Promise.all(
    snap.docs
      .filter((d) => d.data().mediaUrl === original)
      .map((d) => d.ref.update({ mediaUrl: web, sourceMediaUrl: original, updatedAt: new Date() }))
  );
}
