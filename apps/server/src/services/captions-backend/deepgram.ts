/**
 * Deepgram Nova-3 backend.
 *
 * Synchronous prerecorded transcription. Native word-level timestamps,
 * native diarization via `diarize=true`. No same-call translation.
 *
 * Endpoint: POST /v1/listen?model=nova-3&...
 * Body:    { url: <audioUrl> } as JSON (when sending a remote URL).
 */
import type { CaptionSegment, CaptionWord } from '../../lib/captions-format';
import type { CaptionBackend, CaptionBackendInput, CaptionBackendResult } from './types';
import { redactSecrets } from '../../lib/redact-secrets';

const DG_BASE = 'https://api.deepgram.com/v1/listen';

interface DGWord {
  word: string;
  start: number; // seconds
  end: number;
  speaker?: number;
  punctuated_word?: string;
}

interface DGUtterance {
  start: number;
  end: number;
  transcript: string;
  speaker?: number;
  words: DGWord[];
}

interface DGAlternative {
  transcript: string;
  words: DGWord[];
}

interface DGChannel {
  alternatives: DGAlternative[];
}

interface DGResults {
  channels?: DGChannel[];
  utterances?: DGUtterance[];
  language?: string;
}

interface DGResponse {
  results?: DGResults;
  metadata?: { detected_language?: string };
  err_code?: string;
  err_msg?: string;
}

function speakerLabel(n: number | undefined): string | null {
  return typeof n === 'number' ? `SPEAKER_${String(n).padStart(2, '0')}` : null;
}

function wordsToCaptionWords(ws: DGWord[]): CaptionWord[] {
  return ws.map((w) => ({
    start: w.start,
    end: w.end,
    text: w.punctuated_word ?? w.word,
  }));
}

function utteranceToSegment(u: DGUtterance): CaptionSegment {
  return {
    start: u.start,
    end: u.end,
    text: u.transcript,
    speaker: speakerLabel(u.speaker),
    words: wordsToCaptionWords(u.words),
  };
}

function alternativeToSegments(alt: DGAlternative): CaptionSegment[] {
  // No utterances — group words by ~14-word chunks.
  const out: CaptionSegment[] = [];
  let buf: DGWord[] = [];
  const flush = () => {
    if (buf.length === 0) return;
    out.push({
      start: buf[0].start,
      end: buf[buf.length - 1].end,
      text: buf.map((w) => w.punctuated_word ?? w.word).join(' '),
      speaker: null,
      words: wordsToCaptionWords(buf),
    });
    buf = [];
  };
  for (const w of alt.words) {
    buf.push(w);
    const last = w.punctuated_word ?? w.word;
    if (buf.length >= 14 || /[.!?…]$/.test(last)) flush();
  }
  flush();
  return out;
}

function buildDeepgramBackend(modelId: string, dgModel: string): CaptionBackend {
  return {
    modelId,
    provider: 'deepgram',
    async transcribe(input: CaptionBackendInput): Promise<CaptionBackendResult> {
      const params = new URLSearchParams();
      params.set('model', dgModel);
      params.set('smart_format', 'true');
      params.set('punctuate', 'true');
      params.set('utterances', 'true');
      if (input.language) params.set('language', input.language);
      else params.set('detect_language', 'true');
      if (input.diarize) params.set('diarize', 'true');

      let res: Response;
      try {
        res = await fetch(`${DG_BASE}?${params.toString()}`, {
          method: 'POST',
          headers: {
            Authorization: `Token ${input.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: input.audioUrl }),
          signal: AbortSignal.timeout(180_000), // sync, but long audio takes time
        });
      } catch (err) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Deepgram request failed: ${err instanceof Error ? err.message : 'network error'}`,
        };
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Deepgram rejected (${res.status}): ${redactSecrets(text).slice(0, 200)}`,
        };
      }

      const json = (await res.json()) as DGResponse;
      if (json.err_code) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: `Deepgram error ${json.err_code}: ${json.err_msg ?? 'unknown'}`,
        };
      }
      const alt = json.results?.channels?.[0]?.alternatives?.[0];
      if (!alt) {
        return {
          status: 'failed',
          hasWordTimings: false,
          hasSpeakers: false,
          error: 'Deepgram returned no alternatives',
        };
      }
      const segments =
        json.results?.utterances && json.results.utterances.length > 0
          ? json.results.utterances.map(utteranceToSegment)
          : alternativeToSegments(alt);

      return {
        status: 'completed',
        text: alt.transcript,
        segments,
        language: json.results?.language ?? json.metadata?.detected_language,
        hasWordTimings: (alt.words?.length ?? 0) > 0,
        hasSpeakers: !!(
          json.results?.utterances && json.results.utterances.some((u) => u.speaker !== undefined)
        ),
      };
    },
  };
}

export const deepgramBackend = buildDeepgramBackend('nova-3-deepgram', 'nova-3');
export const deepgramNova3MedicalBackend = buildDeepgramBackend(
  'nova-3-medical-deepgram',
  'nova-3-medical'
);
export const deepgramNova3MultilingualBackend = buildDeepgramBackend(
  'nova-3-multilingual-deepgram',
  'nova-3'
);
export const deepgramNova2Backend = buildDeepgramBackend('nova-2-deepgram', 'nova-2');
export const deepgramWhisperCloudBackend = buildDeepgramBackend(
  'whisper-cloud-deepgram',
  'whisper'
);
