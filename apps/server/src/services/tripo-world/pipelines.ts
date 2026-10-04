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
 */
import { db } from '../../lib/firebase';
import { publishToGallery } from '../../lib/gallery-publish';
import { createAttachment } from '../../routers/media/media.handlers';
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
import { setReferenceBundle } from '../../routers/entities/entities.reference-bundle';
import { MAX_REFS_PER_SLOT, type ReferenceBundle } from '../../routers/entities/entities.types';
import { fetchGlbJson, listPartNames } from './glb';
import { urlExt, type TripoJobContext } from './runner';

export interface EntityRef {
  id: string;
  name: string;
  kind: string;
  /** The entity's `universeAddress` — also the gallery's `universeId`. */
  universeId: string | null;
}

export interface ModelSource {
  /** Permanent GLB URL. */
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
  try {
    await createAttachment(userId, {
      contentHash: `tripo:${a.generationId}:${a.key}`,
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

export function entityModelPipeline(args: {
  entity: EntityRef;
  imageUrl: string;
  quality: TripoQuality;
}) {
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
    const [glbUrl, thumbnailUrl, videoUrl] = await Promise.all([
      ctx.keep(modelUrlOf(task), `${base}.glb`),
      ctx.keep(task.output?.rendered_image_url, `${base}-preview.png`),
      ctx.keep(task.output?.rendered_video_url, `${base}-turntable.mp4`),
    ]);
    const generationId = `tripo:model:${task.task_id}`;

    await patchEntityMetadata(entity.id, {
      modelUrl: glbUrl,
      model3d: {
        glbUrl,
        thumbnailUrl,
        videoUrl,
        quality: args.quality,
        provider: 'tripo',
        jobId: ctx.genId,
        generatedAt: new Date(),
      },
    });
    await attach(ctx.userId, entity, {
      key: 'glb',
      url: glbUrl!,
      category: '3d',
      subCategory: 'game_ready',
      label: `3D model (${args.quality === 'game' ? 'game-ready' : 'high detail'}) — GLB`,
      mimeType: 'model/gltf-binary',
      filename: `${base}.glb`,
      generationId,
    });
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
    void publishToGallery({
      creatorUid: ctx.userId,
      mediaUrl: glbUrl!,
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
    return { glbUrl, thumbnailUrl, videoUrl, entityId: entity.id };
  };
}

// ── #2 Character puppet ──────────────────────────────────────────────────

export const PUPPET_DEFAULT_ANIMATIONS: TripoAnimation[] = [
  'preset:idle',
  'preset:walk',
  'preset:run',
  'preset:turn',
];

export function characterPuppetPipeline(args: {
  entity: EntityRef;
  imageUrl: string;
  rigType: TripoRigType;
  animations: TripoAnimation[];
  /** Normalise the art into a T-pose first (bipeds only). */
  tPose: boolean;
}) {
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
    const [modelUrl, thumbnailUrl] = await Promise.all([
      ctx.keep(modelUrlOf(body), `${base}.glb`),
      ctx.keep(body.output?.rendered_image_url, `${base}-preview.png`),
    ]);

    // 4. Skeleton.
    const rig = await ctx.step('Rig skeleton', () =>
      tripo3dService.rigModel({ input: body.task_id, rigType: args.rigType, apiKey: ctx.apiKey })
    );
    const riggedUrl = await ctx.keep(modelUrlOf(rig), `${base}-rigged.glb`);

    // 5. Motion library — one GLB per preset.
    let animations: Array<{ preset: string; name: string; url: string }> = [];
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
      animations = (
        await Promise.all(
          args.animations.map(async (preset: string, i) => {
            const name = preset.split(':').pop()!;
            const url = await ctx.keep(urls[i], `${base}-${name}.glb`);
            return url ? { preset, name, url } : null;
          })
        )
      ).filter((a): a is { preset: string; name: string; url: string } => !!a);
    }

    const puppet = {
      turnaround,
      modelUrl,
      riggedModelUrl: riggedUrl,
      thumbnailUrl,
      rigType: args.rigType,
      animations,
      jobId: ctx.genId,
      provider: 'tripo',
      generatedAt: new Date(),
    };
    await patchEntityMetadata(entity.id, { puppet, modelUrl });
    await attach(ctx.userId, entity, {
      key: 'rigged',
      url: riggedUrl!,
      category: '3d',
      subCategory: 'rigged',
      label: `Rigged ${args.rigType} — GLB`,
      mimeType: 'model/gltf-binary',
      filename: `${base}-rigged.glb`,
      generationId: `rig:tripo:${rig.task_id}`,
    });
    // `rig:tripo:<taskId>` is the id threed.animate decodes, so the rigged
    // model also works with the existing per-model animation testbench.
    void publishToGallery({
      creatorUid: ctx.userId,
      mediaUrl: riggedUrl!,
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

// ── #3 Parts library ─────────────────────────────────────────────────────

export function segmentPipeline(args: {
  source: ModelSource;
  granularity: 'simple' | 'balanced' | 'detailed';
}) {
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
    const partsModelUrl = await ctx.keep(rawUrl ?? modelUrlOf(done), `${base}-parts.glb`);
    const parts = listPartNames(await fetchGlbJson(partsModelUrl!));
    if (!parts.length) throw new Error('Segmentation produced no named parts');

    const generationId = `tripo:segment:${seg.task_id}`;
    void publishToGallery({
      creatorUid: ctx.userId,
      mediaUrl: partsModelUrl!,
      mediaType: '3d',
      title: `${args.source.title} — parts kit`,
      description: `${parts.length} remixable parts: ${parts.slice(0, 12).join(', ')}`,
      universeId: args.source.universeId,
      generationId,
      generationModel: 'tripo:segment',
      tags: ['3d', 'parts', 'kitbash'],
      parentGenerationId: args.source.parentGenerationId,
    });
    return { partsModelUrl, parts, generationId, sourceUrl: args.source.url };
  };
}

// ── #6 Universe look: restyle / stylize ──────────────────────────────────

export function restylePipeline(args: {
  source: ModelSource;
  text?: string;
  styleImageUrl?: string;
  label: string;
}) {
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

export function stylizePipeline(args: { source: ModelSource; style: TripoStylizeStyle }) {
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
  const [glbUrl, thumbnailUrl] = await Promise.all([
    ctx.keep(modelUrlOf(task), `${base}.glb`),
    ctx.keep(task.output?.rendered_image_url, `${base}-preview.png`),
  ]);
  const generationId = `${meta.model}:${task.task_id}`;
  if (source.entity) {
    await attach(ctx.userId, source.entity, {
      key: 'glb',
      url: glbUrl!,
      category: '3d',
      subCategory: meta.tag,
      label: `${meta.title} — GLB`,
      mimeType: 'model/gltf-binary',
      filename: `${base}.glb`,
      generationId,
    });
  }
  void publishToGallery({
    creatorUid: ctx.userId,
    mediaUrl: glbUrl!,
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
  return { glbUrl, thumbnailUrl, generationId };
}

// ── #5 Export / AR ───────────────────────────────────────────────────────

export function convertPipeline(args: {
  source: ModelSource;
  format: TripoConvertFormat;
  quad: boolean;
  faceLimit?: number;
  fbxPreset?: 'blender' | '3dsmax' | 'mixamo';
}) {
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

export function placeSplatPipeline(args: { entity: EntityRef; imageUrl: string }) {
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
