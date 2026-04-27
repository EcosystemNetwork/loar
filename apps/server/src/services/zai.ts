/**
 * Z.AI service — full-stack adapter for the Zhipu AI / Z.AI devpack.
 *
 * Powers Track 1 (AI-Native New Species) + Track 4 (Crypto & Agents) workflows
 * in LOAR: GLM-5.1 reasoning + tool use, GLM-5V vision, GLM-Image / CogView-4
 * for stills, CogVideoX-3 / Vidu Q1 for motion, GLM-ASR for speech-to-text,
 * plus the Web Search / Web Reader / Translation / Slide-Poster agent APIs.
 *
 * Every method takes an optional `apiKey` so the BYOK flow can pass a
 * user-supplied key from the encrypted userSecrets store without ever
 * touching the platform-level env key. Behaviour mirrors `bytedance.ts`
 * exactly so the UI / router patterns line up.
 *
 * Docs: https://docs.z.ai/llms.txt
 * Base URL: https://api.z.ai/api/paas/v4
 */

// ── Common ───────────────────────────────────────────────────────────────

export interface ZaiCallOptions {
  /** If set, this single API key is used (no env rotation). */
  apiKey?: string;
}

const BASE_URL = 'https://api.z.ai/api/paas/v4';
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 90; // 6 minutes — video gen can be slow

// ── Chat (GLM-5.1 / 5-Turbo / 4.6 / 4.5-Air) ────────────────────────────

export interface ZaiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  tool_call_id?: string;
  name?: string;
}

export interface ZaiChatTool {
  type: 'function' | 'web_search' | 'retrieval';
  function?: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
  web_search?: { enable: boolean; search_query?: string };
}

export interface ZaiChatOptions extends ZaiCallOptions {
  /** Model id — defaults to 'glm-4.7' (devpack-tier coverage + latest GLM). */
  model?: string;
  messages: ZaiChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** When true, returns JSON-only output (handy for entity extractors). */
  jsonMode?: boolean;
  /** Optional structured-output schema enforcement. */
  responseSchema?: Record<string, unknown>;
  tools?: ZaiChatTool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** Enable Z.AI's deep-thinking / reasoning mode (GLM-5.x). */
  thinking?: boolean;
}

export interface ZaiChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ZaiChatResult {
  content: string;
  /** Chain-of-thought from GLM reasoning models (4.7, 5.1). Empty on non-reasoning models. */
  reasoningContent?: string;
  toolCalls?: ZaiChatToolCall[];
  finishReason?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  raw?: unknown;
}

// ── Image (GLM-Image / CogView-4) ────────────────────────────────────────

export interface ZaiImageOptions extends ZaiCallOptions {
  prompt: string;
  /** Defaults to 'glm-image' — confirmed working against api.z.ai 2026-04-26.
   *  Z.AI does not currently expose `cogview-*` ids on the paas/v4 surface;
   *  attempting them returns code 1211 "Unknown Model". */
  model?: string;
  /** e.g. '1024x1024', '1280x720', '720x1280'. */
  size?: string;
  /** Batch size; not all models support >1. */
  n?: number;
  /** Optional reference image URL (for image-conditioned models). */
  imageUrl?: string;
  userId?: string;
}

export interface ZaiImageResult {
  status: 'completed' | 'failed';
  images: Array<{ url: string; b64?: string }>;
  raw?: unknown;
  error?: string;
}

// ── Video (CogVideoX-3 / Vidu Q1) ────────────────────────────────────────

export interface ZaiVideoOptions extends ZaiCallOptions {
  prompt: string;
  /** Defaults pick automatically: `viduq1-image` when `imageUrl` is set,
   *  else `viduq1-text`. These are the only video model ids exposed on
   *  api.z.ai paas/v4 as of 2026-04-26 — `cogvideox-*` returns code 1211. */
  model?: string;
  /** Reference image for image-to-video. */
  imageUrl?: string;
  /** Optional ending frame for first-and-last-frame generation. */
  endImageUrl?: string;
  /** 5 / 10 seconds typical, model-dependent. */
  duration?: number;
  /** '720p' | '1080p' typical. */
  quality?: string;
  /** Aspect ratio hint, e.g. '16:9', '9:16'. */
  aspectRatio?: string;
  /** Generate audio track inline (CogVideoX-3 supports it). */
  withAudio?: boolean;
  style?: string;
  userId?: string;
}

export interface ZaiVideoResult {
  id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  videoUrl?: string;
  coverUrl?: string;
  error?: string;
  raw?: unknown;
}

// ── ASR (GLM-ASR-2512) ───────────────────────────────────────────────────

export interface ZaiTranscribeOptions extends ZaiCallOptions {
  /** Either url OR base64+mimeType is required. */
  url?: string;
  base64?: string;
  mimeType?: string;
  model?: string;
  language?: string;
}

export interface ZaiTranscribeResult {
  text: string;
  language?: string;
  segments?: Array<{ start: number; end: number; text: string }>;
  raw?: unknown;
}

// ── Web Search / Web Reader ──────────────────────────────────────────────

export interface ZaiWebSearchOptions extends ZaiCallOptions {
  query: string;
  /** 'search_std' | 'search_pro' | 'search_pro_sogou' etc. */
  searchEngine?: string;
  count?: number;
}

export interface ZaiWebSearchResult {
  results: Array<{
    title: string;
    link: string;
    snippet?: string;
    content?: string;
    publishDate?: string;
  }>;
  raw?: unknown;
}

export interface ZaiWebReaderOptions extends ZaiCallOptions {
  url: string;
}

export interface ZaiWebReaderResult {
  title?: string;
  content: string;
  url: string;
  raw?: unknown;
}

// ── Service ──────────────────────────────────────────────────────────────

class ZaiServiceImpl {
  private apiKeys: string[] | null = null;
  private activeKeyIdx = 0;

  /** Resolve env-configured keys (comma-separated). */
  private ensureConfigured(): string[] {
    if (!this.apiKeys) {
      const raw = (process.env.ZAI_API_KEY || process.env.Z_AI_API_KEY || '').trim();
      this.apiKeys = raw
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    }
    if (this.apiKeys.length === 0) {
      throw new Error(
        'ZAI_API_KEY is not configured. Set it in the root .env, or have the user paste a key in /settings/api-keys (BYOK).'
      );
    }
    return this.apiKeys;
  }

  /** Returns true if at least one key (env or BYOK) is plausible. */
  isConfigured(byok?: string): boolean {
    if (byok && byok.trim().length >= 8) return true;
    try {
      this.ensureConfigured();
      return true;
    } catch {
      return false;
    }
  }

  private async request<T>(path: string, init: RequestInit = {}, overrideKey?: string): Promise<T> {
    const url = `${BASE_URL}${path}`;
    const key = overrideKey?.trim() || this.ensureConfigured()[this.activeKeyIdx];
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        ...(init.headers ?? {}),
      },
    });

    if (response.ok) {
      const ct = response.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) return response.json() as Promise<T>;
      return (await response.text()) as unknown as T;
    }

    const body = await response.text().catch(() => '');
    let detail = '';
    try {
      const parsed = JSON.parse(body);
      detail = parsed?.error?.message || parsed?.message || parsed?.detail || parsed?.code || body;
    } catch {
      detail = body;
    }

    // Rotate key on 401/403/429 if running on env keys
    if (
      !overrideKey &&
      (response.status === 401 || response.status === 403 || response.status === 429) &&
      this.apiKeys &&
      this.apiKeys.length > 1
    ) {
      this.activeKeyIdx = (this.activeKeyIdx + 1) % this.apiKeys.length;
    }

    const tag = overrideKey ? ' (BYOK)' : '';
    throw new Error(`Z.AI API error ${response.status}${tag}: ${detail}`.slice(0, 500));
  }

  // ── Chat ────────────────────────────────────────────────────────────

  async chat(opts: ZaiChatOptions): Promise<ZaiChatResult> {
    const body: Record<string, unknown> = {
      model: opts.model ?? 'glm-4.7',
      messages: opts.messages,
      temperature: opts.temperature ?? 0.7,
      ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
      ...(opts.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {}),
      ...(opts.tools ? { tools: opts.tools } : {}),
      ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
    };

    if (opts.jsonMode || opts.responseSchema) {
      body.response_format = opts.responseSchema
        ? { type: 'json_schema', json_schema: opts.responseSchema }
        : { type: 'json_object' };
    }
    if (opts.thinking) {
      body.thinking = { type: 'enabled' };
    }

    const raw = await this.request<{
      choices?: Array<{
        message?: {
          content?: string;
          reasoning_content?: string;
          tool_calls?: ZaiChatToolCall[];
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    }>('/chat/completions', { method: 'POST', body: JSON.stringify(body) }, opts.apiKey);

    const choice = raw.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      reasoningContent: choice?.message?.reasoning_content,
      toolCalls: choice?.message?.tool_calls,
      finishReason: choice?.finish_reason,
      usage: {
        promptTokens: raw.usage?.prompt_tokens,
        completionTokens: raw.usage?.completion_tokens,
        totalTokens: raw.usage?.total_tokens,
      },
      raw,
    };
  }

  /** Convenience: chat with strict-JSON output, parsed for the caller. */
  async chatJson<T = unknown>(
    opts: Omit<ZaiChatOptions, 'jsonMode'> & { schema?: Record<string, unknown> }
  ): Promise<{ data: T; usage?: ZaiChatResult['usage']; reasoningContent?: string }> {
    const result = await this.chat({
      ...opts,
      jsonMode: !opts.schema,
      responseSchema: opts.schema,
    });
    let data: T;
    try {
      data = JSON.parse(result.content) as T;
    } catch {
      // Some models wrap JSON in code fences — strip them and retry.
      const stripped = result.content
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      data = JSON.parse(stripped) as T;
    }
    return { data, usage: result.usage, reasoningContent: result.reasoningContent };
  }

  // ── Vision (GLM-5V / 4.6V) ──────────────────────────────────────────

  async vision(opts: {
    apiKey?: string;
    model?: string;
    prompt: string;
    imageUrls: string[];
    maxTokens?: number;
  }): Promise<ZaiChatResult> {
    return this.chat({
      apiKey: opts.apiKey,
      model: opts.model ?? 'glm-4.5v',
      maxTokens: opts.maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: opts.prompt },
            ...opts.imageUrls.map((url) => ({
              type: 'image_url' as const,
              image_url: { url },
            })),
          ],
        },
      ],
    });
  }

  // ── Image generation ────────────────────────────────────────────────

  async generateImage(opts: ZaiImageOptions): Promise<ZaiImageResult> {
    const body: Record<string, unknown> = {
      model: opts.model ?? 'glm-image',
      prompt: opts.prompt,
      ...(opts.size ? { size: opts.size } : {}),
      ...(opts.n ? { n: opts.n } : {}),
      ...(opts.imageUrl ? { image_url: opts.imageUrl } : {}),
      ...(opts.userId ? { user_id: opts.userId } : {}),
    };

    try {
      const raw = await this.request<{
        data?: Array<{ url?: string; b64_json?: string }>;
        created?: number;
      }>('/images/generations', { method: 'POST', body: JSON.stringify(body) }, opts.apiKey);

      const images = (raw.data ?? [])
        .map((d) => ({ url: d.url ?? '', b64: d.b64_json }))
        .filter((d) => d.url || d.b64);

      if (images.length === 0) {
        return { status: 'failed', images: [], raw, error: 'No image data returned' };
      }
      return { status: 'completed', images, raw };
    } catch (err) {
      return {
        status: 'failed',
        images: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Video generation (async + poll) ────────────────────────────────

  async generateVideo(opts: ZaiVideoOptions): Promise<ZaiVideoResult> {
    const submitted = await this.submitVideo(opts);
    if (submitted.status === 'failed' || !submitted.id) return submitted;
    return this.pollVideo(submitted.id, opts.apiKey);
  }

  /** Fire-and-forget submission — returns the Z.AI task id without polling. */
  async submitVideo(opts: ZaiVideoOptions): Promise<ZaiVideoResult> {
    // Smart model default: viduq1-image when an input frame is supplied
    // (image-to-video), otherwise viduq1-text. The API rejects `cogvideox-*`
    // and bare `viduq1` — only the typed variants are accepted.
    const defaultModel = opts.imageUrl ? 'viduq1-image' : 'viduq1-text';
    const body: Record<string, unknown> = {
      model: opts.model ?? defaultModel,
      prompt: opts.prompt,
      ...(opts.imageUrl ? { image_url: opts.imageUrl } : {}),
      ...(opts.endImageUrl ? { end_image_url: opts.endImageUrl } : {}),
      ...(opts.duration ? { duration: opts.duration } : {}),
      ...(opts.quality ? { quality: opts.quality } : {}),
      ...(opts.aspectRatio ? { size: aspectRatioToSize(opts.aspectRatio) } : {}),
      ...(opts.withAudio !== undefined ? { with_audio: opts.withAudio } : {}),
      ...(opts.style ? { style: opts.style } : {}),
      ...(opts.userId ? { user_id: opts.userId } : {}),
    };

    try {
      const submitted = await this.request<{
        id?: string;
        request_id?: string;
        task_id?: string;
      }>('/videos/generations', { method: 'POST', body: JSON.stringify(body) }, opts.apiKey);
      const id = submitted.id ?? submitted.request_id ?? submitted.task_id;
      if (!id) return { id: '', status: 'failed', error: 'No task id returned by Z.AI' };
      return { id, status: 'pending' };
    } catch (err) {
      return {
        id: '',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async pollVideo(taskId: string, apiKey?: string): Promise<ZaiVideoResult> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const status = await this.getVideoStatus(taskId, apiKey);
      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return { id: taskId, status: 'failed', error: 'Z.AI video polling timed out' };
  }

  async getVideoStatus(taskId: string, apiKey?: string): Promise<ZaiVideoResult> {
    const raw = await this.request<{
      id?: string;
      task_status?: string;
      video_result?: Array<{ url?: string; cover_image_url?: string }>;
      error?: { message?: string };
    }>(`/async-result/${encodeURIComponent(taskId)}`, { method: 'GET' }, apiKey);

    const status = mapVideoStatus(raw.task_status);
    const first = raw.video_result?.[0];
    return {
      id: raw.id ?? taskId,
      status,
      videoUrl: first?.url,
      coverUrl: first?.cover_image_url,
      error: raw.error?.message,
      raw,
    };
  }

  // ── ASR (GLM-ASR-2512) ─────────────────────────────────────────────
  // The transcriptions endpoint is multipart/form-data only. Mono audio
  // is required — stereo input returns code 1214 "supports mono only".

  async transcribe(opts: ZaiTranscribeOptions): Promise<ZaiTranscribeResult> {
    if (!opts.url && !opts.base64) {
      throw new Error('zai.transcribe requires either url or base64 input');
    }

    // Resolve to a Buffer regardless of input form — multipart needs bytes.
    let audioBytes: Buffer;
    let contentType = opts.mimeType ?? 'audio/wav';
    if (opts.base64) {
      audioBytes = Buffer.from(opts.base64, 'base64');
    } else {
      const fetched = await fetch(opts.url!);
      if (!fetched.ok) throw new Error(`Failed to fetch audio: HTTP ${fetched.status}`);
      audioBytes = Buffer.from(await fetched.arrayBuffer());
      contentType = fetched.headers.get('content-type') ?? contentType;
    }

    const ext = contentType.includes('mp3')
      ? 'mp3'
      : contentType.includes('webm')
        ? 'webm'
        : contentType.includes('ogg')
          ? 'ogg'
          : 'wav';

    const form = new FormData();
    // Live-confirmed against api.z.ai paas/v4 on 2026-04-26: the documented
    // `glm-asr` alias is rejected; the date-versioned id `glm-asr-2512` is
    // the only one accepted. Returns { text, created, id, request_id, usage }.
    form.append('model', opts.model ?? 'glm-asr-2512');
    if (opts.language) form.append('language', opts.language);
    form.append(
      'file',
      new Blob([new Uint8Array(audioBytes)], { type: contentType }),
      `audio.${ext}`
    );

    const apiKey = opts.apiKey?.trim() || this.ensureConfigured()[this.activeKeyIdx];
    const response = await fetch(`${BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      let detail = body;
      try {
        detail = JSON.parse(body)?.error?.message ?? body;
      } catch {
        // body is not JSON — keep raw
      }
      throw new Error(`Z.AI ASR error ${response.status}: ${detail}`.slice(0, 500));
    }

    const raw = (await response.json()) as {
      text?: string;
      language?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
    };

    return {
      text: raw.text ?? '',
      language: raw.language,
      segments: raw.segments,
      raw,
    };
  }

  // ── Web Search ──────────────────────────────────────────────────────

  async webSearch(opts: ZaiWebSearchOptions): Promise<ZaiWebSearchResult> {
    const body = {
      search_query: opts.query,
      search_engine: opts.searchEngine ?? 'search_std',
      count: opts.count ?? 10,
    };
    // Live API returns each result as { title, link, content, publish_date,
    // refer, icon, media }. There is no separate `snippet` field — `content`
    // serves both the preview and full-snippet roles.
    const raw = await this.request<{
      search_result?: Array<{
        title?: string;
        link?: string;
        content?: string;
        publish_date?: string;
        refer?: string;
        icon?: string;
        media?: string;
      }>;
    }>('/web_search', { method: 'POST', body: JSON.stringify(body) }, opts.apiKey);

    return {
      results: (raw.search_result ?? []).map((r) => ({
        title: r.title ?? '',
        link: r.link ?? '',
        snippet: r.content,
        content: r.content,
        publishDate: r.publish_date,
      })),
      raw,
    };
  }

  // ── Web Reader (local fallback) ────────────────────────────────────
  // Z.AI's paas/v4 surface does NOT expose a standalone web reader endpoint
  // — `/tools/web_reader`, `/web_reader`, and `/tools/web-reader` all 404.
  // We do the readable-text extraction ourselves: fetch the page, strip
  // <script> / <style>, collapse whitespace, return the first ~10KB. Honest
  // about the limitation; preserves the API shape the router was built
  // against so seedFromUrl keeps working.

  async webReader(opts: ZaiWebReaderOptions): Promise<ZaiWebReaderResult> {
    const response = await fetch(opts.url, {
      headers: {
        // Some sites refuse default fetch UA. Spoof a common one so we get
        // the public page rather than a 403 / robot interstitial.
        'User-Agent': 'Mozilla/5.0 (compatible; LOAR-WebReader/1.0; +https://loar.fun)',
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new Error(`Web reader fetch failed: HTTP ${response.status}`);
    }

    const html = await response.text();

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.trim();

    const cleaned = html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr|br)>/gi, '$&\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const content = cleaned.slice(0, 12000);

    return { title, content, url: opts.url, raw: { html: html.length } };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function aspectRatioToSize(aspect: string): string {
  const presets: Record<string, string> = {
    '1:1': '1024x1024',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1280x540',
  };
  return presets[aspect] ?? aspect;
}

function mapVideoStatus(s: string | undefined): ZaiVideoResult['status'] {
  switch ((s ?? '').toUpperCase()) {
    case 'SUCCESS':
    case 'COMPLETED':
      return 'completed';
    case 'FAIL':
    case 'FAILED':
    case 'CANCELLED':
      return 'failed';
    case 'PROCESSING':
    case 'RUNNING':
      return 'in_progress';
    case 'PENDING':
    case 'WAITING':
    default:
      return 'pending';
  }
}

export const zaiService = new ZaiServiceImpl();
export type ZaiService = typeof zaiService;
