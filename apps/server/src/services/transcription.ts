/**
 * Transcription / Auto-Captions Service
 *
 * Uses FAL.ai's Whisper model for audio transcription and translation.
 * Returns timestamped segments suitable for SRT/VTT caption generation.
 *
 * Optional capabilities:
 *   - wordTimings: request `chunk_level: 'word'` so each segment carries
 *     per-word start/end timestamps (used for karaoke-style highlighting
 *     and tighter cue retiming).
 *   - diarize: request speaker diarization. Each word/segment is tagged
 *     with a speaker id ("SPEAKER_00", "SPEAKER_01", ...).
 *
 * When word-level chunks are requested, words are grouped back into
 * segments locally using speaker changes, sentence-ending punctuation,
 * pauses (>1s), or a hard word-count cap. This keeps the segment-based
 * editor surface (`CaptionsPanel`) usable while still preserving the
 * word grid underneath.
 */
import * as fal from '@fal-ai/serverless-client';

// ── Types ────────────────────────────────────────────────────────────

export interface TranscriptionOptions {
  audioUrl: string;
  language?: string; // ISO 639-1 code, default 'en'
  task?: 'transcribe' | 'translate';
  /** Request per-word start/end timestamps. */
  wordTimings?: boolean;
  /** Request speaker diarization. */
  diarize?: boolean;
  /** Optional hint to the diarizer about the expected number of speakers. */
  numSpeakers?: number;
}

export interface TranscriptionWord {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionSegment {
  start: number; // seconds
  end: number;
  text: string;
  /** Diarized speaker label (e.g. "SPEAKER_00") if available. */
  speaker?: string | null;
  /** Per-word timestamps if requested via `wordTimings`. */
  words?: TranscriptionWord[];
}

export interface TranscriptionResult {
  status: 'completed' | 'failed';
  text?: string;
  segments?: TranscriptionSegment[];
  language?: string;
  /** True if the returned segments carry per-word timings. */
  hasWordTimings?: boolean;
  /** True if the returned segments carry speaker labels. */
  hasSpeakers?: boolean;
  error?: string;
}

// Grouping heuristics for converting flat word chunks back into segments.
const WORD_GROUPING = {
  /** Words longer than this force a new segment regardless of punctuation. */
  maxWordsPerSegment: 14,
  /** Pause (in seconds) between consecutive words that triggers a segment break. */
  maxGapSeconds: 1.0,
  /** Regex matching sentence-ending punctuation on the last char. */
  sentenceEndRe: /[.!?…]$/,
} as const;

// ── Service ──────────────────────────────────────────────────────────

export class TranscriptionService {
  private configured = false;

  private ensureConfigured(): void {
    if (!this.configured && process.env.FAL_KEY) {
      fal.config({ credentials: process.env.FAL_KEY });
      this.configured = true;
    }
    if (!this.configured) {
      throw new Error('FAL_KEY environment variable is required for transcription');
    }
  }

  async transcribe(options: TranscriptionOptions): Promise<TranscriptionResult> {
    this.ensureConfigured();

    const wantsWords = !!options.wordTimings;
    const wantsSpeakers = !!options.diarize;

    try {
      const input: Record<string, unknown> = {
        audio_url: options.audioUrl,
        task: options.task || 'transcribe',
        language: options.language || 'en',
      };
      if (wantsWords || wantsSpeakers) {
        // Word-level chunks let us populate `words[]` and react to speaker
        // changes mid-utterance. Segment-level can't do either reliably.
        input.chunk_level = 'word';
      }
      if (wantsSpeakers) {
        input.diarize = true;
        if (options.numSpeakers && options.numSpeakers > 0) {
          input.num_speakers = options.numSpeakers;
        }
      }

      const result = await fal.subscribe('fal-ai/whisper', {
        input,
        logs: true,
      });

      const resultAny = result as any;
      const data = resultAny.data || resultAny;

      const text: string | undefined = data.text || data.transcription;
      const rawChunks = data.segments || data.chunks;

      let segments: TranscriptionSegment[] | undefined;
      let producedWords = false;
      let producedSpeakers = false;

      if (Array.isArray(rawChunks) && rawChunks.length > 0) {
        if (wantsWords || wantsSpeakers) {
          const words = rawChunks
            .map((c: any) => extractWord(c))
            .filter((w): w is WordWithSpeaker => w !== null);
          producedWords = words.some((w) => w.end > w.start);
          producedSpeakers = words.some((w) => !!w.speaker);
          segments = groupWordsIntoSegments(words, wantsWords);
        } else {
          segments = rawChunks.map((seg: any) => ({
            start: seg.start ?? seg.timestamp?.[0] ?? 0,
            end: seg.end ?? seg.timestamp?.[1] ?? 0,
            text: (seg.text || '').trim(),
          }));
        }
      }

      const language: string | undefined =
        data.language || data.detected_language || options.language;

      if (!text && (!segments || segments.length === 0)) {
        return {
          status: 'failed',
          error: `No transcription returned. Response keys: ${Object.keys(data).join(', ')}`,
        };
      }

      return {
        status: 'completed',
        text: text || segments?.map((s) => s.text).join(' '),
        segments,
        language,
        hasWordTimings: wantsWords && producedWords,
        hasSpeakers: wantsSpeakers && producedSpeakers,
      };
    } catch (error) {
      console.error('Transcription failed:', error);
      return {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Transcription failed',
      };
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

interface WordWithSpeaker extends TranscriptionWord {
  speaker: string | null;
}

function extractWord(c: any): WordWithSpeaker | null {
  if (!c) return null;
  const start = c.start ?? c.timestamp?.[0] ?? null;
  const end = c.end ?? c.timestamp?.[1] ?? null;
  const text = typeof c.text === 'string' ? c.text.trim() : '';
  if (start === null || end === null || !text) return null;
  return {
    start: Number(start),
    end: Number(end),
    text,
    speaker: typeof c.speaker === 'string' && c.speaker.length > 0 ? c.speaker : null,
  };
}

function groupWordsIntoSegments(
  words: WordWithSpeaker[],
  keepWords: boolean
): TranscriptionSegment[] {
  if (words.length === 0) return [];
  const out: TranscriptionSegment[] = [];
  let cur: WordWithSpeaker[] = [];

  const flush = () => {
    if (cur.length === 0) return;
    const first = cur[0];
    const last = cur[cur.length - 1];
    const seg: TranscriptionSegment = {
      start: first.start,
      end: last.end,
      text: cur
        .map((w) => w.text)
        .join(' ')
        .replace(/\s+([,.!?…;:])/g, '$1'),
      speaker: first.speaker,
    };
    if (keepWords) {
      seg.words = cur.map(({ start, end, text }) => ({ start, end, text }));
    }
    out.push(seg);
    cur = [];
  };

  for (const w of words) {
    const last = cur[cur.length - 1];
    const speakerChanged = last && (last.speaker ?? null) !== (w.speaker ?? null);
    const tooLong = cur.length >= WORD_GROUPING.maxWordsPerSegment;
    const longPause = last && w.start - last.end >= WORD_GROUPING.maxGapSeconds;
    const sentenceEnded = last && WORD_GROUPING.sentenceEndRe.test(last.text);

    if (speakerChanged || tooLong || longPause || sentenceEnded) {
      flush();
    }
    cur.push(w);
  }
  flush();
  return out;
}

export const transcriptionService = new TranscriptionService();
