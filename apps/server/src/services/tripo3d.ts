/**
 * Tripo3D Service — OpenAPI v3: generation (image/text/multiview → mesh,
 * image → splat), processing (texture, stylize, convert, segment, complete)
 * and non-humanoid rigging + animation.
 *
 * Covers what Meshy can't: quadrupeds, birds, snakes, fish, insects, spiders,
 * mechanical creatures, vehicles. Tripo's rig types are
 *   biped, quadruped, hexapod, octopod, avian, serpentine, aquatic.
 *
 * Workflow for an externally-generated GLB (e.g. a Meshy textured mesh):
 *   1. POST /files (multipart)                       → file_token
 *   2. POST /animations/rig  { input: file_token }   → rigTaskId
 *   3. POST /animations/retarget { input: rigTaskId }→ animationTaskId
 *   4. GET /tasks/{id} polled until status=success   → output.model_url
 *
 * v3 note: /animations/rig accepts a `file_token` (or a prior task_id)
 * directly as `input`, so the separate v2 `import_model` task is gone — one
 * fewer round-trip and one fewer poll. v2 (`api.tripo3d.ai/v2/openapi`) is
 * being retired by Tripo (maintenance ends 2026-10-01, endpoints disabled
 * 2026-11-01); this service targets v3.
 *
 * Required env var: TRIPO_API_KEY (or BYOK via provider-keys store).
 */

import { authorizedMediaUrl } from './ffmpeg/clip-pipeline';
import { NoKeyAvailableError } from './provider-keys/types';

// `TRIPO_API_HOST` lets tests point the service at a local fake of the v3 API.
const BASE_URL = `${process.env.TRIPO_API_HOST?.replace(/\/+$/, '') || 'https://openapi.tripo3d.ai'}/v3`;

/** Rig model versions. v2.5 covers every non-humanoid rig type; v1.0 is biped-only. */
const RIG_MODEL_NONHUMANOID = 'v2.5-20260210';
const RIG_MODEL_BIPED = 'v1.0-20240301';

export type TripoRigType =
  | 'biped'
  | 'quadruped'
  | 'hexapod'
  | 'octopod'
  | 'avian'
  | 'serpentine'
  | 'aquatic'
  // Kept for backwards compatibility with our rig-type enum. v3 does not
  // document `others`; a vehicle/mech rig may fail — the task error surfaces
  // through `waitForTask`.
  | 'others';

export type TripoRigSpec = 'mixamo' | 'tripo';

export type TripoAnimation =
  | 'preset:idle'
  | 'preset:walk'
  | 'preset:run'
  | 'preset:dive'
  | 'preset:climb'
  | 'preset:jump'
  | 'preset:slash'
  | 'preset:shoot'
  | 'preset:hurt'
  | 'preset:fall'
  | 'preset:turn'
  | 'preset:quadruped:walk'
  | 'preset:hexapod:walk'
  | 'preset:octopod:walk'
  | 'preset:serpentine:march'
  | 'preset:aquatic:march';

/**
 * v3 collapses `banned`/`expired` into `failed` (reported with an
 * `error_code` — 2008 moderation, 2018 queue expiry).
 */
export type TripoTaskStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface TripoTask {
  task_id: string;
  type: string;
  status: TripoTaskStatus;
  progress?: number;
  output?: {
    /** Signed 3D model download URL — expires, rehost before persisting. */
    model_url?: string;
    model_urls?: string[];
    rendered_video_url?: string;
    rendered_image_url?: string;
    generated_image_url?: string;
    image_urls?: string[];
    front_view_url?: string;
    left_view_url?: string;
    back_view_url?: string;
    right_view_url?: string;
    generate_multiview_image?: {
      front_view_url?: string;
      left_view_url?: string;
      back_view_url?: string;
      right_view_url?: string;
    };
    /** Gaussian splat file (image-to-splat). */
    splat_url?: string;
    /** Segmented GLB (mesh/segment). */
    seg_model_url?: string;
    /** Generated prompt, or comma-separated part labels for segmentation. */
    prompt?: string;
    /** rig-check verdict. */
    riggable?: boolean;
    rig_type?: string;
  };
  credits_consumed?: number;
  /** Present when status is `failed`. */
  error_code?: number;
  /** Present when status is `failed`. */
  error_message?: string;
}

interface CreateTaskResponse {
  code: number;
  data: { task_id: string };
}

interface GetTaskResponse {
  code: number;
  data: TripoTask;
}

interface UploadResponse {
  code: number;
  data: { file_token: string };
}

class Tripo3dService {
  /**
   * Required — no `TRIPO_API_KEY` env fallback. Callers must route through
   * `resolveProviderKey(userId, 'tripo')` so BYOK lookup runs and the key
   * is always the caller's own (see openai.ts's Auditor note M5, which
   * closed this same hole first).
   */
  private resolveKey(override?: string): string {
    const key = override?.trim();
    if (!key) {
      throw new NoKeyAvailableError(
        'tripo',
        'No Tripo3D API key available — add one at /settings/api-keys to use this model.'
      );
    }
    return key;
  }

  /** Base backoff for 429 retries; tests shrink it. */
  rateLimitBackoffMs = 5000;

  /**
   * Tripo answers 429 (code 2000, "exceeded the limit of generation") when an
   * account has too many tasks in flight — e.g. tripo.batchEntityTo3D starting
   * five jobs at once on a low-tier key. The submit was rejected, so retrying
   * is safe: wait (Retry-After, else exponential, capped at 60s) and resubmit
   * instead of failing the job.
   */
  private async post<T>(path: string, body: Record<string, unknown>, apiKey: string): Promise<T> {
    const MAX_ATTEMPTS = 8;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (res.status !== 429 || attempt >= MAX_ATTEMPTS) return this.parse<T>(res);
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 60_000)
          : Math.min(this.rateLimitBackoffMs * 2 ** (attempt - 1), 60_000);
      await res.body?.cancel().catch(() => undefined);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  private async get<T>(path: string, apiKey: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return this.parse<T>(res);
  }

  /** Shared response handler — surfaces both HTTP errors and `code != 0` bodies. */
  private async parse<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Tripo3D API error ${res.status}: ${text}`);
    }
    const json = (await res.json()) as T & { code?: number; message?: string; suggestion?: string };
    if (typeof json.code === 'number' && json.code !== 0) {
      const hint = json.suggestion ? ` — ${json.suggestion}` : '';
      throw new Error(`Tripo3D API error (code ${json.code}): ${json.message ?? 'unknown'}${hint}`);
    }
    return json;
  }

  /**
   * Stream a remote GLB through Tripo's /files endpoint. Returns the
   * `file_token` used as the `input` on the subsequent rig task. Direct
   * multipart upload — models are accepted up to 150 MB, well above any
   * single Meshy mesh.
   */
  async uploadRemoteGlb(modelUrl: string, apiKey?: string): Promise<string> {
    return this.uploadRemoteFile(
      modelUrl,
      this.resolveKey(apiKey),
      'model.glb',
      'model/gltf-binary'
    );
  }

  private async uploadRemoteFile(
    url: string,
    key: string,
    fallbackName: string,
    fallbackType: string
  ): Promise<string> {
    // Stored URLs carry no gateway credentials — the dedicated gateway 401s
    // without its token, which broke every restyle/stylize/parts/export job.
    const fetched = await fetch(authorizedMediaUrl(url));
    if (!fetched.ok) {
      throw new Error(`Failed to fetch source file for Tripo upload: ${fetched.status}`);
    }
    const blob = await fetched.blob();

    const form = new FormData();
    form.append(
      'file',
      new File([blob], inferFilename(url, fallbackName), { type: blob.type || fallbackType })
    );

    const res = await fetch(`${BASE_URL}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    const json = await this.parse<UploadResponse>(res);
    if (!json.data?.file_token) {
      throw new Error('Tripo3D upload returned no file token');
    }
    return json.data.file_token;
  }

  async rigModel(args: {
    /** A `file_token` from `uploadRemoteGlb`, or a prior model task_id. */
    input: string;
    rigType: TripoRigType;
    spec?: TripoRigSpec;
    outFormat?: 'glb' | 'fbx';
    apiKey?: string;
  }): Promise<{ taskId: string }> {
    const key = this.resolveKey(args.apiKey);
    const json = await this.post<CreateTaskResponse>(
      '/animations/rig',
      {
        input: args.input,
        model: args.rigType === 'biped' ? RIG_MODEL_BIPED : RIG_MODEL_NONHUMANOID,
        rig_type: args.rigType,
        spec: args.spec ?? 'tripo',
        out_format: args.outFormat ?? 'glb',
      },
      key
    );
    return { taskId: json.data.task_id };
  }

  async retargetAnimation(args: {
    /** The rigged model's task_id (from `rigModel`). */
    input: string;
    animation: TripoAnimation;
    outFormat?: 'glb' | 'fbx';
    bakeAnimation?: boolean;
    apiKey?: string;
  }): Promise<{ taskId: string }> {
    const key = this.resolveKey(args.apiKey);
    const json = await this.post<CreateTaskResponse>(
      '/animations/retarget',
      {
        input: args.input,
        animation: args.animation,
        out_format: args.outFormat ?? 'glb',
        bake_animation: args.bakeAnimation ?? true,
      },
      key
    );
    return { taskId: json.data.task_id };
  }

  // ── Generation + processing (world-building pipeline) ──────────────────
  //
  // Every method below submits one task and returns its id; completion is
  // polled with `waitForTask`. `input` fields accept a public URL, a
  // `file_token`, or a prior task_id — v3 resolves all three — so chained
  // steps pass the upstream task_id and skip a re-upload.

  private async createTask(
    path: string,
    body: Record<string, unknown>,
    apiKey?: string
  ): Promise<{ taskId: string }> {
    const key = this.resolveKey(apiKey);
    // Drop undefined fields so Tripo applies its own defaults.
    const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    // Tripo fetches URL inputs itself, and our dedicated gateway 401s without
    // its token (code 1004 "input image URL is not accessible") — which failed
    // every entity cover → 3D job. Upload those through /files instead of
    // handing the gateway token to a third party.
    if (typeof clean.input === 'string' && needsGatewayAuth(clean.input)) {
      clean.input = await this.uploadRemoteFile(clean.input, key, 'image.png', 'image/png');
    }
    const json = await this.post<CreateTaskResponse>(path, clean, key);
    if (!json.data?.task_id) throw new Error(`Tripo3D ${path} returned no task id`);
    return { taskId: json.data.task_id };
  }

  /** Single image → textured mesh. `input` is a public image URL or file token. */
  imageToModel(args: TripoGenerateOptions & { input: string; apiKey?: string }) {
    const { input, apiKey, ...opts } = args;
    return this.createTask(
      '/generation/image-to-model',
      { input, ...generateBody(opts), enable_image_autofix: true },
      apiKey
    );
  }

  /** Text prompt → textured mesh. */
  textToModel(
    args: TripoGenerateOptions & { prompt: string; negativePrompt?: string; apiKey?: string }
  ) {
    const { prompt, negativePrompt, apiKey, ...opts } = args;
    return this.createTask(
      '/generation/text-to-model',
      { prompt: prompt.slice(0, 1024), negative_prompt: negativePrompt, ...generateBody(opts) },
      apiKey
    );
  }

  /**
   * Four orthographic-ish views → mesh. Pass a prior `imageToMultiview`
   * task id (preferred — keeps the views Tripo itself generated) or four URLs.
   */
  multiviewToModel(
    args: TripoGenerateOptions & {
      multiviewTaskId?: string;
      views?: { front: string; left?: string; back?: string; right?: string };
      apiKey?: string;
    }
  ) {
    const { multiviewTaskId, views, apiKey, ...opts } = args;
    if (!multiviewTaskId && !views) throw new Error('multiviewToModel needs a task id or views');
    return this.createTask(
      '/generation/multiview-to-model',
      {
        ...(multiviewTaskId
          ? { original_model_task_id: multiviewTaskId }
          : {
              inputs: [
                Object.fromEntries(
                  Object.entries(views!)
                    .filter(([, url]) => !!url)
                    .map(([view, url]) => [view, { type: imageExt(url!), url }])
                ),
              ],
            }),
        ...generateBody(opts),
      },
      apiKey
    );
  }

  /** One image → front/left/back/right character sheet (turnaround). */
  imageToMultiview(args: { input: string; apiKey?: string }) {
    return this.createTask('/generation/image-to-multiview', { input: args.input }, args.apiKey);
  }

  /**
   * Image edit with a Tripo template — `t_pose` normalises a character
   * cover into a clean A/T-pose full-body render that rigs far better than
   * an action shot; `asset_extraction` isolates a prop from a busy scene.
   */
  imageToImage(args: {
    input: string;
    template?: 't_pose' | 'asset_extraction' | 'character_completion';
    prompt?: string;
    apiKey?: string;
  }) {
    return this.createTask(
      '/generation/image-to-image',
      { input: args.input, template: args.template, prompt: args.prompt },
      args.apiKey
    );
  }

  /** One image → Gaussian splat environment (places / sets). */
  imageToSplat(args: { input: string; apiKey?: string }) {
    return this.createTask('/generation/image-to-splat', { input: args.input }, args.apiKey);
  }

  /** Re-texture an existing mesh from a text and/or style-image prompt. */
  textureModel(args: {
    input: string;
    text?: string;
    styleImageUrl?: string;
    quality?: 'standard' | 'detailed';
    pbr?: boolean;
    apiKey?: string;
  }) {
    return this.createTask(
      '/models/texture',
      {
        input: args.input,
        texture: true,
        pbr: args.pbr ?? true,
        texture_quality: args.quality ?? 'standard',
        texture_prompt: {
          ...(args.text ? { text: args.text.slice(0, 1024) } : {}),
          ...(args.styleImageUrl
            ? { style_image: { type: imageExt(args.styleImageUrl), url: args.styleImageUrl } }
            : {}),
        },
      },
      args.apiKey
    );
  }

  /** Fun stylisations — lego, voxel, minecraft… */
  stylizeModel(args: { input: string; style: TripoStylizeStyle; apiKey?: string }) {
    return this.createTask(
      '/models/stylize',
      { input: args.input, style: args.style, render_image: true },
      args.apiKey
    );
  }

  /** Format conversion + game-engine prep (quad retopo, poly budget, FBX presets). */
  convertModel(args: {
    input: string;
    format: TripoConvertFormat;
    quad?: boolean;
    faceLimit?: number;
    fbxPreset?: 'blender' | '3dsmax' | 'mixamo';
    pivotToCenterBottom?: boolean;
    withAnimation?: boolean;
    partNames?: string[];
    apiKey?: string;
  }) {
    return this.createTask(
      '/models/convert',
      {
        input: args.input,
        format: args.format,
        quad: args.quad,
        face_limit: args.faceLimit,
        fbx_preset: args.format === 'FBX' ? args.fbxPreset : undefined,
        pivot_to_center_bottom: args.pivotToCenterBottom ?? true,
        with_animation: args.withAnimation,
        part_names: args.partNames,
        bake: true,
        pack_uv: true,
      },
      args.apiKey
    );
  }

  /** Split a mesh into named parts (v2 segmentation). */
  segmentMesh(args: {
    input: string;
    granularity?: 'simple' | 'balanced' | 'detailed';
    apiKey?: string;
  }) {
    return this.createTask(
      '/mesh/segment',
      {
        input: args.input,
        model: SEGMENT_MODEL,
        segmentation_granularity: args.granularity ?? 'balanced',
      },
      args.apiKey
    );
  }

  /** Fill the open faces left by segmentation so each part is a closed solid. */
  completeMesh(args: { segmentTaskId: string; partNames?: string[]; apiKey?: string }) {
    return this.createTask(
      '/mesh/complete',
      {
        input: args.segmentTaskId,
        part_names: args.partNames,
        completion_mode: 'ai_completion',
      },
      args.apiKey
    );
  }

  /** Is this mesh riggable, and as what? */
  rigCheck(args: { input: string; apiKey?: string }) {
    return this.createTask('/animations/rig-check', { input: args.input }, args.apiKey);
  }

  /** Retarget several presets in one task (one output per animation). */
  retargetAnimations(args: {
    input: string;
    animations: TripoAnimation[];
    inPlace?: boolean;
    apiKey?: string;
  }) {
    return this.createTask(
      '/animations/retarget',
      {
        input: args.input,
        animations: args.animations,
        out_format: 'glb',
        bake_animation: true,
        animate_in_place: args.inPlace ?? true,
      },
      args.apiKey
    );
  }

  async getTask(taskId: string, apiKey?: string): Promise<TripoTask> {
    const key = this.resolveKey(apiKey);
    const json = await this.get<GetTaskResponse>(`/tasks/${taskId}`, key);
    return json.data;
  }

  async waitForTask(
    taskId: string,
    maxWaitMs = 15 * 60 * 1000,
    pollIntervalMs = 5000,
    apiKey?: string
  ): Promise<TripoTask> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const task = await this.getTask(taskId, apiKey);
      if (task.status === 'success') return task;
      if (task.status !== 'queued' && task.status !== 'running') {
        throw new Error(
          `Tripo3D task ${taskId} ${task.status}: ${
            task.error_message || task.error_code || 'unknown'
          }`
        );
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Tripo3D task ${taskId} timed out after ${maxWaitMs / 1000}s`);
  }
}

/** Geometry models: H3.1 maximises fidelity, P1 gives clean engine-ready topology. */
export const TRIPO_MODEL_HIFI = 'v3.1-20260211';
export const TRIPO_MODEL_GAME = 'P1-20260311';
const SEGMENT_MODEL = 'v2.0-20260430';

export type TripoQuality = 'hifi' | 'game';
export type TripoStylizeStyle = 'lego' | 'voxel' | 'voronoi' | 'minecraft';
export type TripoConvertFormat = 'GLTF' | 'USDZ' | 'FBX' | 'OBJ' | 'STL' | '3MF';

export interface TripoGenerateOptions {
  /** `hifi` (H3.1, default) or `game` (P1, low-poly clean topology). */
  quality?: TripoQuality;
  faceLimit?: number;
  /** Return the generated front/left/back/right views alongside the mesh. */
  returnMultiview?: boolean;
  /** Generate segmented, editable parts during generation. */
  generateParts?: boolean;
  /** Render a turntable preview video. */
  renderVideo?: boolean;
}

function generateBody(o: TripoGenerateOptions): Record<string, unknown> {
  const game = o.quality === 'game';
  return {
    model: game ? TRIPO_MODEL_GAME : TRIPO_MODEL_HIFI,
    texture: true,
    pbr: true,
    texture_quality: game ? 'standard' : 'detailed',
    geometry_quality: game ? 'standard' : 'detailed',
    // Real-world metres: props and characters drop into a set at sane scale.
    auto_size: true,
    face_limit: o.faceLimit,
    smart_low_poly: game ? true : undefined,
    return_multiview: o.returnMultiview,
    generate_parts: o.generateParts,
    render_video: o.renderVideo,
  };
}

function imageExt(url: string): string {
  const m = /\.(png|jpe?g|webp)(?:$|\?)/i.exec(url);
  return m ? m[1].toLowerCase().replace('jpg', 'jpeg') : 'png';
}

/**
 * Collect the four turnaround views from whichever field a task reports
 * them in (image-to-multiview uses top-level `*_view_url`, generation tasks
 * with `return_multiview` nest them under `generate_multiview_image`).
 */
export function tripoMultiviewUrls(task: TripoTask): {
  front?: string;
  left?: string;
  back?: string;
  right?: string;
} {
  const o = task.output ?? {};
  const n = o.generate_multiview_image ?? {};
  return {
    front: o.front_view_url ?? n.front_view_url,
    left: o.left_view_url ?? n.left_view_url,
    back: o.back_view_url ?? n.back_view_url,
    right: o.right_view_url ?? n.right_view_url,
  };
}

function inferFilename(url: string, fallback = 'model.glb'): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  } catch {
    // fallthrough
  }
  return fallback;
}

/** True for URLs on our token-gated IPFS gateway, which Tripo can't fetch. */
function needsGatewayAuth(input: string): boolean {
  return /^https?:\/\//i.test(input) && authorizedMediaUrl(input) !== input;
}

export const tripo3dService = new Tripo3dService();
