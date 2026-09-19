/**
 * Hume Octave TTS — Character Voice synthesis.
 *
 * The Character Voice leg of the LOAR Director pipeline (LOAR WORLD →
 * Character Voice → HUME): turns a director/character response into audio
 * in a specific voice, optionally steered by a short acting `description`
 * ("hushed, wary, half a whisper").
 *
 * Auth: `X-Hume-Api-Key: ${HUME_API_KEY}` (server env var — platform pool
 * key, same trust tier as `transcriptionService`'s FAL_KEY). Not wired into
 * BYOK or credit billing yet; if usage grows past incidental use this needs
 * a cost-tracker entry like the other provider dispatches.
 *
 * Reference: https://dev.hume.ai/reference/text-to-speech-tts/synthesize-json
 */

const HUME_TTS_URL = 'https://api.hume.ai/v0/tts';
const FETCH_TIMEOUT_MS = 30_000;

export interface HumeSynthesizeOptions {
  text: string;
  /** Existing Hume voice id (from a saved voice or the voice library). */
  voiceId?: string;
  /** Named preset voice, alternative to `voiceId`. */
  voiceName?: string;
  /** Short acting direction steering delivery, e.g. "tense, urgent". */
  description?: string;
  /** 0.5–2.0, default 1.0. */
  speed?: number;
}

export interface HumeSynthesizeResult {
  audioBuffer: Buffer;
  contentType: string;
  generationId?: string;
}

interface HumeTtsResponse {
  generations?: Array<{
    generation_id?: string;
    audio?: string; // base64
  }>;
}

class HumeService {
  isConfigured(): boolean {
    return !!process.env.HUME_API_KEY;
  }

  async textToSpeech(opts: HumeSynthesizeOptions): Promise<HumeSynthesizeResult> {
    const apiKey = process.env.HUME_API_KEY;
    if (!apiKey) throw new Error('HUME_API_KEY environment variable is required');

    const voice = opts.voiceId
      ? { id: opts.voiceId }
      : opts.voiceName
        ? { name: opts.voiceName, provider: 'HUME_AI' as const }
        : undefined;

    const body = {
      utterances: [
        {
          text: opts.text,
          ...(voice ? { voice } : {}),
          ...(opts.description ? { description: opts.description } : {}),
          ...(opts.speed ? { speed: opts.speed } : {}),
        },
      ],
      format: { type: 'mp3' },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(HUME_TTS_URL, {
        method: 'POST',
        headers: {
          'X-Hume-Api-Key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Hume TTS failed (${res.status}): ${errText.slice(0, 300)}`);
    }

    const data = (await res.json()) as HumeTtsResponse;
    const generation = data.generations?.[0];
    if (!generation?.audio) {
      throw new Error('Hume TTS returned no audio');
    }

    return {
      audioBuffer: Buffer.from(generation.audio, 'base64'),
      contentType: 'audio/mpeg',
      generationId: generation.generation_id,
    };
  }
}

export const humeService = new HumeService();
