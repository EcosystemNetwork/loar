/**
 * ByteDance ModelArk API Service
 *
 * Direct integration with ByteDance's ModelArk platform for:
 * - Seedance 2.0: Video generation (T2V, I2V, Reference-to-Video)
 * - Seedream 5.0: Image generation
 * - Seed 2.0: Prompt analysis, planning, script generation (chat completions)
 * - Seed Speech: Voice synthesis (TTS)
 * - OmniHuman: Digital human / talking-scene generation
 *
 * Each method accepts an optional `apiKey` to override the env-configured
 * key — used by the BYOK flow so users can plug in their own ModelArk
 * credentials without the server rotating shared keys.
 *
 * API docs: https://docs.byteplus.com/en/docs/ModelArk/
 * Base URL: https://ark.ap-southeast.bytepluses.com/api/v3
 */

// ── Types ────────────────────────────────────────────────────────────────

/** Common option carried by every method to support BYO-key. */
export interface ByteDanceCallOptions {
  /** If set, this single API key is used (no env rotation). */
  apiKey?: string;
}

export interface ByteDanceVideoOptions extends ByteDanceCallOptions {
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

export interface ByteDanceImageOptions extends ByteDanceCallOptions {
  prompt: string;
  model?: string; // e.g. 'seedream-5.0'
  negativePrompt?: string;
  numImages?: number;
  size?: string; // e.g. '1024x1024', '1280x720'
  seed?: number;
}

// ── Seed 2.0 orchestrator (chat completions) ─────────────────────────────

export interface SeedChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SeedChatOptions extends ByteDanceCallOptions {
  /** ModelArk chat model id, e.g. 'seed-1-6-thinking-250715' or 'seed-1-6-250615'. */
  model?: string;
  messages: SeedChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** When true, biases toward concise structured output (useful for planners). */
  jsonMode?: boolean;
}

export interface SeedChatResult {
  content: string;
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  raw?: unknown;
}

// ── Seed Speech (TTS) ────────────────────────────────────────────────────

export interface SeedSpeechOptions extends ByteDanceCallOptions {
  /** Text to synthesize. */
  text: string;
  /** ModelArk voice id; service-default applies if unset. */
  voice?: string;
  /** ModelArk model id (e.g. 'seed-tts-1.0'). */
  model?: string;
  /** Output format hint — service may ignore based on plan. */
  format?: 'mp3' | 'wav' | 'pcm';
  /** Speaking rate, 0.5–2.0. */
  speed?: number;
}

export interface SeedSpeechResult {
  status: 'completed' | 'failed';
  audioUrl?: string;
  /** Inline audio if the API returns base64 instead of a hosted URL. */
  audioBase64?: string;
  format?: string;
  error?: string;
}

// ── OmniHuman (talking scene / digital human) ────────────────────────────

export interface OmniHumanOptions extends ByteDanceCallOptions {
  /** Reference image URL (the speaker portrait). */
  imageUrl: string;
  /** What the speaker should say. Either text+voice OR audioUrl is required. */
  text?: string;
  /** Voice id used to synthesize when only text is provided. */
  voice?: string;
  /** Pre-rendered audio URL (e.g. produced by Seed Speech). */
  audioUrl?: string;
  /** Optional model id override — defaults to 'omnihuman-1.0'. */
  model?: string;
  /** Driving emotion / style hint. */
  style?: string;
  /** Optional duration cap in seconds. */
  duration?: number;
}

export interface OmniHumanResult {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
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
  private apiKeys: string[] | null = null;
  private activeKeyIdx = 0;

  private ensureConfigured(): string[] {
    if (!this.apiKeys) {
      const raw = process.env.BYTEDANCE_API_KEY || '';
      this.apiKeys = raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    }
    if (this.apiKeys.length === 0) {
      throw new Error(
        'BYTEDANCE_API_KEY environment variable is required for ByteDance generation'
      );
    }
    return this.apiKeys;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    overrideKey?: string
  ): Promise<T> {
    // BYOK path — single user-supplied key, no rotation, errors surface as-is
    // so the user sees their own credential failures (auth, balance, rate-limit)
    // instead of silently falling through to the platform key.
    if (overrideKey && overrideKey.trim().length > 0) {
      const url = `${BASE_URL}${path}`;
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${overrideKey.trim()}`,
          ...options.headers,
        },
      });
      if (response.ok) return response.json() as Promise<T>;
      const body = await response.text().catch(() => '');
      let detail = '';
      try {
        const parsed = JSON.parse(body);
        detail = parsed.error?.message || parsed.message || parsed.detail || body;
      } catch {
        detail = body;
      }
      throw new Error(`ByteDance API error ${response.status} (BYOK): ${detail}`.slice(0, 500));
    }

    const keys = this.ensureConfigured();
    const url = `${BASE_URL}${path}`;
    let lastErr: Error | null = null;

    for (let i = 0; i < keys.length; i++) {
      const idx = (this.activeKeyIdx + i) % keys.length;
      const apiKey = keys[idx];

      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...options.headers,
        },
      });

      if (response.ok) {
        if (idx !== this.activeKeyIdx) {
          console.log(`[ByteDance] Rotated to backup key #${idx + 1}/${keys.length}`);
          this.activeKeyIdx = idx;
        }
        return response.json() as Promise<T>;
      }

      const body = await response.text().catch(() => '');
      let detail = '';
      try {
        const parsed = JSON.parse(body);
        detail = parsed.error?.message || parsed.message || parsed.detail || body;
      } catch {
        detail = body;
      }
      const err = new Error(`ByteDance API error ${response.status}: ${detail}`.slice(0, 500));

      const rotatable =
        response.status === 401 || response.status === 403 || response.status === 429;
      if (!rotatable || keys.length === 1) throw err;

      console.warn(`[ByteDance] Key #${idx + 1} failed (${response.status}), trying next`);
      lastErr = err;
    }

    throw lastErr ?? new Error('ByteDance API error: all keys exhausted');
  }

  // ── Video Generation (Seedance 2.0) ──────────────────────────────────

  async generateVideo(options: ByteDanceVideoOptions): Promise<ByteDanceVideoResult> {
    try {
      // Build content items for the user message
      const contentItems: Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }> = [];

      // Add text prompt
      contentItems.push({ type: 'text', text: options.prompt });

      // Add images based on mode
      if (options.mode === 'image_to_video' && options.imageUrl) {
        contentItems.push({
          type: 'image_url',
          image_url: { url: options.imageUrl },
        });
      }

      if (options.mode === 'reference_to_video') {
        if (options.referenceImages?.length) {
          for (const ref of options.referenceImages) {
            contentItems.push({
              type: 'image_url',
              image_url: { url: ref.url },
            });
          }
        } else if (options.imageUrl) {
          contentItems.push({
            type: 'image_url',
            image_url: { url: options.imageUrl },
          });
        }
      }

      // Build request body — content at top level, always
      const body: Record<string, any> = {
        model: options.model,
        content: contentItems,
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
      }>(
        '/contents/generations/tasks',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        options.apiKey
      );

      const taskId = taskResponse.id || taskResponse.task_id || taskResponse.job_id;
      if (!taskId) {
        console.error('[ByteDance] No task ID in response:', JSON.stringify(taskResponse));
        throw new Error('No task ID returned from ByteDance API');
      }

      console.log(`[ByteDance] Task created: ${taskId}`);

      // Poll for completion
      return await this.pollVideoTask(taskId, options.apiKey);
    } catch (error) {
      console.error('[ByteDance] Video generation failed:', error);
      return {
        id: '',
        status: 'failed',
        error: error instanceof Error ? error.message : 'ByteDance video generation failed',
      };
    }
  }

  private async pollVideoTask(taskId: string, apiKey?: string): Promise<ByteDanceVideoResult> {
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
        }>(`/contents/generations/tasks/${taskId}`, {}, apiKey);

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
      }>(
        '/images/generations',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        options.apiKey
      );

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

  async getTaskStatus(taskId: string, apiKey?: string): Promise<ByteDanceVideoResult> {
    try {
      const status = await this.request<{
        status: string;
        content?: { video_url?: string };
        output?: { video_url?: string; video?: { url?: string } };
        result?: { video_url?: string };
        error?: string | { message?: string };
      }>(`/contents/generations/tasks/${taskId}`, {}, apiKey);

      const taskStatus = status.status?.toLowerCase();
      const videoUrl =
        status.content?.video_url ||
        status.output?.video_url ||
        status.output?.video?.url ||
        status.result?.video_url;

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

  // ── Seed 2.0 — Chat completions (planner / script writer / prompt enhancer)

  /**
   * Calls the ModelArk chat-completions endpoint. Use this as the orchestrator
   * brain for agent flows: episode planning, prompt enhancement, dialog
   * scripting. The endpoint is OpenAI-compatible; pass a `model` like
   * 'seed-1-6-thinking-250715' (default) or an explicit override.
   */
  async chat(options: SeedChatOptions): Promise<SeedChatResult> {
    const model = options.model || 'seed-1-6-thinking-250715';
    const body: Record<string, any> = {
      model,
      messages: options.messages,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.jsonMode) body.response_format = { type: 'json_object' };

    const result = await this.request<{
      id?: string;
      choices?: Array<{
        message?: { role?: string; content?: string };
        finish_reason?: string;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    }>(
      '/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      options.apiKey
    );

    const content = result.choices?.[0]?.message?.content ?? '';
    if (!content) {
      throw new Error('Seed chat returned no content');
    }
    return {
      content,
      finishReason: result.choices?.[0]?.finish_reason,
      usage: {
        promptTokens: result.usage?.prompt_tokens,
        completionTokens: result.usage?.completion_tokens,
        totalTokens: result.usage?.total_tokens,
      },
      raw: result,
    };
  }

  // ── Seed Speech — Text-to-speech ────────────────────────────────────────

  /**
   * Synthesizes speech via ModelArk's audio endpoint. Returns either a hosted
   * URL or inline base64 depending on the deployment. Caller is responsible
   * for persisting (typically via the storage layer) before durable use.
   */
  async generateSpeech(options: SeedSpeechOptions): Promise<SeedSpeechResult> {
    try {
      const body: Record<string, any> = {
        model: options.model || 'seed-tts-1.0',
        input: options.text,
        voice: options.voice ?? 'alloy',
      };
      if (options.format) body.response_format = options.format;
      if (options.speed !== undefined) body.speed = options.speed;

      const result = await this.request<{
        url?: string;
        audio_url?: string;
        data?: string;
        b64?: string;
        format?: string;
      }>(
        '/audio/speech',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        options.apiKey
      );

      const audioUrl = result.url || result.audio_url;
      const audioBase64 = result.data || result.b64;
      if (!audioUrl && !audioBase64) {
        throw new Error('Seed Speech returned no audio payload');
      }
      return {
        status: 'completed',
        audioUrl,
        audioBase64,
        format: result.format || options.format || 'mp3',
      };
    } catch (error) {
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Seed Speech failed',
      };
    }
  }

  // ── OmniHuman — Talking-scene / digital-human video ──────────────────────

  /**
   * Generates a talking-scene clip from a portrait image plus speech. Either
   * `text` (synthesized via Seed Speech) or a pre-rendered `audioUrl` must be
   * supplied. Submits an async task and polls reusing the same poller as
   * Seedance video tasks.
   */
  async generateTalkingScene(options: OmniHumanOptions): Promise<OmniHumanResult> {
    if (!options.text && !options.audioUrl) {
      return {
        id: '',
        status: 'failed',
        error: 'OmniHuman requires either `text` or `audioUrl`',
      };
    }
    try {
      const body: Record<string, any> = {
        model: options.model || 'omnihuman-1.0',
        image_url: options.imageUrl,
      };
      if (options.text) body.text = options.text;
      if (options.voice) body.voice = options.voice;
      if (options.audioUrl) body.audio_url = options.audioUrl;
      if (options.style) body.style = options.style;
      if (options.duration !== undefined) body.duration = options.duration;

      const taskResponse = await this.request<{
        id?: string;
        task_id?: string;
        job_id?: string;
        status?: string;
      }>(
        '/contents/generations/tasks',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        options.apiKey
      );

      const taskId = taskResponse.id || taskResponse.task_id || taskResponse.job_id;
      if (!taskId) throw new Error('No task ID returned from OmniHuman');

      const poll = await this.pollVideoTask(taskId, options.apiKey);
      return {
        id: poll.id,
        status: poll.status,
        videoUrl: poll.videoUrl,
        error: poll.error,
      };
    } catch (error) {
      return {
        id: '',
        status: 'failed',
        error: error instanceof Error ? error.message : 'OmniHuman failed',
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
