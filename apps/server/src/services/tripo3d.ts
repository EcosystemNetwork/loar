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
  // Kept for backwards compatibility with our rig-type enum. Not a v3
  // `rig_type` — `rigModel` rejects it before uploading anything.
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
  | 'preset:aquatic:march'
  | TripoBipedClip;

/**
 * Tripo's extended motion library — biped rigs built on RIG_MODEL_BIPED
 * (v1.0) only. Source: developers.tripo3d.ai/en/docs/animations-retarget.
 * Grouped for the character studio's picker; ids are sent verbatim.
 */
export const TRIPO_BIPED_LIBRARY = {
  Locomotion: [
    'preset:biped:walk',
    'preset:biped:run',
    'preset:biped:swagger',
    'preset:biped:run_upstairs',
    'preset:biped:jump',
    'preset:biped:jump_down',
    'preset:biped:flip',
    'preset:biped:climb',
    'preset:biped:dive',
    'preset:biped:swim',
    'preset:biped:surf',
    'preset:biped:flee_01',
    'preset:biped:flee_02',
  ],
  Idle: [
    'preset:biped:idle',
    'preset:biped:wait',
    'preset:biped:standing_relax',
    'preset:biped:look_around',
    'preset:biped:fold_arms',
    'preset:biped:scratch',
    'preset:biped:sit',
    'preset:biped:warm_up',
  ],
  Combat: [
    'preset:biped:slash',
    'preset:biped:chop',
    'preset:biped:shoot',
    'preset:biped:fire',
    'preset:biped:cast_a_spell',
    'preset:biped:box_01',
    'preset:biped:box_02',
    'preset:biped:box_03',
    'preset:biped:front_kick_01',
    'preset:biped:front_kick_02',
    'preset:biped:hurt',
    'preset:biped:hit_to_body_01',
    'preset:biped:hit_to_body_02',
    'preset:biped:hit_to_head',
    'preset:biped:hit_to_side',
    'preset:biped:hit_to_stomach',
    'preset:biped:fall',
    'preset:biped:defeat_02',
    'preset:biped:defeat_03',
    'preset:biped:victory_celebration',
  ],
  Emotes: [
    'preset:biped:greet_01',
    'preset:biped:greet_02',
    'preset:biped:greet_03',
    'preset:biped:greet_04',
    'preset:biped:wave_goodbye_01',
    'preset:biped:wave_goodbye_02',
    'preset:biped:bow',
    'preset:biped:agree',
    'preset:biped:cheer',
    'preset:biped:clap',
    'preset:biped:hug',
    'preset:biped:heart_pose',
    'preset:biped:laugh_01',
    'preset:biped:laugh_02',
    'preset:biped:angry_01',
    'preset:biped:angry_02',
    'preset:biped:angry_03',
    'preset:biped:complain_01',
    'preset:biped:complain_02',
    'preset:biped:frustrated_01',
    'preset:biped:frustrated_02',
    'preset:biped:afraid',
    'preset:biped:frightened',
    'preset:biped:scared_01',
    'preset:biped:scared_02',
    'preset:biped:cry',
    'preset:biped:sob',
    'preset:biped:depressed',
    'preset:biped:freaky',
  ],
  Dance: [
    'preset:biped:dance_01',
    'preset:biped:dance_02',
    'preset:biped:dance_03',
    'preset:biped:dance_04',
    'preset:biped:dance_05',
    'preset:biped:dance_06',
    'preset:biped:sing_01',
    'preset:biped:sing_02',
    'preset:biped:sing_03',
    'preset:biped:sing_04',
  ],
  Activities: [
    'preset:biped:dig',
    'preset:biped:shovel',
    'preset:biped:lift_heavy',
    'preset:biped:press-up',
    'preset:biped:cross_body_crunch',
    'preset:biped:jump_rope_01',
    'preset:biped:jump_rope_02',
    'preset:biped:make_a_call_01',
    'preset:biped:make_a_call_02',
    'preset:biped:play_mobile_game',
    'preset:biped:play_video_game',
  ],
  Sports: [
    'preset:biped:basketball_shot',
    'preset:biped:dribble',
    'preset:biped:crossover_dribble',
    'preset:biped:football_pass',
    'preset:biped:football_catch',
    'preset:biped:football_save',
    'preset:biped:pitch_baseball',
    'preset:biped:golf',
    'preset:biped:volleyball',
  ],
} as const;

export type TripoBipedClip = (typeof TRIPO_BIPED_LIBRARY)[keyof typeof TRIPO_BIPED_LIBRARY][number];

export const TRIPO_BIPED_CLIPS: readonly TripoBipedClip[] =
  Object.values(TRIPO_BIPED_LIBRARY).flat();

/** Tripo rejects a retarget request with more than this many `animations`. */
export const TRIPO_MAX_ANIMATIONS_PER_RETARGET = 5;

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

interface TripoErrorBody {
  code?: number;
  message?: string;
  suggestion?: string;
  request_id?: string;
}

/**
 * Codes from Tripo's Error Handling guide that the user (not us) has to act
 * on — a BYOK key, the user's own credits, or their content.
 */
const TRIPO_USER_FACING: Record<number, string> = {
  2: 'Your Tripo3D API key was rejected — use the secret key (starts with tsk_) from /settings/api-keys',
  1000: 'Your Tripo3D API key is invalid or was deleted — update it at /settings/api-keys',
  1001: 'Your Tripo3D API key is missing — add one at /settings/api-keys',
  2008: 'Tripo3D blocked this input under its content policy — try a different image or prompt',
  2010: 'Your Tripo3D account is out of credits — top up at platform.tripo3d.ai',
  2015: 'Tripo3D retired this model version',
  2018: 'This model is too complex for Tripo3D — reduce its polycount first',
};

/**
 * A Tripo HTTP/API error. The message keeps the `Tripo3D API error` prefix
 * that job failure records and tests match on, and leads with a readable
 * explanation for the codes a user can fix themselves.
 */
export class TripoApiError extends Error {
  readonly status: number;
  readonly code?: number;
  readonly suggestion?: string;
  readonly requestId?: string;

  constructor(args: {
    status: number;
    code?: number;
    message: string;
    suggestion?: string;
    requestId?: string;
  }) {
    const friendly = args.code !== undefined ? TRIPO_USER_FACING[args.code] : undefined;
    const where = args.code !== undefined ? `${args.status}, code ${args.code}` : `${args.status}`;
    const hint = args.suggestion ? ` — ${args.suggestion}` : '';
    super(
      friendly
        ? `${friendly} (Tripo3D API error ${where})`
        : `Tripo3D API error ${where}: ${args.message}${hint}`
    );
    this.name = 'TripoApiError';
    this.status = args.status;
    this.code = args.code;
    this.suggestion = args.suggestion;
    this.requestId = args.requestId;
  }
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

  /** Base backoff for 429/5xx retries; tests shrink it. */
  rateLimitBackoffMs = 5000;

  /**
   * One HTTP call with Tripo's documented retry policy (Rate Limits / Error
   * Handling guides):
   *  - 429 — code 2000 (account concurrency full for that task category, e.g.
   *    tripo.batchEntityTo3D starting five jobs on a low-tier key; image
   *    generation's pool is only 1) or 1007 (per-key request rate). The
   *    request was rejected, so resubmitting is safe: wait Retry-After, else
   *    X-RateLimit-Reset, else exponential — capped at 60s.
   *  - 502/503/504 and network failures — transient. Reads (`idempotent`)
   *    always retry them. Submits retry them too: a gateway error means
   *    Tripo never answered, and failing a 20-minute job over one blip is
   *    worse than the rare duplicate task.
   *  - 500 — retried only for reads; a 500 on submit may already have
   *    created (and billed) a task.
   * Everything else (400/401/403/404) fails immediately.
   */
  private async send<T>(
    path: string,
    init: () => RequestInit,
    apiKey: string,
    idempotent: boolean
  ): Promise<T> {
    const MAX_RATE_LIMIT_ATTEMPTS = 8;
    const MAX_TRANSIENT_ATTEMPTS = 4;
    let transientFailures = 0;
    for (let attempt = 1; ; attempt++) {
      const req = init();
      let res: Response;
      try {
        res = await fetch(`${BASE_URL}${path}`, {
          ...req,
          headers: { Authorization: `Bearer ${apiKey}`, ...(req.headers ?? {}) },
        });
      } catch (err) {
        if (++transientFailures >= MAX_TRANSIENT_ATTEMPTS) throw err;
        await sleep(this.backoff(transientFailures));
        continue;
      }
      const transient = res.status === 502 || res.status === 503 || res.status === 504;
      const retryable =
        (res.status === 429 && attempt < MAX_RATE_LIMIT_ATTEMPTS) ||
        ((transient || (idempotent && res.status === 500)) &&
          ++transientFailures < MAX_TRANSIENT_ATTEMPTS);
      if (!retryable) return this.parse<T>(res);
      const waitMs = retryDelayMs(res.headers) ?? this.backoff(attempt);
      await res.body?.cancel().catch(() => undefined);
      await sleep(waitMs);
    }
  }

  private backoff(attempt: number): number {
    return Math.min(this.rateLimitBackoffMs * 2 ** (attempt - 1), 60_000);
  }

  private post<T>(path: string, body: Record<string, unknown>, apiKey: string): Promise<T> {
    return this.send<T>(
      path,
      () => ({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      apiKey,
      false
    );
  }

  private get<T>(path: string, apiKey: string): Promise<T> {
    return this.send<T>(path, () => ({ method: 'GET' }), apiKey, true);
  }

  /** Shared response handler — surfaces both HTTP errors and `code != 0` bodies. */
  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text().catch(() => res.statusText);
    let json: (T & TripoErrorBody) | undefined;
    try {
      json = JSON.parse(text) as T & TripoErrorBody;
    } catch {
      // Non-JSON body (proxy error page) — reported verbatim below.
    }
    const code = typeof json?.code === 'number' ? json.code : undefined;
    if (!res.ok || (code !== undefined && code !== 0)) {
      throw new TripoApiError({
        status: res.status,
        code,
        message: json?.message ?? text,
        suggestion: json?.suggestion,
        requestId: json?.request_id ?? res.headers.get('x-request-id') ?? undefined,
      });
    }
    if (!json)
      throw new TripoApiError({ status: res.status, message: `Unparseable body: ${text}` });
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

    const json = await this.send<UploadResponse>(
      '/files',
      () => ({ method: 'POST', body: form }),
      key,
      false
    );
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
    if (args.rigType === 'others') {
      throw new Error(
        'Tripo3D has no skeleton for this shape (vehicles, mechs, props) — it rigs bipeds, ' +
          'quadrupeds, hexapods, octopods, birds, snakes and fish'
      );
    }
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
    if (typeof clean.input === 'string') clean.input = await this.fetchableInput(clean.input, key);
    const json = await this.post<CreateTaskResponse>(path, clean, key);
    if (!json.data?.task_id) throw new Error(`Tripo3D ${path} returned no task id`);
    return { taskId: json.data.task_id };
  }

  /**
   * Tripo fetches URL inputs itself, and our dedicated gateway 401s without
   * its token (code 1004 "input image URL is not accessible") — which failed
   * every entity cover → 3D job. Upload those through /files instead of
   * handing the gateway token to a third party. Task ids, file tokens and
   * public URLs pass through untouched.
   */
  private async fetchableInput(input: string, key: string): Promise<string> {
    return needsGatewayAuth(input)
      ? this.uploadRemoteFile(input, key, 'image.png', 'image/png')
      : input;
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
   * Front + up to three more views → mesh. Pass a prior `imageToMultiview`
   * task id (preferred — keeps the views Tripo itself generated) or view URLs.
   *
   * v3 `inputs` is either `[{ task_id }]` or view-key objects holding exactly
   * one view each (`[{ front: url }, { left: url }]`); the front view is
   * mandatory and at least two images are required.
   */
  async multiviewToModel(
    args: TripoGenerateOptions & {
      multiviewTaskId?: string;
      views?: { front: string; left?: string; back?: string; right?: string };
      apiKey?: string;
    }
  ) {
    const { multiviewTaskId, views, apiKey, ...opts } = args;
    if (!multiviewTaskId && !views) throw new Error('multiviewToModel needs a task id or views');
    const key = this.resolveKey(apiKey);
    let inputs: Array<Record<string, string>>;
    if (multiviewTaskId) {
      inputs = [{ task_id: multiviewTaskId }];
    } else {
      const present = MULTIVIEW_ORDER.filter((v) => !!views![v]);
      if (!views!.front || present.length < 2) {
        throw new Error('multiviewToModel needs a front view plus at least one other view');
      }
      inputs = await Promise.all(
        present.map(async (v) => ({ [v]: await this.fetchableInput(views![v]!, key) }))
      );
    }
    return this.createTask(
      '/generation/multiview-to-model',
      { inputs, ...generateBody(opts) },
      key
    );
  }

  /** One image → front/left/back/right character sheet (turnaround). */
  imageToMultiview(args: { input: string; apiKey?: string }) {
    return this.createTask('/generation/image-to-multiview', { input: args.input }, args.apiKey);
  }

  /**
   * Image edit with a Tripo template — `t_pose` normalises a character
   * cover into a clean A/T-pose full-body render that rigs far better than
   * an action shot; `3d_enhance` cleans an image up for 3D generation;
   * `figure` renders a full-body figure from a partial one.
   */
  imageToImage(args: {
    input: string;
    template?: TripoImageTemplate;
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

  /**
   * Re-texture an existing mesh from a text prompt, a reference image, or
   * both. `texture_prompt` takes exactly one of `text` / `image`; a reference
   * image rides along with text as `style_image`, alone it is the `image`.
   */
  async textureModel(args: {
    input: string;
    text?: string;
    styleImageUrl?: string;
    quality?: 'standard' | 'detailed';
    pbr?: boolean;
    /** Only retexture these parts (names from a segmentation task). */
    partNames?: string[];
    apiKey?: string;
  }) {
    const key = this.resolveKey(args.apiKey);
    const text = args.text?.trim() ? args.text.slice(0, 1024) : undefined;
    // Gateway-gated references come back as a file token.
    const refInput = args.styleImageUrl
      ? await this.fetchableInput(args.styleImageUrl, key)
      : undefined;
    const ref = refInput
      ? /^https?:\/\//i.test(refInput)
        ? { url: refInput }
        : { file_token: refInput }
      : undefined;
    const texturePrompt = text
      ? { text, ...(ref ? { style_image: ref } : {}) }
      : ref
        ? { image: ref }
        : undefined;
    return this.createTask(
      '/models/texture',
      {
        input: args.input,
        model: TRIPO_TEXTURE_MODEL,
        pbr: args.pbr ?? true,
        texture_quality: args.quality ?? 'standard',
        texture_prompt: texturePrompt,
        part_names: args.partNames,
      },
      key
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

  /**
   * Retarget several presets in one task (one output per animation). At most
   * TRIPO_MAX_ANIMATIONS_PER_RETARGET per call — callers batch larger sets.
   */
  retargetAnimations(args: {
    input: string;
    animations: TripoAnimation[];
    inPlace?: boolean;
    apiKey?: string;
  }) {
    if (args.animations.length > TRIPO_MAX_ANIMATIONS_PER_RETARGET) {
      throw new Error(
        `Tripo3D retargets at most ${TRIPO_MAX_ANIMATIONS_PER_RETARGET} animations per task`
      );
    }
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
/**
 * Texture model (2026-09). Pinned on every textured generation and retexture:
 * same price and output size as the v3.0 default, and its `delight` pass
 * (on by default) strips lighting baked into the reference image, so assets
 * don't carry the cover art's shadows into a lit 3D scene.
 */
export const TRIPO_TEXTURE_MODEL = 'v3.5-20260815';
const SEGMENT_MODEL = 'v2.0-20260430';
const MULTIVIEW_ORDER = ['front', 'left', 'back', 'right'] as const;

export type TripoQuality = 'hifi' | 'game';
export type TripoImageTemplate =
  | 't_pose'
  | 'character_completion'
  | '3d_enhance'
  | 'variants'
  | 'figure';
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

/**
 * Shared generation fields, respecting what each model series accepts:
 *  - P series takes no `geometry_quality` / `smart_low_poly` /
 *    `generate_parts` (P1 is already the clean low-poly model; P1 face_limit
 *    is 50–20,000).
 *  - `generate_parts` is rejected (1004) unless texture and PBR are off, so
 *    parts are untextured meshes — texture them afterwards per part.
 */
export function generateBody(o: TripoGenerateOptions): Record<string, unknown> {
  const game = o.quality === 'game';
  const parts = !game && !!o.generateParts;
  return {
    model: game ? TRIPO_MODEL_GAME : TRIPO_MODEL_HIFI,
    texture: !parts,
    pbr: !parts,
    texture_version: parts ? undefined : TRIPO_TEXTURE_MODEL,
    texture_quality: parts ? undefined : game ? 'standard' : 'detailed',
    geometry_quality: game ? undefined : 'detailed',
    // Real-world metres: props and characters drop into a set at sane scale.
    auto_size: true,
    face_limit:
      o.faceLimit === undefined
        ? undefined
        : game
          ? Math.min(Math.max(o.faceLimit, 50), 20_000)
          : o.faceLimit,
    generate_parts: parts || undefined,
    // Not in the v3 reference (Tripo ignores unknown fields); kept so a
    // turntable/multiview comes back if the account still gets one.
    return_multiview: o.returnMultiview,
    render_video: o.renderVideo,
  };
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

/**
 * How long Tripo asked us to wait: `Retry-After` (seconds) on concurrency
 * 429s, else `X-RateLimit-Reset` (unix seconds) on rate 429s. Capped at 60s.
 */
function retryDelayMs(headers: Headers): number | undefined {
  const retryAfter = Number(headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 60_000);
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    const ms = reset * 1000 - Date.now();
    if (ms > 0) return Math.min(ms, 60_000);
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
