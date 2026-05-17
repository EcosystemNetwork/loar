/**
 * Meshy Service — 3D Generation
 *
 * Supports all Meshy v2 3D generation tasks in the LOAR Studio OS:
 *   text-to-3D    preview → refine pipeline
 *   image-to-3D   single image or multi-image (higher consistency)
 *
 * Pricing (approximate):
 *   text-to-3D preview  ~$0.05/task
 *   text-to-3D refine   ~$0.20/task
 *   image-to-3D         ~$0.15/task
 *
 * Required env var: MESHY_API_KEY
 */

const API_HOST = 'https://api.meshy.ai';
// Different endpoint families use different API versions
const IMAGE_TO_3D_BASE = `${API_HOST}/openapi/v1`;
const TEXT_TO_3D_BASE = `${API_HOST}/openapi/v2`;
// Legacy fallback (kept for backward compat)
const BASE_URL = IMAGE_TO_3D_BASE;

// ── Types ─────────────────────────────────────────────────────────────

export type MeshyArtStyle = 'realistic' | 'cartoon' | 'low-poly' | 'sculpture' | 'pbr'; // physically based rendering

export type MeshyTaskStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED';

export interface MeshyTaskOutput {
  glb?: string; // GLB model URL
  fbx?: string; // FBX model URL
  obj?: string; // OBJ model URL
  mtl?: string; // MTL material URL
  usdz?: string; // USDZ for AR
  thumbnail?: string;
  textures?: string[];
}

export interface MeshyTask {
  id: string;
  status: MeshyTaskStatus;
  progress: number; // 0–100
  created_at: number;
  started_at?: number;
  finished_at?: number;
  task_error?: { message: string };
  // API returns snake_case keys
  model_urls: MeshyTaskOutput;
  model_url?: string; // single GLB URL shortcut
  thumbnail_url?: string;
  video_url?: string; // 360° preview video
  texture_urls?: Array<Record<string, string>>;
  // Convenience aliases (camelCase) — populated by normalizeTask()
  modelUrls: MeshyTaskOutput;
  thumbnailUrl?: string;
  videoUrl?: string;
  taskError?: { message: string };
}

export interface TextTo3DPreviewOptions {
  prompt: string;
  negativePrompt?: string;
  artStyle?: MeshyArtStyle;
  seed?: number;
  aiModel?: 'meshy-4' | 'meshy-5' | 'meshy-6';
  topology?: 'quad' | 'triangle';
  targetPolycount?: number; // e.g. 30000
  /** BYOK override — user-supplied Meshy key. Falls back to MESHY_API_KEY env. */
  apiKey?: string;
}

export interface TextTo3DRefineOptions {
  previewTaskId: string;
  textureRichness?: 'high' | 'medium' | 'low';
  /** BYOK override — user-supplied Meshy key. */
  apiKey?: string;
}

export interface ImageTo3DOptions {
  imageUrl: string;
  enablePbr?: boolean; // physically based rendering textures
  shouldRemountBackground?: boolean;
  aiModel?: 'meshy-4' | 'meshy-5' | 'meshy-6';
  topology?: 'quad' | 'triangle';
  targetPolycount?: number;
  /** BYOK override — user-supplied Meshy key. */
  apiKey?: string;
}

export interface MultiImageTo3DOptions {
  imageUrls: string[]; // 2–4 images from different angles
  enablePbr?: boolean;
  topology?: 'quad' | 'triangle';
  targetPolycount?: number;
  /** BYOK override — user-supplied Meshy key. */
  apiKey?: string;
}

export interface TextToTextureOptions {
  /** Meshy model URL (GLB) or a previous task ID to re-texture */
  modelUrl: string;
  /** Text description of the desired texture/material */
  prompt: string;
  negativePrompt?: string;
  /** Art style for texturing */
  artStyle?: MeshyArtStyle;
  /** Resolution: 1024, 2048, or 4096 */
  resolution?: number;
  enableOriginalUV?: boolean;
  enablePbr?: boolean;
  /** Painting style: texture or vertex-color */
  paintingStyle?: 'texture' | 'vertex-color';
  /** BYOK override — user-supplied Meshy key. */
  apiKey?: string;
}

export interface MeshyTextureTask extends MeshyTask {
  textureUrls?: string[];
}

// ── Rigging & Animation (Meshy auto-rig + animation library) ──────────

export interface RigOptions {
  /** Public URL or Data URI for a textured humanoid GLB. */
  modelUrl?: string;
  /** Alternative to modelUrl — reuse a previous Meshy image-to-3D task. */
  inputTaskId?: string;
  /** Approximate character height in metres (Meshy default 1.7). */
  heightMeters?: number;
  /** BYOK override. */
  apiKey?: string;
}

export interface MeshyRiggingTask {
  id: string;
  status: MeshyTaskStatus;
  progress: number;
  task_error?: { message: string };
  taskError?: { message: string };
  /** Rigged result URLs (snake_case from API). */
  rigged_model_urls?: { glb?: string; fbx?: string };
  riggedModelUrls?: { glb?: string; fbx?: string };
  /** Walk/run animations Meshy bakes into the rig output. */
  basic_animations?: Record<string, { glb?: string; fbx?: string }>;
  basicAnimations?: Record<string, { glb?: string; fbx?: string }>;
  thumbnail_url?: string;
  thumbnailUrl?: string;
}

export interface AnimateOptions {
  /** Task ID from a completed rigging task. */
  rigTaskId: string;
  /** Preset ID from the Meshy animation library (e.g. 0=Idle, 14=Run). */
  actionId: number;
  /** Frame-rate override for the post-processed clip. */
  fps?: number;
  /** BYOK override. */
  apiKey?: string;
}

export interface MeshyAnimationTask {
  id: string;
  status: MeshyTaskStatus;
  progress: number;
  task_error?: { message: string };
  taskError?: { message: string };
  /** GLB with the chosen animation baked in (snake_case from API). */
  animation_glb_url?: string;
  animationGlbUrl?: string;
  animation_fbx_url?: string;
  animationFbxUrl?: string;
  processed_usdz_url?: string;
  processedUsdzUrl?: string;
  thumbnail_url?: string;
  thumbnailUrl?: string;
  consumed_credits?: number;
}

// ── Service ───────────────────────────────────────────────────────────

class MeshyService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.MESHY_API_KEY;
  }

  private resolveKey(override?: string): string {
    const key = override?.trim() || this.apiKey;
    if (!key) throw new Error('MESHY_API_KEY is not configured');
    return key;
  }

  private headersFor(apiKey: string): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
    apiKey: string,
    baseUrl = BASE_URL
  ): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: this.headersFor(apiKey),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Meshy API error ${response.status}: ${text}`);
    }
    return response.json() as Promise<T>;
  }

  private async get<T>(path: string, apiKey: string, baseUrl = BASE_URL): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, { headers: this.headersFor(apiKey) });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Meshy API error ${response.status}: ${text}`);
    }
    return response.json() as Promise<T>;
  }

  // ── Text-to-3D ────────────────────────────────────────────────────────

  /**
   * Start a text-to-3D preview task.
   * Returns immediately with a task ID — poll getTask() until SUCCEEDED.
   */
  async textTo3DPreview(options: TextTo3DPreviewOptions): Promise<{ taskId: string }> {
    const apiKey = this.resolveKey(options.apiKey);
    const data = await this.post<{ result: string }>(
      '/text-to-3d',
      {
        mode: 'preview',
        prompt: options.prompt,
        ai_model: options.aiModel || 'meshy-6',
        topology: options.topology,
        target_polycount: options.targetPolycount,
      },
      apiKey,
      TEXT_TO_3D_BASE
    );
    return { taskId: data.result };
  }

  /**
   * Start a refine task from a completed preview task.
   * Returns a new task ID for the refined result.
   */
  async textTo3DRefine(options: TextTo3DRefineOptions): Promise<{ taskId: string }> {
    const apiKey = this.resolveKey(options.apiKey);
    const data = await this.post<{ result: string }>(
      '/text-to-3d',
      {
        mode: 'refine',
        preview_task_id: options.previewTaskId,
        enable_pbr: true,
        texture_prompt: options.textureRichness === 'high' ? '' : undefined,
      },
      apiKey,
      TEXT_TO_3D_BASE
    );
    return { taskId: data.result };
  }

  // ── Image-to-3D ───────────────────────────────────────────────────────

  async imageTo3D(options: ImageTo3DOptions): Promise<{ taskId: string }> {
    const apiKey = this.resolveKey(options.apiKey);
    const body: Record<string, unknown> = {
      image_url: options.imageUrl,
      ai_model: options.aiModel || 'meshy-6',
      should_texture: true,
      enable_pbr: options.enablePbr ?? false,
      topology: options.topology || 'triangle',
      target_polycount: options.targetPolycount || 30000,
    };
    if (options.shouldRemountBackground !== undefined) {
      body.should_remount_background = options.shouldRemountBackground;
    }
    const data = await this.post<{ result: string }>(
      '/image-to-3d',
      body,
      apiKey,
      IMAGE_TO_3D_BASE
    );
    return { taskId: data.result };
  }

  // ── Multi-Image-to-3D (higher consistency) ────────────────────────────

  async multiImageTo3D(options: MultiImageTo3DOptions): Promise<{ taskId: string }> {
    if (options.imageUrls.length < 2 || options.imageUrls.length > 4) {
      throw new Error('multiImageTo3D requires 2–4 images');
    }
    const apiKey = this.resolveKey(options.apiKey);
    const data = await this.post<{ result: string }>(
      '/image-to-3d',
      {
        image_urls: options.imageUrls,
        ai_model: 'meshy-6',
        should_texture: true,
        enable_pbr: options.enablePbr ?? false,
        topology: options.topology || 'triangle',
        target_polycount: options.targetPolycount || 30000,
      },
      apiKey,
      IMAGE_TO_3D_BASE
    );
    return { taskId: data.result };
  }

  // ── Text-to-Texture ───────────────────────────────────────────────────

  /**
   * Apply AI-generated textures to an existing 3D model.
   * Pass a GLB model URL and a text description of the desired texture.
   */
  async textToTexture(options: TextToTextureOptions): Promise<{ taskId: string }> {
    const apiKey = this.resolveKey(options.apiKey);
    const data = await this.post<{ result: string }>(
      '/retexture',
      {
        model_url: options.modelUrl,
        text_style_prompt: options.prompt,
        ai_model: 'meshy-6',
        enable_original_uv: options.enableOriginalUV ?? true,
        enable_pbr: options.enablePbr ?? true,
        remove_lighting: true,
      },
      apiKey,
      IMAGE_TO_3D_BASE
    );
    return { taskId: data.result };
  }

  async getTextToTextureTask(taskId: string, apiKey?: string): Promise<MeshyTextureTask> {
    const key = this.resolveKey(apiKey);
    const task = await this.get<MeshyTextureTask>(`/retexture/${taskId}`, key, IMAGE_TO_3D_BASE);
    return this.normalizeTask(task) as MeshyTextureTask;
  }

  /**
   * Poll a texture task until terminal state.
   */
  async waitForTextureTask(
    taskId: string,
    maxWaitMs = 10 * 60 * 1000,
    pollIntervalMs = 5000,
    apiKey?: string
  ): Promise<MeshyTextureTask> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const task = await this.getTextToTextureTask(taskId, apiKey);
      if (task.status === 'SUCCEEDED') return task;
      if (task.status === 'FAILED') {
        throw new Error(
          `Meshy texture task ${taskId} failed: ${task.taskError?.message || 'unknown'}`
        );
      }
      if (task.status === 'EXPIRED') {
        throw new Error(`Meshy texture task ${taskId} expired`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Meshy texture task ${taskId} timed out after ${maxWaitMs / 1000}s`);
  }

  // ── Status / Polling ──────────────────────────────────────────────────

  /** Normalize snake_case API response to include camelCase aliases */
  private normalizeTask(task: MeshyTask): MeshyTask {
    task.modelUrls = task.model_urls || task.modelUrls || ({} as MeshyTaskOutput);
    task.thumbnailUrl = task.thumbnail_url || task.thumbnailUrl;
    task.videoUrl = task.video_url || task.videoUrl;
    task.taskError = task.task_error || task.taskError;
    return task;
  }

  async getTextTo3DTask(taskId: string, apiKey?: string): Promise<MeshyTask> {
    const key = this.resolveKey(apiKey);
    const task = await this.get<MeshyTask>(`/text-to-3d/${taskId}`, key, TEXT_TO_3D_BASE);
    return this.normalizeTask(task);
  }

  async getImageTo3DTask(taskId: string, apiKey?: string): Promise<MeshyTask> {
    const key = this.resolveKey(apiKey);
    const task = await this.get<MeshyTask>(`/image-to-3d/${taskId}`, key, IMAGE_TO_3D_BASE);
    return this.normalizeTask(task);
  }

  /**
   * Poll a task until it reaches a terminal state or the timeout is hit.
   * Resolves with the completed task or throws on failure/timeout.
   */
  async waitForTask(
    taskId: string,
    type: 'text-to-3d' | 'image-to-3d',
    maxWaitMs = 5 * 60 * 1000,
    pollIntervalMs = 5000,
    apiKey?: string
  ): Promise<MeshyTask> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const task =
        type === 'text-to-3d'
          ? await this.getTextTo3DTask(taskId, apiKey)
          : await this.getImageTo3DTask(taskId, apiKey);

      if (task.status === 'SUCCEEDED') return task;
      if (task.status === 'FAILED') {
        throw new Error(`Meshy task ${taskId} failed: ${task.taskError?.message || 'unknown'}`);
      }
      if (task.status === 'EXPIRED') {
        throw new Error(`Meshy task ${taskId} expired`);
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Meshy task ${taskId} timed out after ${maxWaitMs / 1000}s`);
  }

  // ── Rigging ───────────────────────────────────────────────────────────

  /**
   * Auto-rig a textured humanoid GLB so it can accept library animations.
   * One of `modelUrl` or `inputTaskId` is required. Returns a task ID that
   * must be polled until SUCCEEDED — typical wall-clock is 1-3 min.
   *
   * Meshy ships walk/run animations baked into the rigging output, available
   * under `basic_animations`. Apply richer animations separately via
   * `applyAnimation` using the rig task ID.
   */
  async rigModel(options: RigOptions): Promise<{ taskId: string }> {
    if (!options.modelUrl && !options.inputTaskId) {
      throw new Error('rigModel requires modelUrl or inputTaskId');
    }
    const apiKey = this.resolveKey(options.apiKey);
    const body: Record<string, unknown> = {};
    if (options.inputTaskId) body.input_task_id = options.inputTaskId;
    else if (options.modelUrl) body.model_url = options.modelUrl;
    if (options.heightMeters) body.height_meters = options.heightMeters;
    const data = await this.post<{ result: string }>('/rigging', body, apiKey, IMAGE_TO_3D_BASE);
    return { taskId: data.result };
  }

  async getRiggingTask(taskId: string, apiKey?: string): Promise<MeshyRiggingTask> {
    const key = this.resolveKey(apiKey);
    const task = await this.get<MeshyRiggingTask>(`/rigging/${taskId}`, key, IMAGE_TO_3D_BASE);
    // Surface camelCase aliases for the few snake_case fields we read in callers.
    task.riggedModelUrls = task.rigged_model_urls ?? task.riggedModelUrls;
    task.basicAnimations = task.basic_animations ?? task.basicAnimations;
    task.thumbnailUrl = task.thumbnail_url ?? task.thumbnailUrl;
    task.taskError = task.task_error ?? task.taskError;
    return task;
  }

  async waitForRigging(
    taskId: string,
    maxWaitMs = 10 * 60 * 1000,
    pollIntervalMs = 5000,
    apiKey?: string
  ): Promise<MeshyRiggingTask> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const task = await this.getRiggingTask(taskId, apiKey);
      if (task.status === 'SUCCEEDED') return task;
      if (task.status === 'FAILED') {
        throw new Error(
          `Meshy rigging task ${taskId} failed: ${task.taskError?.message || 'unknown'}`
        );
      }
      if (task.status === 'EXPIRED') {
        throw new Error(`Meshy rigging task ${taskId} expired`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Meshy rigging task ${taskId} timed out after ${maxWaitMs / 1000}s`);
  }

  // ── Animation library ─────────────────────────────────────────────────

  /**
   * Apply one of Meshy's library animations (600+ presets across DailyActions,
   * WalkAndRun, Fighting, Dancing, BodyMovements) to a previously rigged model.
   * `rigTaskId` must reference a SUCCEEDED rigging task.
   */
  async applyAnimation(options: AnimateOptions): Promise<{ taskId: string }> {
    const apiKey = this.resolveKey(options.apiKey);
    const body: Record<string, unknown> = {
      rig_task_id: options.rigTaskId,
      action_id: options.actionId,
    };
    if (options.fps) {
      body.post_process = { operation_type: 'fps', fps: options.fps };
    }
    const data = await this.post<{ result?: string; id?: string }>(
      '/animations',
      body,
      apiKey,
      IMAGE_TO_3D_BASE
    );
    const taskId = data.result ?? data.id;
    if (!taskId) {
      throw new Error('Meshy animation API returned no task ID');
    }
    return { taskId };
  }

  async getAnimationTask(taskId: string, apiKey?: string): Promise<MeshyAnimationTask> {
    const key = this.resolveKey(apiKey);
    const task = await this.get<MeshyAnimationTask>(`/animations/${taskId}`, key, IMAGE_TO_3D_BASE);
    task.animationGlbUrl = task.animation_glb_url ?? task.animationGlbUrl;
    task.animationFbxUrl = task.animation_fbx_url ?? task.animationFbxUrl;
    task.processedUsdzUrl = task.processed_usdz_url ?? task.processedUsdzUrl;
    task.thumbnailUrl = task.thumbnail_url ?? task.thumbnailUrl;
    task.taskError = task.task_error ?? task.taskError;
    return task;
  }

  async waitForAnimation(
    taskId: string,
    maxWaitMs = 10 * 60 * 1000,
    pollIntervalMs = 5000,
    apiKey?: string
  ): Promise<MeshyAnimationTask> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const task = await this.getAnimationTask(taskId, apiKey);
      if (task.status === 'SUCCEEDED') return task;
      if (task.status === 'FAILED') {
        throw new Error(
          `Meshy animation task ${taskId} failed: ${task.taskError?.message || 'unknown'}`
        );
      }
      if (task.status === 'EXPIRED') {
        throw new Error(`Meshy animation task ${taskId} expired`);
      }
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    throw new Error(`Meshy animation task ${taskId} timed out after ${maxWaitMs / 1000}s`);
  }

  // ── Health check ──────────────────────────────────────────────────────

  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

export const meshyService = new MeshyService();
