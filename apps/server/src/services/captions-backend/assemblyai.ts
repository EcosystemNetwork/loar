/**
 * AssemblyAI Universal-2 backend.
 *
 * - Word-level timestamps via forced alignment (more accurate than
 *   Whisper's heuristic cross-attention timings).
 * - Speaker diarization in the same call via `speaker_labels: true`.
 * - Same-call translation via `language_detection: true` + a
 *   `translation` block (auto-translate to target languages).
 *
 * API flow:
 *   1. POST /v2/transcript with `{ audio_url, ...features }`.
 *   2. Poll GET /v2/transcript/{id} until `status` is `completed` or `error`.
 *   3. Map AAI's word/utterance arrays to our `CaptionSegment[]`.
 *
 * Polling cadence: 3s with a 60-attempt cap (~3 minutes). Long audio
 * (>1hr) may need the cap raised — caller responsibility.
 */
import type { CaptionSegment, CaptionWord } from '../../lib/captions-format';
import type { CaptionBackend, CaptionBackendInput, CaptionBackendResult } from './types';

const AAI_BASE = 'https://api.assemblyai.com/v2';
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_ATTEMPTS = 60;

interface AAIWord {
  text: string;
  start: number; // ms
  end: number;
  confidence: number;
  speaker?: string | null;
}

interface AAIUtterance {
  text: string;
  start: number; // ms
  end: number;
  speaker: string;
  words: AAIWord[];
}

interface AAITranscript {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  text?: string;
  words?: AAIWord[];
  utterances?: AAIUtterance[] | null;
  language_code?: string;
  error?: string;
}

function msToSec(ms: number): number {
  return Math.round(ms) / 1000;
}

function utteranceToSegment(u: AAIUtterance): CaptionSegment {
  const words: CaptionWord[] = u.words.map((w) => ({
    start: msToSec(w.start),
    end: msToSec(w.end),
    text: w.text,
  }));
  return {
    start: msToSec(u.start),
    end: msToSec(u.end),
    text: u.text,
    speaker: u.speaker,
    words,
  };
}

function wordsToSegments(words: AAIWord[]): CaptionSegment[] {
  // No utterances (diarization off) — group words into ~10-word cues
  // bounded by punctuation, same heuristic as the transcription service.
  if (words.length === 0) return [];
  const segs: CaptionSegment[] = [];
  let buf: AAIWord[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    const first = buf[0];
    const last = buf[buf.length - 1];
    segs.push({
      start: msToSec(first.start),
      end: msToSec(last.end),
      text: buf.map((w) => w.text).join(' '),
      speaker: null,
      words: buf.map((w) => ({
        start: msToSec(w.start),
        end: msToSec(w.end),
        text: w.text,
      })),
    });
    buf = [];
  };
  for (const w of words) {
    buf.push(w);
    if (buf.length >= 14 || /[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return segs;
}

export const assemblyAIBackend: CaptionBackend = {
  modelId: 'universal-2-assemblyai',
  provider: 'assemblyai',
  async transcribe(input: CaptionBackendInput): Promise<CaptionBackendResult> {
    const body: Record<string, unknown> = {
      audio_url: input.audioUrl,
      speech_model: 'universal-2',
      punctuate: true,
      format_text: true,
    };
    if (input.language) body.language_code = input.language;
    else body.language_detection = true;
    if (input.diarize) {
      body.speaker_labels = true;
      if (input.numSpeakers) body.speakers_expected = input.numSpeakers;
    }
    // Word-level timings are on by default for Universal-2.

    let create: Response;
    try {
      create = await fetch(`${AAI_BASE}/transcript`, {
        method: 'POST',
        headers: {
          Authorization: input.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      return {
        status: 'failed',
        hasWordTimings: false,
        hasSpeakers: false,
        error: `AssemblyAI submission failed: ${err instanceof Error ? err.message : 'network error'}`,
      };
    }
    if (!create.ok) {
      const errText = await create.text().catch(() => '');
      return {
        status: 'failed',
        hasWordTimings: false,
        hasSpeakers: false,
        error: `AssemblyAI submission rejected (${create.status}): ${errText.slice(0, 200)}`,
      };
    }
    const created = (await create.json()) as AAITranscript;

    // Poll for completion.
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const pollRes = await fetch(`${AAI_BASE}/transcript/${created.id}`, {
        headers: { Authorization: input.apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!pollRes.ok) continue;
      const t = (await pollRes.json()) as AAITranscript;
      if (t.status === 'completed') {
        const segments =
          t.utterances && t.utterances.length > 0
            ? t.utterances.map(utteranceToSegment)
            : wordsToSegments(t.words ?? []);
        return {
          status: 'completed',
          text: t.text,
          segments,
          language: t.language_code,
          hasWordTimings: (t.words?.length ?? 0) > 0,
          hasSpeakers: !!(t.utterances && t.utterances.length > 0),
        };
      }
      if (t.status === 'error') {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `AssemblyAI: ${t.error ?? 'unknown error'}`,
        };
      }
    }

    return {
      status: 'failed',
      hasWordTimings: false,
      hasSpeakers: false,
      error: 'AssemblyAI: polling exceeded 3 minutes — try shorter audio',
    };
  },
};
