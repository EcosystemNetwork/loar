/**
 * FAL Whisper backend (basic, segment-level).
 *
 * Wraps the existing `transcriptionService` so we don't fork two FAL
 * call paths. Word-timings and diarization are not supported via this
 * backend (the underlying service returns segment-level only); the
 * result flags say so honestly.
 */
import { transcriptionService } from '../transcription';
import type { CaptionBackend, CaptionBackendInput, CaptionBackendResult } from './types';

export const falWhisperBackend: CaptionBackend = {
  modelId: 'whisper-fal',
  provider: 'fal',
  async transcribe(input: CaptionBackendInput): Promise<CaptionBackendResult> {
    const result = await transcriptionService.transcribe({
      audioUrl: input.audioUrl,
      language: input.language,
      apiKey: input.apiKey,
    });
    if (result.status === 'failed') {
      return {
        status: 'failed',
        hasWordTimings: false,
        hasSpeakers: false,
        error: result.error,
      };
    }
    return {
      status: 'completed',
      text: result.text,
      segments: result.segments?.map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
        speaker: null,
      })),
      language: result.language,
      hasWordTimings: false,
      hasSpeakers: false,
    };
  },
};
