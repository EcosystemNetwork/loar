/**
 * Tripo3D Service — non-humanoid rigging + animation library (OpenAPI v3).
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

const BASE_URL = 'https://openapi.tripo3d.ai/v3';

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
  };
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
      throw new Error(
        'No Tripo3D API key available — add one at /settings/api-keys to use this model.'
      );
    }
    return key;
  }

  private async post<T>(path: string, body: Record<string, unknown>, apiKey: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return this.parse<T>(res);
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
    const key = this.resolveKey(apiKey);
    const fetched = await fetch(modelUrl);
    if (!fetched.ok) {
      throw new Error(`Failed to fetch source GLB for Tripo upload: ${fetched.status}`);
    }
    const blob = await fetched.blob();

    const form = new FormData();
    form.append(
      'file',
      new File([blob], inferFilename(modelUrl), { type: blob.type || 'model/gltf-binary' })
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

function inferFilename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return last;
  } catch {
    // fallthrough
  }
  return 'model.glb';
}

export const tripo3dService = new Tripo3dService();
