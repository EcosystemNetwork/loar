/**
 * Groq Whisper-large-v3 backend.
 *
 * Fast (~3–4x realtime), cheap, OpenAI-compatible Whisper API. Returns
 * verbose-JSON with segment + word arrays. No diarization. Word-level
 * timestamps via `timestamp_granularities[]=word`.
 *
 * Endpoint: POST /openai/v1/audio/transcriptions (multipart form-data).
 *
 * Note: Groq's transcription endpoint requires the file to be uploaded
 * as multipart, not a URL. We fetch the audio server-side, stream it
 * into a Blob, and forward it. For very long audio this is memory-heavy;
 * 25MB is the Groq upper limit per request and we surface a clean error
 * past that threshold.
 */
import type { CaptionSegment, CaptionWord } from '../../lib/captions-format';
import type { CaptionBackend, CaptionBackendInput, CaptionBackendResult } from './types';
import { redactSecrets } from '../../lib/redact-secrets';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MAX_BYTES = 25 * 1024 * 1024;

interface GroqWord {
  word: string;
  start: number;
  end: number;
}

interface GroqSegment {
  id: number;
  start: number;
  end: number;
  text: string;
}

interface GroqResponse {
  text?: string;
  language?: string;
  segments?: GroqSegment[];
  words?: GroqWord[];
  error?: { message?: string };
}

function chunkWordsIntoSegments(
  words: GroqWord[],
  fallbackSegments: GroqSegment[] = []
): CaptionSegment[] {
  if (words.length === 0) {
    return fallbackSegments.map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text.trim(),
      speaker: null,
    }));
  }
  // If we have both, glue words onto Whisper's natural segments. Words
  // whose midpoint falls inside a segment's time range belong to that
  // segment.
  if (fallbackSegments.length > 0) {
    return fallbackSegments.map((seg) => {
      const w = words.filter((word) => {
        const mid = (word.start + word.end) / 2;
        return mid >= seg.start && mid <= seg.end;
      });
      const captionWords: CaptionWord[] = w.map((x) => ({
        start: x.start,
        end: x.end,
        text: x.word,
      }));
      return {
        start: seg.start,
        end: seg.end,
        text: seg.text.trim(),
        speaker: null,
        words: captionWords.length > 0 ? captionWords : undefined,
      };
    });
  }
  // Just words — group by punctuation / 14-word cap.
  const out: CaptionSegment[] = [];
  let buf: GroqWord[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    out.push({
      start: buf[0].start,
      end: buf[buf.length - 1].end,
      text: buf.map((w) => w.word).join(' '),
      speaker: null,
      words: buf.map((w) => ({ start: w.start, end: w.end, text: w.word })),
    });
    buf = [];
  };
  for (const w of words) {
    buf.push(w);
    if (buf.length >= 14 || /[.!?…]$/.test(w.word)) flush();
  }
  flush();
  return out;
}

function buildGroqBackend(modelId: string, groqModel: string): CaptionBackend {
  return {
    modelId,
    provider: 'groq',
    async transcribe(input: CaptionBackendInput): Promise<CaptionBackendResult> {
      let audioBuf: ArrayBuffer;
      let mimeType: string;
      try {
        const audioRes = await fetch(input.audioUrl, {
          signal: AbortSignal.timeout(120_000),
        });
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
      if (audioBuf.byteLength > GROQ_MAX_BYTES) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Audio too large for Groq (${(audioBuf.byteLength / 1024 / 1024).toFixed(1)} MB > 25 MB). Pick a different backend.`,
        };
      }

      const form = new FormData();
      form.append('file', new Blob([audioBuf], { type: mimeType }), 'audio');
      form.append('model', groqModel);
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      form.append('timestamp_granularities[]', 'segment');
      if (input.language) form.append('language', input.language);

      let res: Response;
      try {
        res = await fetch(GROQ_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${input.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(180_000),
        });
      } catch (err) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Groq request failed: ${err instanceof Error ? err.message : 'network error'}`,
        };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Groq rejected (${res.status}): ${redactSecrets(text).slice(0, 200)}`,
        };
      }

      const json = (await res.json()) as GroqResponse;
      if (json.error) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Groq error: ${json.error.message ?? 'unknown'}`,
        };
      }
      const segments = chunkWordsIntoSegments(json.words ?? [], json.segments ?? []);
      return {
        status: 'completed',
        text: json.text,
        segments,
        language: json.language,
        hasWordTimings: (json.words?.length ?? 0) > 0,
        hasSpeakers: false,
      };
    },
  };
}

export const groqBackend = buildGroqBackend('whisper-large-v3-groq', 'whisper-large-v3');
export const groqWhisperTurboBackend = buildGroqBackend(
  'whisper-large-v3-turbo-groq',
  'whisper-large-v3-turbo'
);
export const groqDistilWhisperBackend = buildGroqBackend(
  'distil-whisper-large-v3-en-groq',
  'distil-whisper-large-v3-en'
);
