/**
 * Tripo3D Service — non-humanoid rigging + animation library.
 *
 * Covers what Meshy can't: quadrupeds, birds, snakes, fish, insects, spiders,
 * mechanical creatures, vehicles. Tripo's rig types are
 *   biped, quadruped, hexapod, octopod, avian, serpentine, aquatic, others.
 *
 * Workflow for an externally-generated GLB (e.g. a Meshy textured mesh):
 *   1. Download the GLB and POST it to /upload          → image_token
 *   2. POST /task type=import_model                      → originalModelTaskId
 *   3. POST /task type=animate_rig (rig_type + spec)     → rigTaskId
 *   4. POST /task type=animate_retarget (animation)      → animationTaskId
 *   5. GET /task/{id} polled until status=success        → output.model URL
 *
 * Required env var: TRIPO_API_KEY (or BYOK via provider-keys store).
 */

const BASE_URL = 'https://api.tripo3d.ai/v2/openapi';

export type TripoRigType =
  | 'biped'
  | 'quadruped'
  | 'hexapod'
  | 'octopod'
  | 'avian'
  | 'serpentine'
  | 'aquatic'
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

export type TripoTaskStatus =
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'banned'
  | 'expired';

export interface TripoTask {
  task_id: string;
  type: string;
  status: TripoTaskStatus;
  progress?: number;
  output?: {
    model?: string;
    pbr_model?: string;
    rendered_video?: string;
    rendered_image?: string;
    base_model?: string;
  };
  error?: { code?: string; message?: string };
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
  data: { image_token: string };
}

class Tripo3dService {
  private envKey: string | undefined;

  constructor() {
    this.envKey = process.env.TRIPO_API_KEY;
  }

  isConfigured(): boolean {
    return !!this.envKey;
  }

  private resolveKey(override?: string): string {
    const key = override?.trim() || this.envKey;
    if (!key) throw new Error('TRIPO_API_KEY is not configured');
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
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Tripo3D API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  private async get<T>(path: string, apiKey: string): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Tripo3D API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /**
   * Stream a remote GLB through Tripo's /upload endpoint. Returns the
   * file token used as the `file` reference on the subsequent import_model
   * task. Direct (non-STS) upload — works for files up to Tripo's per-file
   * cap (~100 MB at time of writing; well above any single Meshy mesh).
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

    const res = await fetch(`${BASE_URL}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Tripo3D upload error ${res.status}: ${text}`);
    }
    const json = (await res.json()) as UploadResponse;
    if (!json.data?.image_token) {
      throw new Error('Tripo3D upload returned no file token');
    }
    return json.data.image_token;
  }

  /**
   * Register an uploaded file as a Tripo task that downstream rig/animate
   * calls can reference via `original_model_task_id`.
   */
  async importModel(fileToken: string, apiKey?: string): Promise<{ taskId: string }> {
    const key = this.resolveKey(apiKey);
    const json = await this.post<CreateTaskResponse>(
      '/task',
      { type: 'import_model', file: { file_token: fileToken } },
      key
    );
    return { taskId: json.data.task_id };
  }

  async rigModel(args: {
    originalModelTaskId: string;
    rigType: TripoRigType;
    spec?: TripoRigSpec;
    outFormat?: 'glb' | 'fbx';
    apiKey?: string;
  }): Promise<{ taskId: string }> {
    const key = this.resolveKey(args.apiKey);
    const json = await this.post<CreateTaskResponse>(
      '/task',
      {
        type: 'animate_rig',
        original_model_task_id: args.originalModelTaskId,
        rig_type: args.rigType,
        spec: args.spec ?? 'tripo',
        out_format: args.outFormat ?? 'glb',
      },
      key
    );
    return { taskId: json.data.task_id };
  }

  async retargetAnimation(args: {
    rigTaskId: string;
    animation: TripoAnimation;
    outFormat?: 'glb' | 'fbx';
    bakeAnimation?: boolean;
    apiKey?: string;
  }): Promise<{ taskId: string }> {
    const key = this.resolveKey(args.apiKey);
    const json = await this.post<CreateTaskResponse>(
      '/task',
      {
        type: 'animate_retarget',
        original_model_task_id: args.rigTaskId,
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
    const json = await this.get<GetTaskResponse>(`/task/${taskId}`, key);
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
      if (task.status === 'failed' || task.status === 'banned') {
        throw new Error(
          `Tripo3D task ${taskId} ${task.status}: ${task.error?.message || 'unknown'}`
        );
      }
      if (task.status === 'cancelled' || task.status === 'expired') {
        throw new Error(`Tripo3D task ${taskId} ${task.status}`);
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
