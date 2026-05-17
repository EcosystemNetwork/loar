/**
 * Caption backend dispatcher.
 *
 * Maps a transcription-models registry id → the backend implementation.
 * Returns the singleton backend instance; caller resolves the API key
 * via the provider-keys dispatcher before calling `backend.transcribe`.
 *
 * Adding a new model: register it in `transcription-models/registry.ts`,
 * implement the backend in this directory, and add a case below.
 */
import { TRPCError } from '@trpc/server';
import type { CaptionBackend } from './types';
import { falWhisperBackend } from './fal-whisper';
import { assemblyAIBackend } from './assemblyai';
import { deepgramBackend } from './deepgram';
import { groqBackend } from './groq';

const BACKENDS: Record<string, CaptionBackend> = {
  [falWhisperBackend.modelId]: falWhisperBackend,
  [assemblyAIBackend.modelId]: assemblyAIBackend,
  [deepgramBackend.modelId]: deepgramBackend,
  [groqBackend.modelId]: groqBackend,
};

export function getBackend(modelId: string): CaptionBackend {
  const b = BACKENDS[modelId];
  if (!b) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `No caption backend registered for model: ${modelId}`,
    });
  }
  return b;
}

export function listBackendIds(): string[] {
  return Object.keys(BACKENDS);
}
