/**
 * TTS dispatcher — normalizes synthesis across every supported provider
 * to a single shape: `{ audioBuffer: Buffer; contentType: string }`.
 *
 * Resolves the provider key via the BYOK system + falls back to the
 * server pool; caller supplies a `userId` so the dispatcher can pick the
 * right key. Each branch handles provider-specific request shapes
 * (output format strings, voice_id semantics, instructions field).
 *
 * For Deepgram + Groq we ship a tiny inline client here rather than
 * bouncing through a dedicated service file — the TTS surface is small
 * enough to keep co-located.
 */
import { TRPCError } from '@trpc/server';
import { resolveProviderKey } from '../../lib/byok';
import { getTtsModelById } from './registry';
import type { TtsModelConfig } from './types';

export interface TtsDispatchInput {
  modelId: string;
  /** Text to synthesize. */
  text: string;
  /** Provider-specific voice id. Falls back to the model's first preset. */
  voiceId?: string;
  /** Free-form steering ("speak warmly with a slight British accent"). */
  instructions?: string;
  /** ISO 639-1 (when the provider accepts a hint). */
  language?: string;
  /** 0.25–4.0 — only respected by tts-1 / tts-1-hd / ElevenLabs. */
  speed?: number;
  /** Output container. Defaults to mp3. */
  format?: 'mp3' | 'wav' | 'pcm' | 'opus' | 'flac';
  /** Caller uid for BYOK key resolution. */
  userId?: string | null;
}

export interface TtsDispatchResult {
  audioBuffer: Buffer;
  contentType: string;
  modelId: string;
  provider: TtsModelConfig['provider'];
}

function defaultVoiceFor(model: TtsModelConfig, requested?: string): string {
  if (requested) return requested;
  const first = model.voices[0];
  if (!first) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Model ${model.id} has no default voice — pass voiceId explicitly`,
    });
  }
  return first.id;
}

function audioMime(format: TtsDispatchInput['format']): string {
  switch (format) {
    case 'wav':
      return 'audio/wav';
    case 'pcm':
      return 'audio/pcm';
    case 'opus':
      return 'audio/opus';
    case 'flac':
      return 'audio/flac';
    case 'mp3':
    default:
      return 'audio/mpeg';
  }
}

export async function dispatchTts(input: TtsDispatchInput): Promise<TtsDispatchResult> {
  const model = getTtsModelById(input.modelId);
  if (!model) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unknown TTS model: ${input.modelId}`,
    });
  }
  if (!model.isEnabled) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `TTS model ${model.id} is disabled`,
    });
  }

  const format = input.format ?? 'mp3';

  // ── ElevenLabs ─────────────────────────────────────────────────────
  if (model.provider === 'elevenlabs') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'elevenlabs');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'ElevenLabs key missing — set ELEVENLABS_API_KEY or BYOK',
      });
    }
    const { elevenLabsService } = await import('../elevenlabs');
    const result = await elevenLabsService.textToSpeech({
      apiKey,
      text: input.text,
      voiceId: defaultVoiceFor(model, input.voiceId),
      modelId: model.providerModelId as
        | 'eleven_flash_v2_5'
        | 'eleven_multilingual_v2'
        | 'eleven_turbo_v2'
        | 'eleven_v3',
      outputFormat:
        format === 'mp3' ? 'mp3_44100_128' : format === 'pcm' ? 'pcm_24000' : 'mp3_44100_128',
    });
    return {
      audioBuffer: result.audioBuffer,
      contentType: result.contentType,
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── OpenAI ─────────────────────────────────────────────────────────
  if (model.provider === 'openai') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'openai');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'OpenAI key missing — set OPENAI_API_KEY or BYOK',
      });
    }
    const { openAIService } = await import('../openai');
    const result = await openAIService.tts({
      apiKey,
      model: model.providerModelId as 'gpt-4o-mini-tts' | 'tts-1' | 'tts-1-hd',
      voice: defaultVoiceFor(model, input.voiceId) as
        | 'alloy'
        | 'ash'
        | 'ballad'
        | 'coral'
        | 'echo'
        | 'fable'
        | 'nova'
        | 'onyx'
        | 'sage'
        | 'shimmer'
        | 'verse'
        | 'marin'
        | 'cedar',
      input: input.text,
      instructions: input.instructions,
      speed: input.speed,
      format,
    });
    return {
      audioBuffer: Buffer.from(result.audio),
      contentType: audioMime(format),
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── Deepgram Aura-2 ────────────────────────────────────────────────
  if (model.provider === 'deepgram') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'deepgram');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Deepgram key missing — set DEEPGRAM_API_KEY or BYOK',
      });
    }
    // Voice goes in the model param itself (`aura-2-<voice>-<lang>`).
    const voice = defaultVoiceFor(model, input.voiceId);
    const encoding = format === 'wav' ? 'linear16' : 'mp3';
    const res = await fetch(
      `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}&encoding=${encoding}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: input.text }),
        signal: AbortSignal.timeout(120_000),
      }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `Deepgram TTS ${res.status}: ${err.slice(0, 200)}`,
      });
    }
    return {
      audioBuffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? audioMime(format),
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── Groq (Orpheus / PlayAI) ────────────────────────────────────────
  if (model.provider === 'groq') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'groq');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Groq key missing — set GROQ_API_KEY or BYOK',
      });
    }
    const voice = defaultVoiceFor(model, input.voiceId);
    const res = await fetch('https://api.groq.com/openai/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model.providerModelId,
        voice,
        input: input.text,
        response_format: format,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `Groq TTS ${res.status}: ${err.slice(0, 200)}`,
      });
    }
    return {
      audioBuffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? audioMime(format),
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── ByteDance Doubao Seed-TTS ──────────────────────────────────────
  if (model.provider === 'bytedance') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'bytedance');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'ByteDance key missing — set BYTEDANCE_API_KEY or BYOK',
      });
    }
    const { bytedanceService } = await import('../bytedance');
    // ByteDance Seed-TTS only accepts mp3/wav/pcm — clamp opus/flac → mp3.
    const seedFormat: 'mp3' | 'wav' | 'pcm' = format === 'wav' || format === 'pcm' ? format : 'mp3';
    const result = await bytedanceService.generateSpeech({
      apiKey,
      text: input.text,
      voice: defaultVoiceFor(model, input.voiceId),
      model: model.providerModelId as 'seed-tts-1.0' | 'seed-tts-2.0',
      format: seedFormat,
    });
    if (result.status === 'failed') {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `ByteDance Seed-TTS failed: ${result.error ?? 'unknown'}`,
      });
    }
    let audioBuffer: Buffer;
    if (result.audioBase64) {
      audioBuffer = Buffer.from(result.audioBase64, 'base64');
    } else if (result.audioUrl) {
      const res = await fetch(result.audioUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: `Failed to fetch ByteDance audio: ${res.status}`,
        });
      }
      audioBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: 'ByteDance returned no audio payload',
      });
    }
    return {
      audioBuffer,
      contentType: audioMime((result.format as TtsDispatchInput['format']) ?? format),
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── Google Gemini TTS (preview) — via generateContent with audio config ─
  if (model.provider === 'google') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'google');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Google key missing — set GOOGLE_API_KEY or BYOK',
      });
    }
    // Gemini TTS uses the generateContent endpoint with responseModalities=AUDIO.
    const body = {
      contents: [{ role: 'user', parts: [{ text: input.text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: defaultVoiceFor(model, input.voiceId),
            },
          },
        },
      },
    };
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.providerModelId)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      }
    );
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `Gemini TTS ${res.status}: ${err.slice(0, 200)}`,
      });
    }
    interface GeminiTtsResp {
      candidates?: Array<{
        content?: {
          parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>;
        };
      }>;
    }
    const data = (await res.json()) as GeminiTtsResp;
    const inline = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (!inline?.data) {
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: 'Gemini TTS returned no audio payload',
      });
    }
    return {
      audioBuffer: Buffer.from(inline.data, 'base64'),
      contentType: inline.mimeType ?? audioMime(format),
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── Z.AI GLM-TTS ───────────────────────────────────────────────────
  if (model.provider === 'zai') {
    const apiKey = await resolveProviderKey(input.userId ?? null, 'zai');
    if (!apiKey) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Z.AI key missing — set ZAI_API_KEY or BYOK',
      });
    }
    // GLM-TTS lives at /api/paas/v4/audio/speech, Bearer auth, OpenAI-shaped.
    const body: Record<string, unknown> = {
      model: model.providerModelId,
      input: input.text,
      voice: defaultVoiceFor(model, input.voiceId),
      response_format: format === 'opus' || format === 'flac' ? 'mp3' : format,
    };
    if (input.speed != null) body.speed = input.speed;
    const res = await fetch('https://api.z.ai/api/paas/v4/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new TRPCError({
        code: 'BAD_GATEWAY',
        message: `Z.AI TTS ${res.status}: ${err.slice(0, 200)}`,
      });
    }
    return {
      audioBuffer: Buffer.from(await res.arrayBuffer()),
      contentType: res.headers.get('content-type') ?? audioMime(format),
      modelId: model.id,
      provider: model.provider,
    };
  }

  // ── FAL passthrough TTS (MiniMax, etc.) ────────────────────────────
  if (model.provider === 'fal') {
    throw new TRPCError({
      code: 'NOT_IMPLEMENTED',
      message:
        'FAL TTS passthrough dispatcher is not wired yet. Pick an ElevenLabs / OpenAI / Deepgram voice for now.',
    });
  }

  // Exhaustiveness guard
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `No TTS dispatcher for provider ${model.provider}`,
  });
}
