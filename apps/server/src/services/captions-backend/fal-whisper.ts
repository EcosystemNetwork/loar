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
    // The existing service reads FAL_KEY from process.env, so we don't
    // pass the resolved key through here — Phase 1 stays untouched.
    // BYOK for FAL is a Phase 3 follow-up (requires service refactor).
    const result = await transcriptionService.transcribe({
      audioUrl: input.audioUrl,
      language: input.language,
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
