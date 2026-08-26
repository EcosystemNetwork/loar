/**
 * Shared BYOK provider metadata — display copy for every provider the
 * server's `provider-keys` registry supports (see
 * apps/server/src/services/provider-keys/registry.ts, which is the source
 * of truth for the actual provider id list; this file just carries the
 * copy the server doesn't know how to write).
 *
 * Used by both `/settings/api-keys` (the full key-management page) and
 * `ApiKeyGateModal` (the "add a key to unlock this model" popup) so the
 * two surfaces never drift.
 *
 * BYOK is required, not optional: dispatch has no platform-pool fallback
 * (see `resolveProviderKey` in lib/byok.ts on the server) — a model stays
 * locked until the user adds their own key for its provider.
 */

export type Provider =
  | 'bytedance'
  | 'zai'
  | 'openai'
  | 'google'
  | 'fal'
  | 'elevenlabs'
  | 'meshy'
  | 'tripo'
  | 'minimax'
  | 'assemblyai'
  | 'deepgram'
  | 'groq';

export interface ProviderMeta {
  label: string;
  blurb: string;
  docsUrl: string;
  placeholder: string;
  /** Shown when no key is on file — what's locked until one is added. */
  lockedNote: string;
}

export const PROVIDER_META: Record<Provider, ProviderMeta> = {
  bytedance: {
    label: 'ByteDance ModelArk',
    blurb:
      'Powers Seedance 2.0 (video), Seedream 5.0 (images), Seed 2.0 (planning), and OmniHuman talking-scenes.',
    docsUrl: 'https://docs.byteplus.com/en/docs/ModelArk/',
    placeholder: 'Paste your ModelArk API key…',
    lockedNote: 'Add a key to unlock Seedance, Seedream, and OmniHuman generation.',
  },
  zai: {
    label: 'Z.AI (GLM)',
    blurb:
      'Powers GLM-4.6 / GLM-5.x reasoning, GLM-5V vision, CogView-4 image, CogVideoX-3 video, GLM-ASR transcription, and Web Search / Web Reader tools. Used by /lab/zai, the worldbuild planner, canon-consistency checks, and the governance agent.',
    docsUrl: 'https://docs.z.ai/llms.txt',
    placeholder: 'Paste your Z.AI API key…',
    lockedNote: 'Add a key to unlock GLM chat, vision, image, video, and transcription.',
  },
  google: {
    label: 'Google AI (Imagen + Gemini)',
    blurb:
      'Powers Imagen 4 / nano-banana-pro image generation, Veo video, Gemini video analysis, character image analysis, and prompt enhancement.',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    placeholder: 'Paste your Google AI Studio key (AIza…)…',
    lockedNote: 'Add a key to unlock Imagen, Veo, and Gemini-backed generation.',
  },
  fal: {
    label: 'fal.ai',
    blurb:
      "Powers FLUX, Veo3, Sora 2, Kling, Runway Gen-3, WAN, PixVerse, Stable Audio, MusicGen, LoRA training, inpainting/outpainting, upscaling, frame interpolation, and background removal. The studio's broadest provider.",
    docsUrl: 'https://fal.ai/dashboard/keys',
    placeholder: 'Paste your fal.ai key (uuid:secret)…',
    lockedNote: 'Add a key to unlock most video, image, and editing models.',
  },
  elevenlabs: {
    label: 'ElevenLabs',
    blurb:
      'Powers text-to-speech, voice cloning, voice design, sound effects, and the talking-scene pipeline.',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
    placeholder: 'Paste your ElevenLabs API key…',
    lockedNote: 'Add a key to unlock TTS, voice cloning, and sound design.',
  },
  meshy: {
    label: 'Meshy (3D)',
    blurb:
      'Powers text-to-3D, image-to-3D, multi-image-to-3D, rigging, and re-texturing in the character pipeline.',
    docsUrl: 'https://www.meshy.ai/api-keys',
    placeholder: 'Paste your Meshy API key (msy_…)…',
    lockedNote: 'Add a key to unlock the 3D character pipeline.',
  },
  openai: {
    label: 'OpenAI',
    blurb: 'Powers GPT-Image, embeddings, transcription, and select LLM fallback paths.',
    docsUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'Paste your OpenAI key (sk-…)…',
    lockedNote: 'Add a key to unlock OpenAI-backed models.',
  },
  tripo: {
    label: 'Tripo3D',
    blurb:
      'Powers Tripo text-to-3D and image-to-3D generation — an alternative 3D backend to Meshy.',
    docsUrl: 'https://platform.tripo3d.ai/api-keys',
    placeholder: 'Paste your Tripo3D API key…',
    lockedNote: 'Add a key to unlock Tripo 3D generation.',
  },
  minimax: {
    label: 'MiniMax (Hailuo)',
    blurb: 'Powers MiniMax Hailuo video generation — text-to-video and image-to-video.',
    docsUrl: 'https://platform.minimaxi.com/document/Fast%20access?key=66719005a427f0c8a5701643',
    placeholder: 'Paste your MiniMax API key…',
    lockedNote: 'Add a key to unlock Hailuo video generation.',
  },
  assemblyai: {
    label: 'AssemblyAI',
    blurb: 'Powers the Universal-2, SLAM-1, and Nano transcription models.',
    docsUrl: 'https://www.assemblyai.com/app/account',
    placeholder: 'Paste your AssemblyAI API key…',
    lockedNote: 'Add a key to unlock AssemblyAI transcription models.',
  },
  deepgram: {
    label: 'Deepgram',
    blurb: 'Powers Nova-3 (plus medical/multilingual variants), Nova-2, and Whisper Cloud.',
    docsUrl: 'https://console.deepgram.com/project',
    placeholder: 'Paste your Deepgram API key…',
    lockedNote: 'Add a key to unlock Deepgram transcription models.',
  },
  groq: {
    label: 'Groq',
    blurb: 'Powers Whisper Large v3 / Turbo and Distil-Whisper — the fastest transcription tier.',
    docsUrl: 'https://console.groq.com/keys',
    placeholder: 'Paste your Groq API key (gsk_…)…',
    lockedNote: 'Add a key to unlock Groq transcription models.',
  },
};

export function isKnownProviderMeta(id: string): id is Provider {
  return id in PROVIDER_META;
}

/** Fallback label for a provider id the client doesn't recognize (new server-side addition). */
export function providerLabel(id: string): string {
  return isKnownProviderMeta(id) ? PROVIDER_META[id].label : id;
}
