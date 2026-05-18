/**
 * OpenAI transcription backends.
 *
 * Three sibling registry rows share the OpenAI Audio API:
 *   - gpt-4o-transcribe-openai        → `gpt-4o-transcribe`
 *   - gpt-4o-mini-transcribe-openai   → `gpt-4o-mini-transcribe`
 *   - gpt-4o-transcribe-diarize-openai → `gpt-4o-transcribe-diarize`
 *   - whisper-1-openai                 → `whisper-1` (legacy)
 *
 * Endpoint: POST /v1/audio/transcriptions (multipart).
 * Diarize variant unlocks speaker labels — closes the "no diarization" gap
 * in Voice Studio Captions.
 *
 * Max payload: ~25 MB per request (Whisper inheritance). Longer audio
 * should chunk upstream.
 */
import type { CaptionSegment, CaptionWord } from '../../lib/captions-format';
import type { CaptionBackend, CaptionBackendInput, CaptionBackendResult } from './types';
import { validateUploadUrl } from '../../lib/url-validator';
import { redactSecrets } from '../../lib/redact-secrets';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_MAX_BYTES = 25 * 1024 * 1024;

interface OpenAIWord {
  word: string;
  start: number;
  end: number;
  speaker?: string;
}

interface OpenAISegment {
  id: number;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

interface OpenAITranscribeResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: OpenAISegment[];
  words?: OpenAIWord[];
  error?: { message?: string };
}

function toCaptionSegments(segments: OpenAISegment[], words: OpenAIWord[]): CaptionSegment[] {
  if (segments.length === 0 && words.length === 0) return [];
  if (segments.length > 0) {
    return segments.map((seg) => {
      const segWords = words.filter((w) => {
        const mid = (w.start + w.end) / 2;
        return mid >= seg.start && mid <= seg.end;
      });
      const captionWords: CaptionWord[] = segWords.map((w) => ({
        start: w.start,
        end: w.end,
        text: w.word,
      }));
      return {
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
        speaker: seg.speaker ?? null,
        words: captionWords.length > 0 ? captionWords : undefined,
      };
    });
  }
  // Words only — group by 14-word cap + punctuation + speaker boundary.
  const out: CaptionSegment[] = [];
  let buf: OpenAIWord[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    out.push({
      start: buf[0].start,
      end: buf[buf.length - 1].end,
      text: buf.map((w) => w.word).join(' '),
      speaker: buf[0].speaker ?? null,
      words: buf.map((w) => ({ start: w.start, end: w.end, text: w.word })),
    });
    buf = [];
  };
  for (const w of words) {
    if (buf.length > 0 && buf[buf.length - 1].speaker !== w.speaker) flush();
    buf.push(w);
    if (buf.length >= 14 || /[.!?…]$/.test(w.word)) flush();
  }
  flush();
  return out;
}

interface OpenAIModelSpec {
  /** Caption-backend id (registry id). */
  modelId: string;
  /** Value to send as the `model` form field. */
  openaiModelId: string;
  diarize: boolean;
}

function buildBackend(spec: OpenAIModelSpec): CaptionBackend {
  return {
    modelId: spec.modelId,
    provider: 'openai',
    async transcribe(input: CaptionBackendInput): Promise<CaptionBackendResult> {
      let audioBuf: ArrayBuffer;
      let mimeType: string;
      try {
        // SSRF guard before server-side audio fetch.
        await validateUploadUrl(input.audioUrl);
        const audioRes = await fetch(input.audioUrl, { signal: AbortSignal.timeout(120_000) });
        if (!audioRes.ok) {
          return {
            status: 'failed',
            hasWordTimings: false,
            hasSpeakers: false,
            error: `Audio fetch failed (${audioRes.status})`,
          };
        }
        mimeType = audioRes.headers.get('content-type') ?? 'audio/mpeg';
        audioBuf = await audioRes.arrayBuffer();
      } catch (err) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Audio fetch failed: ${err instanceof Error ? err.message : 'network error'}`,
        };
      }
      if (audioBuf.byteLength > OPENAI_MAX_BYTES) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Audio too large for OpenAI (${(audioBuf.byteLength / 1024 / 1024).toFixed(1)} MB > 25 MB). Use a different backend.`,
        };
      }

      const form = new FormData();
      form.append('file', new Blob([audioBuf], { type: mimeType }), 'audio');
      form.append('model', spec.openaiModelId);
      if (spec.diarize) {
        // The diarize model rejects verbose_json + timestamp_granularities
        // and uses chunking_strategy for audio >30s. Speaker labels arrive
        // on segments/words by default; no per-call flag needed.
        form.append('response_format', 'json');
        form.append('chunking_strategy', 'auto');
        if (input.language) form.append('language', input.language);
      } else {
        form.append('response_format', 'verbose_json');
        form.append('timestamp_granularities[]', 'word');
        form.append('timestamp_granularities[]', 'segment');
        if (input.language) form.append('language', input.language);
      }

      let res: Response;
      try {
        res = await fetch(OPENAI_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${input.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(240_000),
        });
      } catch (err) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `OpenAI request failed: ${err instanceof Error ? err.message : 'network error'}`,
        };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `OpenAI rejected (${res.status}): ${redactSecrets(text).slice(0, 200)}`,
        };
      }

      const json = (await res.json()) as OpenAITranscribeResponse;
      if (json.error) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `OpenAI error: ${json.error.message ?? 'unknown'}`,
        };
      }
      const segments = toCaptionSegments(json.segments ?? [], json.words ?? []);
      const hasSpeakers =
        spec.diarize &&
        ((json.segments?.some((s) => s.speaker) ?? false) ||
          (json.words?.some((w) => w.speaker) ?? false));
      return {
        status: 'completed',
        text: json.text,
        segments,
        language: json.language,
        hasWordTimings: (json.words?.length ?? 0) > 0,
        hasSpeakers,
      };
    },
  };
}

export const openaiGpt4oTranscribeBackend = buildBackend({
  modelId: 'gpt-4o-transcribe-openai',
  openaiModelId: 'gpt-4o-transcribe',
  diarize: false,
});

export const openaiGpt4oMiniTranscribeBackend = buildBackend({
  modelId: 'gpt-4o-mini-transcribe-openai',
  openaiModelId: 'gpt-4o-mini-transcribe',
  diarize: false,
});

export const openaiGpt4oTranscribeDiarizeBackend = buildBackend({
  modelId: 'gpt-4o-transcribe-diarize-openai',
  openaiModelId: 'gpt-4o-transcribe-diarize',
  diarize: true,
});

export const openaiWhisper1Backend = buildBackend({
  modelId: 'whisper-1-openai',
  openaiModelId: 'whisper-1',
  diarize: false,
});
