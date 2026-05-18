/**
 * TTS Router — modern entrypoint backed by the unified `dispatchTts`.
 *
 * Existing voice routes (`voice.routes.ts`, `voiceLibrary.routes.ts`,
 * `studio.routes.ts`, `dubbing.routes.ts`, etc.) still call
 * `elevenLabsService.textToSpeech` directly. This router is the new
 * provider-agnostic surface — new code should hit `tts.synthesize` so
 * users can pick OpenAI gpt-4o-mini-tts, Deepgram Aura-2, Doubao
 * Seed-TTS, Z.AI GLM-TTS, etc., not just ElevenLabs.
 */
import { router, protectedProcedure, publicProcedure, requirePermission } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { firebaseStorageService } from '../../services/firebase-storage';
import { dispatchTts, getVisibleTtsModels, getTtsModelById } from '../../services/tts-models';
import { sanitizePrompt } from '../../lib/prompt-sanitize';
import { TRPCError } from '@trpc/server';

async function uploadAudio(buffer: Buffer, filename: string): Promise<string> {
  const key = await firebaseStorageService.upload(buffer, filename);
  return firebaseStorageService.getPublicUrl(key);
}

const synthesizeSchema = z.object({
  /** Registry id from `tts-models/registry` (e.g. 'eleven-flash-v25', 'gpt-4o-mini-tts'). */
  modelId: z.string(),
  /** Text to synthesize (max 10k chars, sanitized for prompt-injection patterns). */
  text: z.string().min(1).max(10_000),
  /** Provider-specific voice id. Defaults to the model's first preset. */
  voiceId: z.string().optional(),
  /** Free-form style instructions (gpt-4o-mini-tts; Gemini TTS). */
  instructions: z.string().max(500).optional(),
  /** ISO 639-1 hint. */
  language: z.string().length(2).optional(),
  /** Output format. */
  format: z.enum(['mp3', 'wav', 'pcm', 'opus', 'flac']).default('mp3'),
  /** Persist the result to storage and return a URL (default true). */
  persist: z.boolean().default(true),
});

export const ttsRouter = router({
  // ── Discoverable model list (public — no key required to browse) ────
  listModels: publicProcedure.query(() => {
    return getVisibleTtsModels().map((m) => ({
      id: m.id,
      provider: m.provider,
      displayName: m.displayName,
      shortDescription: m.shortDescription,
      firstAudioLatencyMs: m.firstAudioLatencyMs,
      maxChars: m.maxChars,
      supportedFormats: m.supportedFormats,
      supportedLanguages: m.supportedLanguages,
      voices: m.voices,
      supportsVoiceClone: m.supportsVoiceClone,
      supportsStyleSteer: m.supportsStyleSteer,
      supportsStreaming: m.supportsStreaming,
      qualityTier: m.qualityTier,
      speedTier: m.speedTier,
      priceTier: m.priceTier,
      fiatPriceUsdPerMillionChars: m.fiatPriceUsdPerMillionChars,
      loarPriceUsdPerMillionChars: m.loarPriceUsdPerMillionChars,
      creditCostPer1kChars: m.creditCostPer1kChars,
      tags: m.tags,
      bestFor: m.bestFor,
    }));
  }),

  // ── Get one row's full config ─────────────────────────────────────
  getModel: publicProcedure.input(z.object({ modelId: z.string() })).query(({ input }) => {
    const m = getTtsModelById(input.modelId);
    if (!m) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `Unknown TTS model: ${input.modelId}` });
    }
    return m;
  }),

  // ── Synthesize ────────────────────────────────────────────────────
  synthesize: protectedProcedure
    .use(requirePermission('generation.audio'))
    .input(synthesizeSchema)
    .mutation(async ({ input, ctx }) => {
      const text = sanitizePrompt(input.text);
      const result = await dispatchTts({
        modelId: input.modelId,
        text,
        voiceId: input.voiceId,
        instructions: input.instructions,
        language: input.language,
        format: input.format,
        userId: ctx.user.uid,
      });

      if (!input.persist) {
        // Return raw base64 — caller handles persistence (preview flows, etc.)
        return {
          modelId: result.modelId,
          provider: result.provider,
          contentType: result.contentType,
          audioBase64: result.audioBuffer.toString('base64'),
          url: null,
        };
      }

      const ext = input.format === 'wav' ? 'wav' : input.format === 'opus' ? 'opus' : 'mp3';
      const url = await uploadAudio(
        result.audioBuffer,
        `tts/${ctx.user.uid}/${randomUUID()}.${ext}`
      );
      return {
        modelId: result.modelId,
        provider: result.provider,
        contentType: result.contentType,
        url,
        audioBase64: null,
      };
    }),
});
