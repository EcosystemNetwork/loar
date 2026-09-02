/**
 * Google Gemini transcription backend.
 *
 * Unlike the dedicated ASR providers (Whisper, AssemblyAI, Deepgram), Gemini
 * has no transcription endpoint — we use multimodal `generateContent` with the
 * audio inlined as base64 and a structured `responseSchema` that forces the
 * model to emit segment-level captions ({ start, end, text, speaker }).
 *
 * Capabilities:
 *   - Segment-level timestamps (not word-level — Gemini word timing is
 *     unreliable, so `hasWordTimings` is always false).
 *   - Speaker diarization via prompt when `diarize` is requested (best-effort;
 *     Gemini labels speakers as "Speaker 1", "Speaker 2", …).
 *
 * Several registry rows share this one implementation via `buildBackend`,
 * differing only by the Gemini model id (flash / pro / flash-lite / 3.1).
 *
 * Endpoint: POST /v1beta/models/{model}:generateContent (x-goog-api-key auth).
 * Inline payload cap mirrors the Gemini ~20 MB request ceiling — larger audio
 * should be chunked upstream or routed to a streaming ASR backend.
 */
import type { CaptionSegment } from '../../lib/captions-format';
import type { CaptionBackend, CaptionBackendInput, CaptionBackendResult } from './types';
import { safeFetch } from '../../lib/url-validator';
import { redactSecrets } from '../../lib/redact-secrets';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
// Gemini caps an inline-data request at ~20 MB total; stay under it with margin.
const GEMINI_MAX_INLINE_BYTES = 18 * 1024 * 1024;

/** Normalize a fetched content-type to a mime Gemini accepts for audio/video. */
function geminiMimeFor(contentType: string): string {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  // Gemini wants `audio/mp3`, not the `audio/mpeg` most servers send.
  if (ct === 'audio/mpeg') return 'audio/mp3';
  if (ct.startsWith('audio/') || ct.startsWith('video/')) return ct;
  return 'audio/mp3';
}

interface GeminiSegment {
  start?: number;
  end?: number;
  text?: string;
  speaker?: string;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

function parseSegments(rawText: string): GeminiSegment[] {
  // responseSchema yields a clean JSON array, but be defensive: strip any
  // markdown fences and slice to the outermost array if the model wraps it.
  let body = rawText.trim();
  if (body.startsWith('```')) {
    body = body
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim();
  }
  const first = body.indexOf('[');
  const last = body.lastIndexOf(']');
  if (first !== -1 && last !== -1 && last > first) {
    body = body.slice(first, last + 1);
  }
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? (parsed as GeminiSegment[]) : [];
  } catch {
    return [];
  }
}

function toCaptionSegments(raw: GeminiSegment[]): CaptionSegment[] {
  return raw
    .filter((s) => typeof s.text === 'string' && s.text.trim().length > 0)
    .map((s) => {
      const start = Number.isFinite(s.start) ? Math.max(0, s.start as number) : 0;
      const end = Number.isFinite(s.end) ? Math.max(start, s.end as number) : start;
      const speaker = typeof s.speaker === 'string' && s.speaker.trim() ? s.speaker.trim() : null;
      return { start, end, text: (s.text as string).trim(), speaker };
    });
}

interface GeminiBackendSpec {
  /** Caption-backend id (matches transcription-models registry id). */
  modelId: string;
  /** Gemini model id sent in the URL path. */
  geminiModelId: string;
}

function buildBackend(spec: GeminiBackendSpec): CaptionBackend {
  return {
    modelId: spec.modelId,
    provider: 'google',
    async transcribe(input: CaptionBackendInput): Promise<CaptionBackendResult> {
      // ── Fetch audio (SSRF-guarded) and inline as base64 ──────────────
      let audioBuf: ArrayBuffer;
      let mimeType: string;
      try {
        // safeFetch: SSRF validation + IP pinning (no DNS-rebinding window).
        const audioRes = await safeFetch(input.audioUrl, { signal: AbortSignal.timeout(120_000) });
        if (!audioRes.ok) {
          return {
            status: 'failed',
            hasWordTimings: false,
            hasSpeakers: false,
            error: `Audio fetch failed (${audioRes.status})`,
          };
        }
        mimeType = geminiMimeFor(audioRes.headers.get('content-type') ?? 'audio/mpeg');
        audioBuf = await audioRes.arrayBuffer();
      } catch (err) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Audio fetch failed: ${err instanceof Error ? err.message : 'network error'}`,
        };
      }
      if (audioBuf.byteLength > GEMINI_MAX_INLINE_BYTES) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Audio too large for Gemini inline transcription (${(audioBuf.byteLength / 1024 / 1024).toFixed(1)} MB > 18 MB). Use a Whisper/Deepgram backend for long files.`,
        };
      }

      const diarizeHint = input.diarize
        ? ' Identify distinct speakers and set "speaker" to a stable label like "Speaker 1", "Speaker 2".'
        : '';
      const langHint = input.language
        ? ` The spoken language is "${input.language}"; transcribe in that language.`
        : '';
      const prompt =
        'Transcribe the attached audio verbatim into time-aligned caption segments.' +
        langHint +
        ' Break the transcript at natural phrase or sentence boundaries (aim for roughly one short sentence per segment).' +
        ' For each segment provide "start" and "end" as offsets in SECONDS from the beginning of the audio (numbers, decimals allowed) and "text" as the spoken words.' +
        diarizeHint +
        ' Return only the structured segments, no commentary.';

      const body = {
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType, data: Buffer.from(audioBuf).toString('base64') } },
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
                speaker: { type: 'STRING' },
              },
              required: ['start', 'end', 'text'],
            },
          },
        },
      };

      let res: Response;
      try {
        res = await fetch(
          `${GEMINI_BASE}/${encodeURIComponent(spec.geminiModelId)}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(300_000),
          }
        );
      } catch (err) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Gemini request failed: ${err instanceof Error ? err.message : 'network error'}`,
        };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Gemini rejected (${res.status}): ${redactSecrets(text).slice(0, 200)}`,
        };
      }

      const json = (await res.json()) as GeminiGenerateResponse;
      if (json.error) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Gemini error: ${json.error.message ?? 'unknown'}`,
        };
      }
      if (json.promptFeedback?.blockReason) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Gemini blocked the request: ${json.promptFeedback.blockReason}`,
        };
      }

      const rawText = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      const segments = toCaptionSegments(parseSegments(rawText));
      if (segments.length === 0) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: 'Gemini returned no caption segments',
        };
      }

      const hasSpeakers = segments.some((s) => !!s.speaker);
      return {
        status: 'completed',
        text: segments.map((s) => s.text).join(' '),
        segments,
        language: input.language,
        hasWordTimings: false,
        hasSpeakers,
      };
    },
  };
}

export const geminiFlashTranscribeBackend = buildBackend({
  modelId: 'gemini-2-5-flash-transcribe-google',
  geminiModelId: 'gemini-2.5-flash',
});

export const geminiProTranscribeBackend = buildBackend({
  modelId: 'gemini-2-5-pro-transcribe-google',
  geminiModelId: 'gemini-2.5-pro',
});

export const geminiFlashLiteTranscribeBackend = buildBackend({
  modelId: 'gemini-2-5-flash-lite-transcribe-google',
  geminiModelId: 'gemini-2.5-flash-lite',
});

export const gemini31ProTranscribeBackend = buildBackend({
  modelId: 'gemini-3-1-pro-transcribe-google',
  geminiModelId: 'gemini-3.1-pro-preview',
});
