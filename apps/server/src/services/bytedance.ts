/**
 * ByteDance ModelArk API Service
 *
 * Direct integration with ByteDance's ModelArk platform for:
 * - Seedance 2.0: Video generation (T2V, I2V, Reference-to-Video)
 * - Seedream 5.0: Image generation
 * - Seed 2.0: Prompt analysis & enhancement (future)
 * - Seed Speech / OmniHuman: Voice & digital human (future)
 *
 * API docs: https://docs.byteplus.com/en/docs/ModelArk/
 * Base URL: https://ark.ap-southeast.bytepluses.com/api/v3
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface ByteDanceVideoOptions {
  prompt: string;
  model: string; // e.g. 'seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-pro'
  mode: 'text_to_video' | 'image_to_video' | 'reference_to_video';
  imageUrl?: string;
  endImageUrl?: string;
  referenceImages?: Array<{ url: string; role?: 'subject' | 'environment' | 'motion' }>;
  duration?: number; // 4-15 seconds
  aspectRatio?: string; // '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16'
  resolution?: string; // '480p' | '720p' | '1080p'
  audio?: boolean;
  negativePrompt?: string;
  seed?: number;
  style?: string; // 'cinematic' | 'anime' | 'realistic' | '3d_render'
}

export interface ByteDanceVideoResult {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
}

export interface ByteDanceImageOptions {
  prompt: string;
  model?: string; // e.g. 'seedream-5.0'
  negativePrompt?: string;
  numImages?: number;
  size?: string; // e.g. '1024x1024', '1280x720'
  seed?: number;
}

export interface ByteDanceImageResult {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  imageUrl?: string;
  images?: Array<{ url: string; width?: number; height?: number }>;
  seed?: number;
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────────────

const BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const MAX_POLL_ATTEMPTS = 60; // 5 minutes at 5s intervals
const POLL_INTERVAL_MS = 5000;

// ── Service ──────────────────────────────────────────────────────────────

export class ByteDanceService {
  private apiKey: string | null = null;

  private ensureConfigured(): string {
    if (!this.apiKey) {
      this.apiKey = process.env.BYTEDANCE_API_KEY || null;
    }
    if (!this.apiKey) {
      throw new Error(
        'BYTEDANCE_API_KEY environment variable is required for ByteDance generation'
      );
    }
    return this.apiKey;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const apiKey = this.ensureConfigured();
    const url = `${BASE_URL}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let detail = '';
      try {
        const parsed = JSON.parse(body);
        detail = parsed.error?.message || parsed.message || parsed.detail || body;
      } catch {
        detail = body;
      }
      throw new Error(`ByteDance API error ${response.status}: ${detail}`.slice(0, 500));
    }

    return response.json() as Promise<T>;
  }

  // ── Video Generation (Seedance 2.0) ──────────────────────────────────

  async generateVideo(options: ByteDanceVideoOptions): Promise<ByteDanceVideoResult> {
    try {
      // Build the content array for ModelArk format
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

      // Add text prompt
      content.push({ type: 'text', text: options.prompt });

      // Add images based on mode
      if (options.mode === 'image_to_video' && options.imageUrl) {
        content.push({
          type: 'image_url',
          image_url: { url: options.imageUrl },
        });
      }

      if (options.mode === 'reference_to_video') {
        if (options.referenceImages?.length) {
          for (const ref of options.referenceImages) {
            content.push({
              type: 'image_url',
              image_url: { url: ref.url },
            });
          }
        } else if (options.imageUrl) {
          content.push({
            type: 'image_url',
            image_url: { url: options.imageUrl },
          });
        }
      }

      // Build request body
      const body: Record<string, any> = {
        model: options.model,
        content,
      };

      // Optional parameters
      if (options.duration) body.duration = options.duration;
      if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;
      if (options.resolution) body.resolution = options.resolution;
      if (options.audio !== undefined) body.generate_audio = options.audio;
      if (options.negativePrompt) body.negative_prompt = options.negativePrompt;
      if (options.seed !== undefined) body.seed = options.seed;
      if (options.style) body.style = options.style;
      if (options.endImageUrl) body.end_image_url = options.endImageUrl;

      console.log(`[ByteDance] Creating video task: model=${options.model}, mode=${options.mode}`);

      // Create async task
      const taskResponse = await this.request<{
        id?: string;
        task_id?: string;
        job_id?: string;
        status?: string;
        error?: { message?: string };
      }>('/contents/generations/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const taskId = taskResponse.id || taskResponse.task_id || taskResponse.job_id;
      if (!taskId) {
        console.error('[ByteDance] No task ID in response:', JSON.stringify(taskResponse));
        throw new Error('No task ID returned from ByteDance API');
      }

      console.log(`[ByteDance] Task created: ${taskId}`);

      // Poll for completion
      return await this.pollVideoTask(taskId);
    } catch (error) {
      console.error('[ByteDance] Video generation failed:', error);
      return {
        id: '',
        status: 'failed',
        error: error instanceof Error ? error.message : 'ByteDance video generation failed',
      };
    }
  }

  private async pollVideoTask(taskId: string): Promise<ByteDanceVideoResult> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      try {
        const status = await this.request<{
          id?: string;
          task_id?: string;
          status: string;
          content?: {
            video_url?: string;
          };
          output?: {
            video_url?: string;
            video?: { url?: string };
          };
          error?: string | { message?: string };
          result?: { video_url?: string };
        }>(`/contents/generations/tasks/${taskId}`);

        const taskStatus = status.status?.toLowerCase();

        if (taskStatus === 'completed' || taskStatus === 'succeeded' || taskStatus === 'success') {
          // Extract video URL from various possible response shapes
          const videoUrl =
            status.content?.video_url ||
            status.output?.video_url ||
            status.output?.video?.url ||
            status.result?.video_url;

          if (!videoUrl) {
            console.error('[ByteDance] Task completed but no video URL:', JSON.stringify(status));
            return {
              id: taskId,
              status: 'failed',
              error: 'Task completed but no video URL returned',
            };
          }

          console.log(`[ByteDance] Task ${taskId} completed: ${videoUrl}`);
          return {
            id: taskId,
            status: 'completed',
            videoUrl,
          };
        }

        if (taskStatus === 'failed' || taskStatus === 'error' || taskStatus === 'cancelled') {
          const errorMsg =
            typeof status.error === 'string'
              ? status.error
              : status.error?.message || 'Task failed';
          console.error(`[ByteDance] Task ${taskId} failed: ${errorMsg}`);
          return {
            id: taskId,
            status: 'failed',
            error: errorMsg,
          };
        }

        // Still processing
        if (attempt % 6 === 0) {
          console.log(`[ByteDance] Task ${taskId} status: ${taskStatus} (attempt ${attempt + 1})`);
        }
      } catch (pollError) {
        console.error(`[ByteDance] Poll error (attempt ${attempt + 1}):`, pollError);
        // Continue polling on transient errors
        if (attempt >= MAX_POLL_ATTEMPTS - 1) {
          return {
            id: taskId,
            status: 'failed',
            error: `Polling timed out after ${MAX_POLL_ATTEMPTS} attempts`,
          };
        }
      }
    }

    return {
      id: taskId,
      status: 'failed',
      error: 'Video generation timed out (5 minutes)',
    };
  }

  // ── Image Generation (Seedream 5.0) ──────────────────────────────────

  async generateImage(options: ByteDanceImageOptions): Promise<ByteDanceImageResult> {
    try {
      const model = options.model || 'seedream-5-0-260128';

      const body: Record<string, any> = {
        model,
        prompt: options.prompt,
        n: options.numImages || 1,
      };

      if (options.negativePrompt) body.negative_prompt = options.negativePrompt;
      if (options.size) body.size = options.size;
      if (options.seed !== undefined) body.seed = options.seed;

      console.log(`[ByteDance] Generating image: model=${model}`);

      const result = await this.request<{
        id?: string;
        data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
        created?: number;
        error?: { message?: string };
      }>('/images/generations', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const images = (result.data || [])
        .filter((img) => img.url || img.b64_json)
        .map((img) => ({
          url: img.url || `data:image/png;base64,${img.b64_json}`,
        }));

      if (images.length === 0) {
        throw new Error('No images returned from ByteDance API');
      }

      console.log(`[ByteDance] Image generated: ${images.length} images`);
      return {
        id: result.id || Date.now().toString(),
        status: 'completed',
        imageUrl: images[0].url,
        images,
      };
    } catch (error) {
      console.error('[ByteDance] Image generation failed:', error);
      return {
        id: Date.now().toString(),
        status: 'failed',
        error: error instanceof Error ? error.message : 'ByteDance image generation failed',
      };
    }
  }

  // ── Task Status (for external polling if needed) ─────────────────────

  async getTaskStatus(taskId: string): Promise<ByteDanceVideoResult> {
    try {
      const status = await this.request<{
        status: string;
        output?: { video_url?: string; video?: { url?: string } };
        result?: { video_url?: string };
        error?: string | { message?: string };
      }>(`/contents/generations/tasks/${taskId}`);

      const taskStatus = status.status?.toLowerCase();
      const videoUrl =
        status.output?.video_url || status.output?.video?.url || status.result?.video_url;

      if (taskStatus === 'completed' || taskStatus === 'succeeded') {
        return { id: taskId, status: 'completed', videoUrl };
      }
      if (taskStatus === 'failed' || taskStatus === 'error') {
        const msg = typeof status.error === 'string' ? status.error : status.error?.message;
        return { id: taskId, status: 'failed', error: msg || 'Task failed' };
      }

      return { id: taskId, status: 'in_progress' };
    } catch (error) {
      return {
        id: taskId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to check task status',
      };
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Singleton ────────────────────────────────────────────────────────────

export const bytedanceService = new ByteDanceService();
