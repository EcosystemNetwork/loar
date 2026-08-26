/**
 * Google-backed adapter for LOAR's "Model Lab" (formerly the Z.AI devpack
 * integration — Z.AI credits ran out 2026-08-23). This service now speaks
 * to Google's Gemini / Imagen / Veo APIs directly instead of api.z.ai, but
 * keeps the exact method names, option shapes, and result shapes the
 * caller side already depends on:
 *   - routers/zai/zai.routes.ts (the /lab/zai tRPC surface)
 *   - components/zai/script-compare.tsx (shared between /lab/zai and /create)
 * Neither needed structural changes for this swap — only the model-id
 * enums they pass in changed from GLM ids to Gemini/Imagen/Veo ids.
 *
 * Why this duplicates rather than reuses `services/gemini.ts`: this swap
 * needed a `thinkingConfig` addition (for the Lab's chain-of-thought demo)
 * that `geminiChat()` doesn't have, and a GitNexus impact() check on that
 * function came back CRITICAL — 700+ upstream symbols across wiki
 * generation, character analysis, TTS/3D dispatch, captions, etc. Talking
 * to the Gemini REST API directly here instead keeps the blast radius
 * contained to this file + its router, which a prior impact() run
 * confirmed is isolated (~6 upstream callers per method, all inside the
 * zai router). Some duplication of gemini.ts's REST plumbing is the
 * deliberate trade-off for that isolation.
 *
 * BYOK: every method takes an optional `apiKey`, resolved by the router via
 * `resolveProviderKey(uid, 'google')` (see lib/byok.ts), falling back to
 * the platform `GOOGLE_API_KEY`. No plaintext key ever leaves server memory.
 *
 * SSRF hardening: every fetch of a *caller-supplied* URL (reference images,
 * audio, the web reader target) goes through `safeFetch` from
 * lib/url-validator.ts — private/loopback/link-local/cloud-metadata targets
 * are rejected before a DNS-pinned connection is made, and redirects are
 * refused rather than followed. This closes the SSRF findings from the Lab
 * feature audit (2026-08-23): unrestricted fetch of `seedFromUrl`'s target
 * and `transcribe`'s audio URL.
 */

import { getStorageManager } from './storage';
import { safeFetch } from '../lib/url-validator';
import { redactSecrets } from '../lib/redact-secrets';

// ── Common ───────────────────────────────────────────────────────────────

export interface ZaiCallOptions {
  /** If set, this single API key is used instead of the platform env key. */
  apiKey?: string;
}

const GEMINI_REST = 'https://generativelanguage.googleapis.com/v1beta';
const POLL_INTERVAL_MS = 4000;
const MAX_POLL_ATTEMPTS = 90; // 6 minutes — video gen can be slow

// ── Chat (Gemini 2.5 / 3.1) ─────────────────────────────────────────────

export interface ZaiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content:
    | string
    | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
  tool_call_id?: string;
  name?: string;
}

/** Kept for interface parity with the pre-swap type — no caller currently
 *  passes `tools`/`toolChoice`, and Gemini function-calling isn't wired up. */
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
  /** Short model id — see CHAT_MODEL_MAP below. Defaults to 'gemini-2-5-flash'. */
  model?: string;
  messages: ZaiChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** When true, returns JSON-only output. */
  jsonMode?: boolean;
  /** Optional structured-output schema enforcement (Gemini-flavoured JSON Schema). */
  responseSchema?: Record<string, unknown>;
  tools?: ZaiChatTool[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  /** Surfaces Gemini's chain-of-thought (2.5+ `thinkingConfig.includeThoughts`). */
  thinking?: boolean;
}

export interface ZaiChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ZaiChatResult {
  content: string;
  /** Chain-of-thought, present only when `thinking: true` and the model surfaced any. */
  reasoningContent?: string;
  toolCalls?: ZaiChatToolCall[];
  finishReason?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    cachedInputTokens?: number;
    totalTokens?: number;
  };
  raw?: unknown;
}

// ── Image (Imagen 4 / Gemini image) ──────────────────────────────────────

export interface ZaiImageOptions extends ZaiCallOptions {
  prompt: string;
  /** Short model id — see IMAGE_MODEL_MAP below. Defaults to 'nano-banana'. */
  model?: string;
  /** e.g. '1024x1024', '1280x720', '720x1280' — mapped to the nearest Imagen aspect ratio. */
  size?: string;
  /** Batch size (predict endpoint only; the Gemini image endpoint always returns 1). */
  n?: number;
  /** Optional reference image URL (image-to-image on the Gemini endpoint). */
  imageUrl?: string;
  userId?: string;
}

export interface ZaiImageResult {
  status: 'completed' | 'failed';
  images: Array<{ url: string; b64?: string }>;
  raw?: unknown;
  error?: string;
}

// ── Video (Veo 3.1, Google-Direct) ───────────────────────────────────────

export interface ZaiVideoOptions extends ZaiCallOptions {
  prompt: string;
  /** Short model id — see VIDEO_MODEL_MAP below. Defaults to 'veo-31-fast-preview-google'. */
  model?: string;
  /** Reference image for image-to-video. */
  imageUrl?: string;
  /** Accepted for UI/schema parity with the old Vidu flow — Veo's Google-Direct
   *  surface has no first-and-last-frame parameter, so this has no effect. */
  endImageUrl?: string;
  /** Snapped to Veo's supported durations: 4 / 6 / 8 seconds. */
  duration?: number;
  /** '720p' | '1080p'. 4K is available on some tiers but not exposed here. */
  quality?: string;
  /** Only '16:9' and '9:16' are supported; anything else falls back to '16:9'. */
  aspectRatio?: string;
  /** Accepted for parity — every Google-Direct Veo tier currently rejects
   *  `generateAudio`, so this is never sent regardless of value. */
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

// ── ASR (Gemini multimodal transcription) ────────────────────────────────

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

// ── Model maps ───────────────────────────────────────────────────────────
// Short ids match the conventions used by services/llm-models/registry.ts,
// services/image-models/registry.ts and services/video-models/registry.ts
// elsewhere in the app, mapped here to the real provider model id. Kept as
// small local tables (rather than importing those registries) to avoid
// coupling this self-contained adapter to files outside the Lab surface.

const CHAT_MODEL_MAP: Record<string, string> = {
  'gemini-3-1-pro': 'gemini-3.1-pro-preview',
  'gemini-2-5-pro': 'gemini-2.5-pro',
  'gemini-2-5-flash': 'gemini-2.5-flash',
  'gemini-2-5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-3-1-flash-lite': 'gemini-3.1-flash-lite',
};
const DEFAULT_CHAT_MODEL = 'gemini-2-5-flash';

const IMAGE_MODEL_MAP: Record<string, string> = {
  'nano-banana': 'gemini-2.5-flash-image',
  'imagen-4': 'imagen-4.0-generate-001',
  'imagen-4-fast': 'imagen-4.0-fast-generate-001',
};
const DEFAULT_IMAGE_MODEL = 'nano-banana';
const PREDICT_IMAGE_MODELS = new Set([
  'imagen-4.0-generate-001',
  'imagen-4.0-fast-generate-001',
  'imagen-4.0-ultra-generate-001',
]);

const VIDEO_MODEL_MAP: Record<string, string> = {
  'veo-31-fast-preview-google': 'veo-3.1-fast-generate-preview',
  'veo-31-preview-google': 'veo-3.1-generate-preview',
  'veo-31-lite-preview-google': 'veo-3.1-lite-generate-preview',
};
const DEFAULT_VIDEO_MODEL = 'veo-31-fast-preview-google';
const VIDEO_SUPPORTED_DURATIONS = [4, 6, 8];

const TRANSCRIBE_MODEL_MAP: Record<string, string> = {
  'gemini-2-5-flash-transcribe': 'gemini-2.5-flash',
  'gemini-2-5-pro-transcribe': 'gemini-2.5-pro',
};
const DEFAULT_TRANSCRIBE_MODEL = 'gemini-2-5-flash-transcribe';

// ── Key resolution ───────────────────────────────────────────────────────

/**
 * Required — no `GOOGLE_API_KEY` env fallback. Callers must route through
 * `resolveProviderKey(uid, 'google')` (see lib/byok.ts) so BYOK lookup runs
 * and the key is always the caller's own (see openai.ts's Auditor note M5,
 * which closed this same hole first). `isConfigured()` below is unaffected
 * — it stays a platform-env informational readout for the Lab's status/
 * diagnostic endpoints, not an authorization path.
 */
function resolveKey(apiKey?: string): string {
  const key = apiKey?.trim();
  if (!key) {
    throw new Error(
      'No Google AI API key available — add one at /settings/api-keys to use the Model Lab.'
    );
  }
  return key;
}

// ── Shared fetch helpers ─────────────────────────────────────────────────

/** SSRF-guarded fetch of a caller-supplied URL, returned as base64 + mime. */
async function fetchAsBase64(
  url: string,
  timeoutMs: number
): Promise<{ mimeType: string; base64: string; sizeBytes: number }> {
  const res = await safeFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Failed to fetch ${url.slice(0, 80)}: HTTP ${res.status}`);
  const mimeType =
    res.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  const buf = Buffer.from(await res.arrayBuffer());
  return { mimeType, base64: buf.toString('base64'), sizeBytes: buf.byteLength };
}

function snapDuration(want: number | undefined): number {
  const target = want ?? VIDEO_SUPPORTED_DURATIONS[VIDEO_SUPPORTED_DURATIONS.length - 1];
  return VIDEO_SUPPORTED_DURATIONS.reduce(
    (best, d) => (Math.abs(d - target) < Math.abs(best - target) ? d : best),
    VIDEO_SUPPORTED_DURATIONS[0]
  );
}

function sizeToAspectRatio(size?: string): string {
  const table: Array<[string, number]> = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
  ];
  const match = size?.match(/^(\d+)x(\d+)$/);
  if (!match) return '1:1';
  const ratio = Number(match[1]) / Number(match[2]);
  let best = table[0];
  let bestDiff = Infinity;
  for (const t of table) {
    const diff = Math.abs(t[1] - ratio);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = t;
    }
  }
  return best[0];
}

function geminiAudioMime(contentType: string): string {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  if (ct === 'audio/mpeg') return 'audio/mp3';
  if (ct.startsWith('audio/') || ct.startsWith('video/')) return ct;
  return 'audio/mp3';
}

interface RawTranscriptSegment {
  start?: number;
  end?: number;
  text?: string;
}

function parseTranscriptSegments(
  rawText: string
): Array<{ start: number; end: number; text: string }> {
  let body = rawText.trim();
  if (body.startsWith('```')) {
    body = body
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
  }
  const first = body.indexOf('[');
  const last = body.lastIndexOf(']');
  if (first !== -1 && last !== -1 && last > first) body = body.slice(first, last + 1);
  let parsed: RawTranscriptSegment[] = [];
  try {
    const json = JSON.parse(body);
    parsed = Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
  return parsed
    .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
    .map((s) => {
      const start = Number.isFinite(s.start) ? Math.max(0, s.start as number) : 0;
      const end = Number.isFinite(s.end) ? Math.max(start, s.end as number) : start;
      return { start, end, text: (s.text as string).trim() };
    });
}

// ── Service ──────────────────────────────────────────────────────────────

class ZaiServiceImpl {
  /** Returns true if a plausible key is available (BYOK or platform env). */
  isConfigured(byok?: string): boolean {
    if (byok && byok.trim().length >= 8) return true;
    return !!process.env.GOOGLE_API_KEY?.trim();
  }

  // ── Chat ────────────────────────────────────────────────────────────

  async chat(opts: ZaiChatOptions): Promise<ZaiChatResult> {
    const apiKey = resolveKey(opts.apiKey);
    const shortId = opts.model && CHAT_MODEL_MAP[opts.model] ? opts.model : DEFAULT_CHAT_MODEL;
    const modelId = CHAT_MODEL_MAP[shortId];

    type Part = { text?: string; inline_data?: { mime_type: string; data: string } };
    type Content = { role: 'user' | 'model'; parts: Part[] };

    const systemTexts: string[] = [];
    const contents: Content[] = [];
    for (const m of opts.messages) {
      const flatten = async (): Promise<Part[]> => {
        if (typeof m.content === 'string') return [{ text: m.content }];
        const parts: Part[] = [];
        for (const p of m.content) {
          if (p.type === 'text') parts.push({ text: p.text });
          if (p.type === 'image_url') {
            const { mimeType, base64 } = await fetchAsBase64(p.image_url.url, 20_000);
            parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
          }
        }
        return parts;
      };

      if (m.role === 'system') {
        const parts = await flatten();
        const text = parts.map((p) => p.text ?? '').join('\n\n');
        if (text) systemTexts.push(text);
        continue;
      }
      // 'tool' role has no current caller — fold into 'user' rather than drop it.
      const role: Content['role'] = m.role === 'assistant' ? 'model' : 'user';
      const parts = await flatten();
      if (parts.length > 0) contents.push({ role, parts });
    }

    const body: Record<string, unknown> = { contents };
    if (systemTexts.length > 0) {
      body.system_instruction = { parts: [{ text: systemTexts.join('\n\n') }] };
    }
    const generationConfig: Record<string, unknown> = {};
    if (opts.temperature != null) generationConfig.temperature = opts.temperature;
    if (opts.topP != null) generationConfig.topP = opts.topP;
    if (opts.maxTokens != null) generationConfig.maxOutputTokens = opts.maxTokens;
    if (opts.jsonMode || opts.responseSchema) {
      generationConfig.responseMimeType = 'application/json';
      if (opts.responseSchema) generationConfig.responseSchema = opts.responseSchema;
    }
    if (opts.thinking) generationConfig.thinkingConfig = { includeThoughts: true };
    if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

    const res = await fetch(
      `${GEMINI_REST}/models/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini chat ${res.status}: ${redactSecrets(err).slice(0, 500)}`);
    }

    interface GeminiResp {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        finishReason?: string;
      }>;
      promptFeedback?: { blockReason?: string };
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
      };
    }
    const data = (await res.json()) as GeminiResp;
    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
    }
    const candidate = data.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason && !['STOP', 'MAX_TOKENS', 'FINISH_REASON_STOP'].includes(finishReason)) {
      throw new Error(
        `Gemini returned no usable text (finishReason=${finishReason}) — safety, recitation, or another non-completion stop.`
      );
    }
    const allParts = candidate?.content?.parts ?? [];
    const content = allParts
      .filter((p) => !p.thought && p.text)
      .map((p) => p.text ?? '')
      .join('');
    const reasoningParts = allParts.filter((p) => p.thought === true && p.text);
    const reasoningContent =
      reasoningParts.length > 0 ? reasoningParts.map((p) => p.text ?? '').join('\n\n') : undefined;

    return {
      content,
      reasoningContent,
      finishReason,
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      },
      raw: data,
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

    const candidates = [result.content, result.reasoningContent].filter(
      (s): s is string => typeof s === 'string' && s.trim().length > 0
    );
    if (candidates.length === 0) {
      throw new Error(
        `Gemini returned empty content (finishReason=${result.finishReason ?? 'unknown'}). The model may have hit max tokens before producing JSON.`
      );
    }

    const tryParse = (raw: string): T | null => {
      const stripped = raw
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '')
        .trim();
      try {
        return JSON.parse(stripped) as T;
      } catch {
        const match = stripped.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (!match) return null;
        try {
          return JSON.parse(match[0]) as T;
        } catch {
          return null;
        }
      }
    };

    for (const raw of candidates) {
      const parsed = tryParse(raw);
      if (parsed !== null) {
        return { data: parsed, usage: result.usage, reasoningContent: result.reasoningContent };
      }
    }

    const sample = (candidates[0] ?? '').slice(0, 200);
    throw new Error(
      `Gemini did not return valid JSON (finishReason=${result.finishReason ?? 'unknown'}). Sample: ${sample}`
    );
  }

  // ── Vision ────────────────────────────────────────────────────────────

  async vision(opts: {
    apiKey?: string;
    model?: string;
    prompt: string;
    imageUrls: string[];
    maxTokens?: number;
  }): Promise<ZaiChatResult> {
    return this.chat({
      apiKey: opts.apiKey,
      model: opts.model ?? 'gemini-2-5-flash',
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
    try {
      const apiKey = resolveKey(opts.apiKey);
      const shortId = opts.model && IMAGE_MODEL_MAP[opts.model] ? opts.model : DEFAULT_IMAGE_MODEL;
      const modelId = IMAGE_MODEL_MAP[shortId];

      const images = PREDICT_IMAGE_MODELS.has(modelId)
        ? await this.predictImage(modelId, opts, apiKey)
        : await this.geminiImageGenerate(modelId, opts, apiKey);

      if (images.length === 0) {
        return { status: 'failed', images: [], error: 'No image data returned' };
      }

      // Google returns base64 only (no hosted URL) — upload to LOAR storage
      // so the caller gets a real, permanent url the same way Z.AI's
      // response used to provide one.
      const uploaded = await Promise.all(
        images.map(async (img, idx) => {
          try {
            const buf = Buffer.from(img.base64, 'base64');
            const filename = `zai-img-${Date.now()}-${idx}.png`;
            const manifest = await getStorageManager().upload(
              buf,
              filename,
              img.mimeType,
              opts.userId
            );
            const url = manifest.uploads[0]?.url;
            return { url: url ?? '', b64: img.base64 };
          } catch (err) {
            console.warn(
              '[zai.generateImage] storage upload failed, returning inline data only',
              err
            );
            return { url: '', b64: img.base64 };
          }
        })
      );
      return { status: 'completed', images: uploaded };
    } catch (err) {
      return {
        status: 'failed',
        images: [],
        error: err instanceof Error ? redactSecrets(err.message) : String(err),
      };
    }
  }

  private async geminiImageGenerate(
    modelId: string,
    opts: ZaiImageOptions,
    apiKey: string
  ): Promise<Array<{ base64: string; mimeType: string }>> {
    const parts: Array<{ text: string } | { inline_data: { mime_type: string; data: string } }> =
      [];
    if (opts.imageUrl) {
      const { mimeType, base64 } = await fetchAsBase64(opts.imageUrl, 20_000);
      parts.push({ inline_data: { mime_type: mimeType, data: base64 } });
    }
    parts.push({ text: opts.prompt });

    const res = await fetch(
      `${GEMINI_REST}/models/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
        }),
        signal: AbortSignal.timeout(60_000),
      }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini image ${res.status}: ${redactSecrets(err).slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> };
      }>;
    };
    const out: Array<{ base64: string; mimeType: string }> = [];
    for (const c of data.candidates ?? []) {
      for (const p of c.content?.parts ?? []) {
        if (p.inlineData)
          out.push({ base64: p.inlineData.data, mimeType: p.inlineData.mimeType || 'image/png' });
      }
    }
    return out;
  }

  private async predictImage(
    modelId: string,
    opts: ZaiImageOptions,
    apiKey: string
  ): Promise<Array<{ base64: string; mimeType: string }>> {
    const res = await fetch(`${GEMINI_REST}/models/${encodeURIComponent(modelId)}:predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        instances: [{ prompt: opts.prompt }],
        parameters: {
          sampleCount: Math.min(Math.max(opts.n ?? 1, 1), 4),
          aspectRatio: sizeToAspectRatio(opts.size),
          safetyFilterLevel: 'BLOCK_ONLY_HIGH',
          personGeneration: 'ALLOW_ADULT',
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Imagen ${res.status}: ${redactSecrets(err).slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      predictions?: Array<{ bytesBase64Encoded: string; mimeType?: string }>;
    };
    return (data.predictions ?? []).map((p) => ({
      base64: p.bytesBase64Encoded,
      mimeType: p.mimeType || 'image/png',
    }));
  }

  // ── Video generation (Veo async LRO: submit + poll) ─────────────────

  async generateVideo(opts: ZaiVideoOptions): Promise<ZaiVideoResult> {
    const submitted = await this.submitVideo(opts);
    if (submitted.status === 'failed' || !submitted.id) return submitted;
    return this.pollVideo(submitted.id, opts.apiKey);
  }

  /** Fire-and-forget submission — returns the Veo operation id without polling. */
  async submitVideo(opts: ZaiVideoOptions): Promise<ZaiVideoResult> {
    try {
      const apiKey = resolveKey(opts.apiKey);
      const shortId = opts.model && VIDEO_MODEL_MAP[opts.model] ? opts.model : DEFAULT_VIDEO_MODEL;
      const modelId = VIDEO_MODEL_MAP[shortId];

      const instance: Record<string, unknown> = { prompt: opts.prompt };
      if (opts.imageUrl) {
        const { mimeType, base64 } = await fetchAsBase64(opts.imageUrl, 30_000);
        instance.image = { bytesBase64Encoded: base64, mimeType };
      }
      // endImageUrl: no equivalent parameter on the Google-Direct Veo surface —
      // intentionally not forwarded (see ZaiVideoOptions.endImageUrl doc).

      const parameters: Record<string, unknown> = {
        durationSeconds: snapDuration(opts.duration),
        aspectRatio: opts.aspectRatio === '9:16' ? '9:16' : '16:9',
        resolution: opts.quality === '1080p' ? '1080p' : '720p',
      };
      // generateAudio intentionally omitted — every Google-Direct Veo tier
      // currently rejects it, even `false` (see video-models/registry.ts).

      const res = await fetch(
        `${GEMINI_REST}/models/${encodeURIComponent(modelId)}:predictLongRunning`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ instances: [instance], parameters }),
          signal: AbortSignal.timeout(60_000),
        }
      );
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return {
          id: '',
          status: 'failed',
          error: `Veo create ${res.status}: ${redactSecrets(err).slice(0, 400)}`,
        };
      }
      const data = (await res.json()) as {
        name?: string;
        done?: boolean;
        error?: { message?: string };
      };
      if (!data.name) {
        return {
          id: '',
          status: 'failed',
          error: data.error?.message ?? 'No operation id returned by Veo',
        };
      }
      // Strip the "operations/" prefix so the id is slash-free: it becomes
      // both a Firestore doc id (which cannot contain "/") and a
      // /lab/zai/video/$jobId URL param upstream. Reconstructed in
      // getVideoStatus() below.
      const id = data.name.replace(/^operations\//, '');
      return { id, status: data.done ? 'completed' : 'pending' };
    } catch (err) {
      return { id: '', status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
  }

  async pollVideo(taskId: string, apiKey?: string): Promise<ZaiVideoResult> {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      const status = await this.getVideoStatus(taskId, apiKey);
      if (status.status === 'completed' || status.status === 'failed') return status;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return { id: taskId, status: 'failed', error: 'Veo video polling timed out' };
  }

  async getVideoStatus(taskId: string, apiKey?: string): Promise<ZaiVideoResult> {
    try {
      const key = resolveKey(apiKey);
      const operationName = taskId.startsWith('operations/') ? taskId : `operations/${taskId}`;
      const res = await fetch(`${GEMINI_REST}/${operationName}`, {
        method: 'GET',
        headers: { 'x-goog-api-key': key },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return {
          id: taskId,
          status: 'failed',
          error: `Veo poll ${res.status}: ${redactSecrets(err).slice(0, 400)}`,
        };
      }
      const data = (await res.json()) as {
        done?: boolean;
        error?: { message?: string };
        response?: {
          generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> };
        };
      };
      if (data.error) return { id: taskId, status: 'failed', error: data.error.message };
      if (!data.done) return { id: taskId, status: 'in_progress' };
      const videoUrl = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!videoUrl)
        return {
          id: taskId,
          status: 'failed',
          error: 'Veo finished with no video in the response',
        };
      return { id: taskId, status: 'completed', videoUrl };
    } catch (err) {
      return {
        id: taskId,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── ASR (Gemini multimodal transcription) ────────────────────────────

  async transcribe(opts: ZaiTranscribeOptions): Promise<ZaiTranscribeResult> {
    if (!opts.url && !opts.base64) {
      throw new Error('zai.transcribe requires either url or base64 input');
    }
    const apiKey = resolveKey(opts.apiKey);
    const shortId =
      opts.model && TRANSCRIBE_MODEL_MAP[opts.model] ? opts.model : DEFAULT_TRANSCRIBE_MODEL;
    const modelId = TRANSCRIBE_MODEL_MAP[shortId];

    let audioBytes: Buffer;
    let contentType = opts.mimeType ?? 'audio/mp3';
    if (opts.base64) {
      audioBytes = Buffer.from(opts.base64, 'base64');
    } else {
      // SSRF-guarded: safeFetch validates + DNS-pins before connecting and
      // refuses redirects outright (closes the redirect-based bypass a plain
      // fetch(url, {redirect:'follow'}) would allow — Lab audit finding #2).
      const res = await safeFetch(opts.url!, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`Failed to fetch audio: HTTP ${res.status}`);
      audioBytes = Buffer.from(await res.arrayBuffer());
      contentType = geminiAudioMime(res.headers.get('content-type') ?? contentType);
    }

    const GEMINI_MAX_INLINE_BYTES = 18 * 1024 * 1024; // Gemini's ~20MB request cap, with margin
    if (audioBytes.byteLength > GEMINI_MAX_INLINE_BYTES) {
      throw new Error(
        `Audio too large for Gemini inline transcription (${(audioBytes.byteLength / 1024 / 1024).toFixed(1)} MB > 18 MB).`
      );
    }

    const langHint = opts.language
      ? ` The spoken language is "${opts.language}"; transcribe in that language.`
      : '';
    const prompt =
      'Transcribe the attached audio verbatim into time-aligned segments.' +
      langHint +
      ' Break at natural sentence boundaries. For each segment give "start" and "end" as SECOND' +
      ' offsets from the start of the audio, and "text" as the spoken words. Return only the' +
      ' structured segments, no commentary.';

    const res = await fetch(
      `${GEMINI_REST}/models/${encodeURIComponent(modelId)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { inline_data: { mime_type: contentType, data: audioBytes.toString('base64') } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  start: { type: 'NUMBER' },
                  end: { type: 'NUMBER' },
                  text: { type: 'STRING' },
                },
                required: ['start', 'end', 'text'],
              },
            },
          },
        }),
        signal: AbortSignal.timeout(300_000),
      }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Gemini ASR ${res.status}: ${redactSecrets(err).slice(0, 500)}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
    };
    if (data.promptFeedback?.blockReason) {
      throw new Error(`Gemini blocked the audio: ${data.promptFeedback.blockReason}`);
    }
    const rawText = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const segments = parseTranscriptSegments(rawText);
    return {
      text: segments.map((s) => s.text).join(' '),
      language: opts.language,
      segments,
      raw: data,
    };
  }

  // ── Web Search — disabled ─────────────────────────────────────────────
  // Z.AI's Web Search tool has no direct Google equivalent key; Gemini's
  // "grounding with Google Search" returns results embedded in a model
  // response rather than a raw results list, and isn't wired up yet.
  // Left as a clear, typed failure rather than silently returning an
  // empty list — see the /lab/zai Search tab, which is disabled to match.

  async webSearch(_opts: ZaiWebSearchOptions): Promise<ZaiWebSearchResult> {
    throw new Error(
      "Web search is temporarily unavailable — the Lab no longer uses Z.AI, and Google Search grounding isn't wired up yet."
    );
  }

  // ── Web Reader (local extraction, SSRF-hardened) ─────────────────────

  async webReader(opts: ZaiWebReaderOptions): Promise<ZaiWebReaderResult> {
    // SSRF-guarded: rejects private/loopback/link-local/cloud-metadata
    // targets and refuses to follow redirects (closes the redirect-based
    // bypass a plain fetch(url, {redirect:'follow'}) would allow — this was
    // the critical finding in the Lab feature audit, 2026-08-23).
    const response = await safeFetch(opts.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LOAR-WebReader/1.0; +https://loar.fun)',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(15_000),
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

export const zaiService = new ZaiServiceImpl();
export type ZaiService = typeof zaiService;
