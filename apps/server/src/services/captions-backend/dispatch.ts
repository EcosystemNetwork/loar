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
import { assemblyAIBackend, assemblyAISlam1Backend, assemblyAINanoBackend } from './assemblyai';
import {
  deepgramBackend,
  deepgramNova3MedicalBackend,
  deepgramNova3MultilingualBackend,
  deepgramNova2Backend,
  deepgramWhisperCloudBackend,
} from './deepgram';
import { groqBackend, groqWhisperTurboBackend, groqDistilWhisperBackend } from './groq';
import {
  openaiGpt4oTranscribeBackend,
  openaiGpt4oMiniTranscribeBackend,
  openaiGpt4oTranscribeDiarizeBackend,
  openaiWhisper1Backend,
} from './openai';
import { zaiGlmAsrBackend } from './zai';

const BACKENDS: Record<string, CaptionBackend> = {
  [falWhisperBackend.modelId]: falWhisperBackend,
  [assemblyAIBackend.modelId]: assemblyAIBackend,
  [assemblyAISlam1Backend.modelId]: assemblyAISlam1Backend,
  [assemblyAINanoBackend.modelId]: assemblyAINanoBackend,
  [deepgramBackend.modelId]: deepgramBackend,
  [deepgramNova3MedicalBackend.modelId]: deepgramNova3MedicalBackend,
  [deepgramNova3MultilingualBackend.modelId]: deepgramNova3MultilingualBackend,
  [deepgramNova2Backend.modelId]: deepgramNova2Backend,
  [deepgramWhisperCloudBackend.modelId]: deepgramWhisperCloudBackend,
  [groqBackend.modelId]: groqBackend,
  [groqWhisperTurboBackend.modelId]: groqWhisperTurboBackend,
  [groqDistilWhisperBackend.modelId]: groqDistilWhisperBackend,
  [openaiGpt4oTranscribeBackend.modelId]: openaiGpt4oTranscribeBackend,
  [openaiGpt4oMiniTranscribeBackend.modelId]: openaiGpt4oMiniTranscribeBackend,
  [openaiGpt4oTranscribeDiarizeBackend.modelId]: openaiGpt4oTranscribeDiarizeBackend,
  [openaiWhisper1Backend.modelId]: openaiWhisper1Backend,
  [zaiGlmAsrBackend.modelId]: zaiGlmAsrBackend,
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
