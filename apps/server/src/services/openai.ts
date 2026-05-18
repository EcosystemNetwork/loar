/**
 * OpenAI Service — direct adapter for Images, Audio (TTS + STT), and Chat.
 *
 * Mirrors the BYOK convention used elsewhere: every method accepts an
 * optional `apiKey`. When omitted, falls back to `OPENAI_API_KEY` env.
 * Sora 2 video is exposed separately (poll-based, async) — see `sora()`.
 *
 * Endpoints used:
 *   POST /v1/images/generations           gpt-image-1, gpt-image-1.5, dall-e-3
 *   POST /v1/images/edits                 gpt-image-1, gpt-image-1.5 (multipart)
 *   POST /v1/audio/speech                 gpt-4o-mini-tts, tts-1, tts-1-hd
 *   POST /v1/audio/transcriptions         gpt-4o-transcribe(+diarize), gpt-4o-mini-transcribe, whisper-1
 *   POST /v1/audio/translations           whisper-1 (en target only)
 *   POST /v1/chat/completions             gpt-5*, o3, o4-mini, gpt-4.1*
 *   POST /v1/videos                       sora-2, sora-2-pro (async; GET /v1/videos/{id} to poll)
 *   POST /v1/embeddings                   text-embedding-3-small/large
 *
 * Docs: https://platform.openai.com/docs
 */

import { redactSecrets } from '../lib/redact-secrets';

const BASE_URL = 'https://api.openai.com/v1';

// ── Common ──────────────────────────────────────────────────────────────

/**
 * Every method on `openAIService` REQUIRES an explicit `apiKey`. There is
 * no `process.env.OPENAI_API_KEY` fallback — callers must route through
 * `resolveProviderKey(userId, 'openai')` (or `provider-keys`'s richer
 * dispatcher) so BYOK lookup runs and the server-pool key only resolves
 * via that audited path.
 *
 * Auditor note (M5): allowing an env fallback here let any internal
 * caller (workers, maintenance scripts) silently spend the platform key
 * with no metering — closed by making the option required.
 */
export interface OpenAICallOptions {
  /** Required — user-supplied BYOK key or server-pool key from `resolveProviderKey`. */
  apiKey: string;
}

function resolveKey(opts: OpenAICallOptions): string {
  const key = opts.apiKey?.trim();
  if (!key) {
    throw new Error(
      'OpenAI API key missing — resolveProviderKey(userId, "openai") and pass the result as apiKey'
    );
  }
  return key;
}

async function postJson<T>(path: string, body: unknown, apiKey: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI ${path} ${res.status}: ${redactSecrets(errBody).slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

async function postForm<T>(path: string, form: FormData, apiKey: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI ${path} ${res.status}: ${redactSecrets(errBody).slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

async function postFormBinary(path: string, body: unknown, apiKey: string): Promise<ArrayBuffer> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI ${path} ${res.status}: ${redactSecrets(errBody).slice(0, 500)}`);
  }
  return await res.arrayBuffer();
}

async function getJson<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`OpenAI ${path} ${res.status}: ${redactSecrets(errBody).slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

// ── Images ──────────────────────────────────────────────────────────────

export type OpenAIImageModel =
  | 'gpt-image-1'
  | 'gpt-image-1-mini'
  | 'gpt-image-1.5'
  | 'dall-e-3'
  | 'dall-e-2';

export type OpenAIImageSize =
  | '1024x1024'
  | '1024x1536'
  | '1536x1024'
  | '1024x1792'
  | '1792x1024'
  | '512x512'
  | '256x256';

export type OpenAIImageQuality = 'low' | 'medium' | 'high' | 'standard' | 'hd';

export interface ImageGenerateOptions extends OpenAICallOptions {
  prompt: string;
  model: OpenAIImageModel;
  n?: number; // default 1
  size?: OpenAIImageSize;
  quality?: OpenAIImageQuality;
  /** `url` returns hosted URL; `b64_json` returns base64. Default `url`. */
  responseFormat?: 'url' | 'b64_json';
  /** Optional negative-style for guidance (gpt-image* only). */
  user?: string;
}

export interface ImageGenerateResult {
  /** First image, by convention. */
  url?: string;
  b64Json?: string;
  /** Full result set if `n > 1`. */
  all: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  model: OpenAIImageModel;
}

interface ImagesApiResponse {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
}

export interface ImageEditOptions extends OpenAICallOptions {
  prompt: string;
  model: 'gpt-image-1' | 'gpt-image-1.5' | 'dall-e-2';
  /** PNG bytes (RGBA) or a public URL. */
  image: Uint8Array | string;
  /** Optional inpaint mask — alpha=0 areas will be replaced. */
  mask?: Uint8Array;
  n?: number;
  size?: OpenAIImageSize;
  quality?: OpenAIImageQuality;
  responseFormat?: 'url' | 'b64_json';
}

async function urlOrBytesToBlob(input: Uint8Array | string): Promise<Blob> {
  if (typeof input === 'string') {
    // SSRF guard: never let a caller-supplied URL hit an internal IP / loopback.
    const { validateUploadUrl } = await import('../lib/url-validator');
    await validateUploadUrl(input);
    const r = await fetch(input);
    if (!r.ok) throw new Error(`Failed to fetch image source: ${r.status}`);
    return await r.blob();
  }
  return new Blob([input as BlobPart], { type: 'image/png' });
}

// ── Audio (TTS) ─────────────────────────────────────────────────────────

export type OpenAITtsModel = 'gpt-4o-mini-tts' | 'tts-1' | 'tts-1-hd';

export type OpenAITtsVoice =
  | 'alloy'
  | 'ash'
  | 'ballad'
  | 'coral'
  | 'echo'
  | 'fable'
  | 'nova'
  | 'onyx'
  | 'sage'
  | 'shimmer'
  | 'verse'
  | 'marin'
  | 'cedar';

export type OpenAITtsFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';

export interface TtsOptions extends OpenAICallOptions {
  model: OpenAITtsModel;
  voice: OpenAITtsVoice;
  input: string;
  /** Steerable instructions (gpt-4o-mini-tts only). */
  instructions?: string;
  format?: OpenAITtsFormat;
  /** 0.25–4.0; only tts-1/tts-1-hd respect this. */
  speed?: number;
}

export interface TtsResult {
  audio: ArrayBuffer;
  format: OpenAITtsFormat;
  model: OpenAITtsModel;
}

// ── Audio (STT) ─────────────────────────────────────────────────────────

export type OpenAISttModel =
  | 'gpt-4o-transcribe'
  | 'gpt-4o-mini-transcribe'
  | 'gpt-4o-transcribe-diarize'
  | 'whisper-1';

export interface TranscribeOptions extends OpenAICallOptions {
  model: OpenAISttModel;
  /** Audio bytes OR a public URL the server will fetch. */
  audio: Uint8Array | string;
  filename?: string;
  language?: string; // ISO-639-1
  /** verbose_json gives segment + word timings. */
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
  /** Optional bias prompt for proper nouns / jargon. */
  prompt?: string;
  temperature?: number;
  /** Whisper-1 only: `transcribe` or `translate` (always returns English). */
  task?: 'transcribe' | 'translate';
  /** gpt-4o-transcribe-diarize: number of expected speakers (helps inference). */
  numSpeakers?: number;
}

export interface TranscribeWord {
  word: string;
  start: number;
  end: number;
  /** Present when diarize is enabled. */
  speaker?: string;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ id: number; start: number; end: number; text: string; speaker?: string }>;
  words?: TranscribeWord[];
  model: OpenAISttModel;
}

// ── Chat ────────────────────────────────────────────────────────────────

export type OpenAIChatModel =
  | 'gpt-5'
  | 'gpt-5-mini'
  | 'gpt-5-nano'
  | 'o3'
  | 'o4-mini'
  | 'gpt-4.1'
  | 'gpt-4.1-mini'
  | 'gpt-4.1-nano';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
      >;
  tool_call_id?: string;
  name?: string;
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatOptions extends OpenAICallOptions {
  model: OpenAIChatModel;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** Force JSON-only output. */
  jsonMode?: boolean;
  /** Structured-output JSON schema enforcement. */
  responseSchema?: Record<string, unknown>;
  tools?: ChatTool[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  /** Send `cache_control: { type: 'ephemeral' }` on the matching message. */
  cacheTurnIndex?: number;
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  cached_input_tokens?: number;
  total_tokens: number;
}

export interface ChatResult {
  text: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage: ChatUsage;
  model: OpenAIChatModel;
  finishReason: string;
}

// ── Files API ─────────────────────────────────────────────────────────

export type OpenAIFilePurpose = 'vision' | 'assistants' | 'batch' | 'fine-tune' | 'evals';

export interface UploadFileOptions extends OpenAICallOptions {
  /** Image bytes (PNG/JPEG/WebP for vision; other types for other purposes). */
  bytes: Uint8Array;
  /** Original filename — used as `Content-Disposition` filename in multipart. */
  filename: string;
  /** Default `'vision'`. For Sora image-to-video reference frames. */
  purpose?: OpenAIFilePurpose;
  /** Override the inferred content-type. */
  contentType?: string;
}

export interface UploadedFile {
  id: string;
  bytes: number;
  purpose: OpenAIFilePurpose;
  filename: string;
  created_at: number;
}

// ── Video (Sora 2) — async ──────────────────────────────────────────────

export type OpenAISoraModel = 'sora-2' | 'sora-2-pro';

export interface SoraGenerateOptions extends OpenAICallOptions {
  model: OpenAISoraModel;
  prompt: string;
  /** 4–25 seconds for sora-2-pro, 4–12 for sora-2. */
  durationSec?: number;
  /**
   * Sora 2 accepts `'720p' | '1080p'` (Pro adds `'1080p'` natively). Maps to
   * an explicit pixel `size` string at request time (`1280x720` / `1920x1080`).
   */
  resolution?: '720p' | '1080p';
  aspectRatio?: '16:9' | '9:16';
  /**
   * For image-to-video: a file id from `/v1/files` (the JSON Videos API
   * does not accept https URLs for image references). Callers must upload
   * the source frame to the Files API first and pass the returned id here.
   */
  inputReferenceFileId?: string;
  /** Optional cancellation signal — propagated to the underlying fetch. */
  signal?: AbortSignal;
}

export interface SoraTask {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  videoUrl?: string;
  error?: string;
  model: OpenAISoraModel;
}

// ── Embeddings ──────────────────────────────────────────────────────────

export type OpenAIEmbeddingModel = 'text-embedding-3-small' | 'text-embedding-3-large';

export interface EmbeddingOptions extends OpenAICallOptions {
  model: OpenAIEmbeddingModel;
  input: string | string[];
  /** Truncate dimensions (MRL). */
  dimensions?: number;
}

export interface EmbeddingResult {
  vectors: number[][];
  usage: { prompt_tokens: number; total_tokens: number };
  model: OpenAIEmbeddingModel;
}

// ── Service ─────────────────────────────────────────────────────────────

class OpenAIService {
  isConfigured(apiKey?: string): boolean {
    return Boolean(apiKey || process.env.OPENAI_API_KEY?.trim());
  }

  // ── Images ─────────────────────────────────────────────────────────
  async generateImage(opts: ImageGenerateOptions): Promise<ImageGenerateResult> {
    const apiKey = resolveKey(opts);
    const body: Record<string, unknown> = {
      model: opts.model,
      prompt: opts.prompt,
      n: opts.n ?? 1,
      size: opts.size ?? '1024x1024',
    };
    // `response_format` is only valid for the DALL-E line; gpt-image-1*
    // always returns b64_json and rejects the field. Gate accordingly.
    const isDallE = opts.model.startsWith('dall-e');
    if (isDallE) {
      body.response_format = opts.responseFormat ?? 'url';
    }
    if (opts.quality) body.quality = opts.quality;
    if (opts.user) body.user = opts.user;
    const data = await postJson<ImagesApiResponse>('/images/generations', body, apiKey);
    const first = data.data[0] ?? {};
    return {
      url: first.url,
      b64Json: first.b64_json,
      all: data.data,
      model: opts.model,
    };
  }

  async editImage(opts: ImageEditOptions): Promise<ImageGenerateResult> {
    const apiKey = resolveKey(opts);
    const form = new FormData();
    form.append('model', opts.model);
    form.append('prompt', opts.prompt);
    form.append('n', String(opts.n ?? 1));
    form.append('size', opts.size ?? '1024x1024');
    if (opts.quality) form.append('quality', opts.quality);
    if (opts.responseFormat) form.append('response_format', opts.responseFormat);
    const imgBlob = await urlOrBytesToBlob(opts.image);
    form.append('image', imgBlob, 'input.png');
    if (opts.mask) {
      form.append('mask', new Blob([opts.mask as BlobPart], { type: 'image/png' }), 'mask.png');
    }
    const data = await postForm<ImagesApiResponse>('/images/edits', form, apiKey);
    const first = data.data[0] ?? {};
    return {
      url: first.url,
      b64Json: first.b64_json,
      all: data.data,
      model: opts.model,
    };
  }

  // ── TTS ────────────────────────────────────────────────────────────
  async tts(opts: TtsOptions): Promise<TtsResult> {
    const apiKey = resolveKey(opts);
    const format = opts.format ?? 'mp3';
    const body: Record<string, unknown> = {
      model: opts.model,
      voice: opts.voice,
      input: opts.input,
      response_format: format,
    };
    if (opts.instructions && opts.model === 'gpt-4o-mini-tts') {
      body.instructions = opts.instructions;
    }
    if (opts.speed != null && (opts.model === 'tts-1' || opts.model === 'tts-1-hd')) {
      body.speed = opts.speed;
    }
    const audio = await postFormBinary('/audio/speech', body, apiKey);
    return { audio, format, model: opts.model };
  }

  // ── STT ────────────────────────────────────────────────────────────
  async transcribe(opts: TranscribeOptions): Promise<TranscribeResult> {
    const apiKey = resolveKey(opts);
    const form = new FormData();
    form.append('model', opts.model);

    const isDiarize = opts.model === 'gpt-4o-transcribe-diarize';
    if (isDiarize) {
      // The diarize model rejects `prompt`, `temperature`, `num_speakers`,
      // `timestamp_granularities[]`, and `response_format: verbose_json`.
      // It expects `chunking_strategy=auto` for audio >30s. The optional
      // `known_speaker_names[]` / `known_speaker_references[]` pair is not
      // surfaced through `TranscribeOptions` yet.
      form.append('response_format', 'json');
      form.append('chunking_strategy', 'auto');
      if (opts.language) form.append('language', opts.language);
    } else {
      form.append('response_format', opts.responseFormat ?? 'verbose_json');
      if (opts.language) form.append('language', opts.language);
      if (opts.prompt) form.append('prompt', opts.prompt);
      if (opts.temperature != null) form.append('temperature', String(opts.temperature));
      if (opts.numSpeakers != null) form.append('num_speakers', String(opts.numSpeakers));
    }

    const audioBlob = await urlOrBytesToBlob(opts.audio);
    const fileName = opts.filename ?? 'audio.mp3';
    form.append('file', audioBlob, fileName);

    const path =
      opts.task === 'translate' && opts.model === 'whisper-1'
        ? '/audio/translations'
        : '/audio/transcriptions';

    interface RawResp {
      text: string;
      language?: string;
      duration?: number;
      segments?: Array<{
        id: number;
        start: number;
        end: number;
        text: string;
        speaker?: string;
      }>;
      words?: Array<{ word: string; start: number; end: number; speaker?: string }>;
    }
    const raw = await postForm<RawResp>(path, form, apiKey);
    return {
      text: raw.text,
      language: raw.language,
      duration: raw.duration,
      segments: raw.segments,
      words: raw.words,
      model: opts.model,
    };
  }

  // ── Chat ───────────────────────────────────────────────────────────
  async chat(opts: ChatOptions): Promise<ChatResult> {
    const apiKey = resolveKey(opts);
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: opts.messages,
    };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.topP != null) body.top_p = opts.topP;
    if (opts.maxTokens != null) body.max_completion_tokens = opts.maxTokens;
    if (opts.tools) body.tools = opts.tools;
    if (opts.toolChoice) body.tool_choice = opts.toolChoice;
    if (opts.jsonMode && !opts.responseSchema) {
      body.response_format = { type: 'json_object' };
    }
    if (opts.responseSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', schema: opts.responseSchema, strict: true },
      };
    }

    interface ChatCompletionResp {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    }

    const data = await postJson<ChatCompletionResp>('/chat/completions', body, apiKey);
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('OpenAI chat: no choices returned');
    }

    let toolCalls: ChatResult['toolCalls'];
    if (choice.message.tool_calls?.length) {
      toolCalls = choice.message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeJsonParse(tc.function.arguments),
      }));
    }

    return {
      text: choice.message.content ?? '',
      toolCalls,
      usage: {
        prompt_tokens: data.usage.prompt_tokens,
        completion_tokens: data.usage.completion_tokens,
        cached_input_tokens: data.usage.prompt_tokens_details?.cached_tokens,
        total_tokens: data.usage.total_tokens,
      },
      model: opts.model,
      finishReason: choice.finish_reason,
    };
  }

  // ── Vision (chat with image inputs) ─────────────────────────────────
  async vision(opts: {
    model: Extract<
      OpenAIChatModel,
      'gpt-5' | 'gpt-5-mini' | 'gpt-4.1' | 'gpt-4.1-mini' | 'o3' | 'o4-mini'
    >;
    prompt: string;
    imageUrls: string[];
    apiKey: string;
    maxTokens?: number;
    jsonMode?: boolean;
    responseSchema?: Record<string, unknown>;
  }): Promise<ChatResult> {
    return this.chat({
      apiKey: opts.apiKey,
      model: opts.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt },
            ...opts.imageUrls.map((url) => ({
              type: 'image_url' as const,
              image_url: { url, detail: 'auto' as const },
            })),
          ],
        },
      ],
      maxTokens: opts.maxTokens,
      jsonMode: opts.jsonMode,
      responseSchema: opts.responseSchema,
    });
  }

  // ── Files API ──────────────────────────────────────────────────────
  /**
   * Upload bytes to `POST /v1/files`. Used by `uploadImageReferenceForSora`
   * to convert an https image URL into a file_id Sora's JSON Videos API
   * will accept as `input_reference`. The default purpose is `'vision'`.
   */
  async uploadFile(opts: UploadFileOptions): Promise<UploadedFile> {
    const apiKey = resolveKey(opts);
    const form = new FormData();
    const ct = opts.contentType ?? 'image/png';
    form.append('file', new Blob([opts.bytes as BlobPart], { type: ct }), opts.filename);
    form.append('purpose', opts.purpose ?? 'vision');
    return await postForm<UploadedFile>('/files', form, apiKey);
  }

  /**
   * Convenience: fetch an https image URL (with SSRF guard), upload to
   * the Files API, return the resulting file id. Sora's JSON Videos API
   * accepts this id as `input_reference` for image-to-video.
   */
  async uploadImageReferenceForSora(opts: { apiKey: string; imageUrl: string }): Promise<string> {
    const { validateUploadUrl } = await import('../lib/url-validator');
    await validateUploadUrl(opts.imageUrl);
    const fetched = await fetch(opts.imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!fetched.ok) {
      throw new Error(`Sora: failed to fetch reference image (${fetched.status})`);
    }
    const contentType = fetched.headers.get('content-type') ?? 'image/png';
    const bytes = new Uint8Array(await fetched.arrayBuffer());
    const ext = contentType.includes('jpeg')
      ? 'jpg'
      : contentType.includes('webp')
        ? 'webp'
        : 'png';
    const uploaded = await this.uploadFile({
      apiKey: opts.apiKey,
      bytes,
      filename: `sora-input.${ext}`,
      contentType,
      purpose: 'vision',
    });
    return uploaded.id;
  }

  // ── Sora 2 (async, poll-based) ─────────────────────────────────────
  async createSoraTask(opts: SoraGenerateOptions): Promise<SoraTask> {
    const apiKey = resolveKey(opts);
    // Sora 2 expects `seconds` (string) + `size` (pixel string like
    // "1280x720"), NOT `duration_seconds` / `resolution` / `aspect_ratio`.
    // Image-to-video uses `input_reference` referencing a file id from
    // `/v1/files` — public URLs are not accepted on the JSON Videos API.
    const seconds = String(opts.durationSec ?? 8);
    const reso = opts.resolution ?? '720p';
    const aspect = opts.aspectRatio ?? '16:9';
    const sizeMap: Record<string, string> = {
      '720p:16:9': '1280x720',
      '720p:9:16': '720x1280',
      '1080p:16:9': '1920x1080',
      '1080p:9:16': '1080x1920',
    };
    const size = sizeMap[`${reso}:${aspect}`] ?? '1280x720';
    const body: Record<string, unknown> = {
      model: opts.model,
      prompt: opts.prompt,
      seconds,
      size,
    };
    if (opts.inputReferenceFileId) body.input_reference = opts.inputReferenceFileId;
    interface SoraCreateResp {
      id: string;
      status: SoraTask['status'];
      video_url?: string;
      error?: string;
    }
    const data = await postJson<SoraCreateResp>('/videos', body, apiKey);
    return {
      id: data.id,
      status: data.status,
      videoUrl: data.video_url,
      error: data.error,
      model: opts.model,
    };
  }

  async getSoraTask(taskId: string, apiKey: string, signal?: AbortSignal): Promise<SoraTask> {
    const key = resolveKey({ apiKey });
    interface SoraGetResp {
      id: string;
      status: SoraTask['status'];
      video_url?: string;
      error?: string;
      model: OpenAISoraModel;
    }
    // Inline fetch so the caller's signal composes with our per-call timeout.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new Error('Sora poll timeout')), 60_000);
    const onCallerAbort = () => ac.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) ac.abort(signal.reason);
      else signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    let data: SoraGetResp;
    try {
      const res = await fetch(`${BASE_URL}/videos/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal: ac.signal,
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(
          `OpenAI /videos/${taskId} ${res.status}: ${redactSecrets(errBody).slice(0, 500)}`
        );
      }
      data = (await res.json()) as SoraGetResp;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }
    return {
      id: data.id,
      status: data.status,
      videoUrl: data.video_url,
      error: data.error,
      model: data.model,
    };
  }

  // ── Embeddings ─────────────────────────────────────────────────────
  async embed(opts: EmbeddingOptions): Promise<EmbeddingResult> {
    const apiKey = resolveKey(opts);
    const body: Record<string, unknown> = {
      model: opts.model,
      input: opts.input,
    };
    if (opts.dimensions) body.dimensions = opts.dimensions;
    interface EmbeddingResp {
      data: Array<{ embedding: number[] }>;
      usage: { prompt_tokens: number; total_tokens: number };
    }
    const data = await postJson<EmbeddingResp>('/embeddings', body, apiKey);
    return {
      vectors: data.data.map((d) => d.embedding),
      usage: data.usage,
      model: opts.model,
    };
  }
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export const openAIService = new OpenAIService();
