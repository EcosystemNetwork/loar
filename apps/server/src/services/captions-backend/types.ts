/**
 * Unified caption backend interface. Every provider — FAL Whisper,
 * AssemblyAI, Deepgram, Groq — implements `CaptionBackend.transcribe`
 * and returns the same `CaptionBackendResult` shape, regardless of how
 * differently they expose word-timings / diarization / translation.
 *
 * Where a backend doesn't support a requested capability, it returns
 * the call with the capability flag set false in the result — callers
 * decide whether to upgrade the model or accept the degraded output.
 */
import type { CaptionSegment } from '../../lib/captions-format';

export interface CaptionBackendInput {
  audioUrl: string;
  /** Plaintext API key resolved by the BYOK dispatcher or server pool. */
  apiKey: string;
  /** ISO-639-1, e.g. 'en'. Some backends auto-detect when omitted. */
  language?: string;
  wordTimings?: boolean;
  diarize?: boolean;
  /** Soft hint to the diarizer. */
  numSpeakers?: number;
  /**
   * If set, return an additional translated segment array under
   * `translatedSegments[lang]`. Backends that don't support same-call
   * translation return without populating it (the caller falls through
   * to the Gemini translation pipeline downstream).
   */
  translateTo?: string[];
}

export interface CaptionBackendResult {
  status: 'completed' | 'failed';
  text?: string;
  segments?: CaptionSegment[];
  /** Auto-detected language code, if the backend reports it. */
  language?: string;
  hasWordTimings: boolean;
  hasSpeakers: boolean;
  /** Optional same-call translations, keyed by ISO-639-1. */
  translatedSegments?: Record<string, CaptionSegment[]>;
  error?: string;
}

export interface CaptionBackend {
  /** Stable identifier — matches `transcription-models` registry id. */
  modelId: string;
  /** Provider that hosts the model (matches provider-keys ProviderId). */
  provider: string;
  transcribe(input: CaptionBackendInput): Promise<CaptionBackendResult>;
}
