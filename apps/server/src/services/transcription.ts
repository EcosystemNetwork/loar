/**
 * Transcription / Auto-Captions Service
 *
 * Uses FAL.ai's Whisper model for audio transcription and translation.
 * Returns timestamped segments suitable for SRT/VTT caption generation.
 */
import * as fal from '@fal-ai/serverless-client';

// ── Types ────────────────────────────────────────────────────────────

export interface TranscriptionOptions {
  audioUrl: string;
  language?: string; // ISO 639-1 code, default 'en'
  task?: 'transcribe' | 'translate';
}

export interface TranscriptionSegment {
  start: number; // seconds
  end: number;
  text: string;
}

export interface TranscriptionResult {
  status: 'completed' | 'failed';
  text?: string;
  segments?: TranscriptionSegment[];
  language?: string;
  error?: string;
}

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

    try {
      const input: Record<string, unknown> = {
        audio_url: options.audioUrl,
        task: options.task || 'transcribe',
        language: options.language || 'en',
      };

      const result = await fal.subscribe('fal-ai/whisper', {
        input,
        logs: true,
      });

      const resultAny = result as any;
      const data = resultAny.data || resultAny;

      // Extract transcription text
      const text: string | undefined = data.text || data.transcription;

      // Extract segments
      let segments: TranscriptionSegment[] | undefined;
      const rawSegments = data.segments || data.chunks;
      if (Array.isArray(rawSegments)) {
        segments = rawSegments.map((seg: any) => ({
          start: seg.start ?? seg.timestamp?.[0] ?? 0,
          end: seg.end ?? seg.timestamp?.[1] ?? 0,
          text: (seg.text || '').trim(),
        }));
      }

      // Detected language
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

export const transcriptionService = new TranscriptionService();
