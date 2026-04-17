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

const BASE_URL = 'https://api.meshy.ai/v2';

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
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  taskError?: { message: string };
  modelUrls: MeshyTaskOutput;
  thumbnailUrl?: string;
  videoUrl?: string; // 360° preview video
}

export interface TextTo3DPreviewOptions {
  prompt: string;
  negativePrompt?: string;
  artStyle?: MeshyArtStyle;
  seed?: number;
  aiModel?: 'meshy-4' | 'meshy-5';
  topology?: 'quad' | 'triangle';
  targetPolycount?: number; // e.g. 30000
}

export interface TextTo3DRefineOptions {
  previewTaskId: string;
  textureRichness?: 'high' | 'medium' | 'low';
}

export interface ImageTo3DOptions {
  imageUrl: string;
  enablePbr?: boolean; // physically based rendering textures
  shouldRemountBackground?: boolean;
  aiModel?: 'meshy-4' | 'meshy-5';
  topology?: 'quad' | 'triangle';
  targetPolycount?: number;
}

export interface MultiImageTo3DOptions {
  imageUrls: string[]; // 2–4 images from different angles
  enablePbr?: boolean;
  topology?: 'quad' | 'triangle';
  targetPolycount?: number;
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
}

export interface MeshyTextureTask extends MeshyTask {
  textureUrls?: string[];
}

// ── Service ───────────────────────────────────────────────────────────

class MeshyService {
  private apiKey: string | undefined;

  constructor() {
    this.apiKey = process.env.MESHY_API_KEY;
  }

  private get headers(): Record<string, string> {
    if (!this.apiKey) throw new Error('MESHY_API_KEY is not configured');
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Meshy API error ${response.status}: ${text}`);
    }
    return response.json() as Promise<T>;
  }

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, { headers: this.headers });
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
    const data = await this.post<{ result: string }>('/text-to-3d', {
      mode: 'preview',
      prompt: options.prompt,
      negative_prompt: options.negativePrompt || '',
      art_style: options.artStyle || 'realistic',
      seed: options.seed,
      ai_model: options.aiModel || 'meshy-4',
      topology: options.topology,
      target_polycount: options.targetPolycount,
    });
    return { taskId: data.result };
  }

  /**
   * Start a refine task from a completed preview task.
   * Returns a new task ID for the refined result.
   */
  async textTo3DRefine(options: TextTo3DRefineOptions): Promise<{ taskId: string }> {
    const data = await this.post<{ result: string }>(
      `/text-to-3d/${options.previewTaskId}/refine`,
      {
        texture_richness: options.textureRichness || 'high',
      }
    );
    return { taskId: data.result };
  }

  // ── Image-to-3D ───────────────────────────────────────────────────────

  async imageTo3D(options: ImageTo3DOptions): Promise<{ taskId: string }> {
    const data = await this.post<{ result: string }>('/image-to-3d', {
      image_url: options.imageUrl,
      enable_pbr: options.enablePbr ?? true,
      should_remount_background: options.shouldRemountBackground ?? false,
      ai_model: options.aiModel || 'meshy-4',
      topology: options.topology,
      target_polycount: options.targetPolycount,
    });
    return { taskId: data.result };
  }

  // ── Multi-Image-to-3D (higher consistency) ────────────────────────────

  async multiImageTo3D(options: MultiImageTo3DOptions): Promise<{ taskId: string }> {
    if (options.imageUrls.length < 2 || options.imageUrls.length > 4) {
      throw new Error('multiImageTo3D requires 2–4 images');
    }
    const data = await this.post<{ result: string }>('/image-to-3d', {
      image_urls: options.imageUrls,
      enable_pbr: options.enablePbr ?? true,
      topology: options.topology,
      target_polycount: options.targetPolycount,
    });
    return { taskId: data.result };
  }

  // ── Text-to-Texture ───────────────────────────────────────────────────

  /**
   * Apply AI-generated textures to an existing 3D model.
   * Pass a GLB model URL and a text description of the desired texture.
   */
  async textToTexture(options: TextToTextureOptions): Promise<{ taskId: string }> {
    const data = await this.post<{ result: string }>('/text-to-texture', {
      model_url: options.modelUrl,
      object_prompt: options.prompt,
      negative_prompt: options.negativePrompt || '',
      style_prompt: options.artStyle || 'realistic',
      resolution: options.resolution || 2048,
      enable_original_uv: options.enableOriginalUV ?? true,
      enable_pbr: options.enablePbr ?? true,
      art_style: options.artStyle || 'realistic',
      painting_style: options.paintingStyle || 'texture',
    });
    return { taskId: data.result };
  }

  async getTextToTextureTask(taskId: string): Promise<MeshyTextureTask> {
    return this.get<MeshyTextureTask>(`/text-to-texture/${taskId}`);
  }

  /**
   * Poll a texture task until terminal state.
   */
  async waitForTextureTask(
    taskId: string,
    maxWaitMs = 10 * 60 * 1000,
    pollIntervalMs = 5000
  ): Promise<MeshyTextureTask> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const task = await this.getTextToTextureTask(taskId);
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

  async getTextTo3DTask(taskId: string): Promise<MeshyTask> {
    return this.get<MeshyTask>(`/text-to-3d/${taskId}`);
  }

  async getImageTo3DTask(taskId: string): Promise<MeshyTask> {
    return this.get<MeshyTask>(`/image-to-3d/${taskId}`);
  }

  /**
   * Poll a task until it reaches a terminal state or the timeout is hit.
   * Resolves with the completed task or throws on failure/timeout.
   */
  async waitForTask(
    taskId: string,
    type: 'text-to-3d' | 'image-to-3d',
    maxWaitMs = 5 * 60 * 1000,
    pollIntervalMs = 5000
  ): Promise<MeshyTask> {
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      const task =
        type === 'text-to-3d'
          ? await this.getTextTo3DTask(taskId)
          : await this.getImageTo3DTask(taskId);

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

  // ── Health check ──────────────────────────────────────────────────────

  isConfigured(): boolean {
    return !!this.apiKey;
  }
}

export const meshyService = new MeshyService();
