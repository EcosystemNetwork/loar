/**
 * Transcription / caption model registry — central source of truth.
 *
 * Pricing convention (matches audio/video/image registries):
 *   providerCostUsdPerMinute  — what we pay the provider
 *   fiatPriceUsdPerMinute     — providerCost × FIAT_MARGIN (1.35)
 *   loarPriceUsdPerMinute     — providerCost × LOAR_MARGIN (1.25)
 *   creditCostPerMinute       — ceil(fiatPrice / LOAR_TO_USD)
 *
 * Phase 1 of the model-metering PRD lands with one entry (FAL Whisper).
 * Phase 2 adds AssemblyAI, Deepgram, Groq, and ElevenLabs Scribe.
 */
import type { TranscriptionModelConfig } from './types';

// Reuse the shared margin constants from the existing registries so a
// future consolidation pass can lift them into `services/pricing/` in
// one move without per-registry drift.
export { FIAT_MARGIN, LOAR_MARGIN, LOAR_TO_USD } from '../video-models/registry';
import { FIAT_MARGIN, LOAR_MARGIN, LOAR_TO_USD } from '../video-models/registry';

function withFiatMargin(providerCost: number): number {
  return Math.round(providerCost * FIAT_MARGIN * 100) / 100;
}

function withLoarMargin(providerCost: number): number {
  return Math.round(providerCost * LOAR_MARGIN * 100) / 100;
}

function usdToCredits(usd: number): number {
  return Math.ceil(usd / LOAR_TO_USD);
}

export const TRANSCRIPTION_MODELS: TranscriptionModelConfig[] = [
  {
    id: 'whisper-fal',
    provider: 'fal',
    displayName: 'Whisper (FAL)',
    shortDescription: 'Segment-level transcription via OpenAI Whisper on FAL',
    providerModelId: 'fal-ai/whisper',
    supportsWordTimings: false,
    supportsDiarize: false,
    supportsTranslate: true, // task='translate' returns English; not multi-target
    supportedLanguages: [], // accepts any ISO-639-1 / auto-detect
    maxAudioMinutes: 240,
    qualityTier: 'standard',
    speedTier: 'fast',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.012,
    fiatPriceUsdPerMinute: withFiatMargin(0.012),
    loarPriceUsdPerMinute: withLoarMargin(0.012),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.012)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['transcribe', 'budget', 'fast'],
    bestFor: 'Quick drafts, single-speaker monologue, no diarization needed',
  },
  {
    id: 'universal-2-assemblyai',
    provider: 'assemblyai',
    displayName: 'AssemblyAI Universal-2',
    shortDescription: 'Forced-alignment word timings + best-in-class speaker diarization',
    providerModelId: 'universal-2',
    supportsWordTimings: true,
    supportsDiarize: true,
    supportsTranslate: false, // same-call translation not enabled in Phase 2
    supportedLanguages: [],
    maxAudioMinutes: 600,
    qualityTier: 'premium',
    speedTier: 'medium',
    priceTier: 'medium',
    providerCostUsdPerMinute: 0.0145,
    fiatPriceUsdPerMinute: withFiatMargin(0.0145),
    loarPriceUsdPerMinute: withLoarMargin(0.0145),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.0145)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false, // BYOK or env-provided
    tags: ['transcribe', 'diarize', 'word-timings', 'premium'],
    bestFor: 'Multi-speaker scenes, podcast cuts, anything needing accurate speaker labels',
  },
  {
    id: 'nova-3-deepgram',
    provider: 'deepgram',
    displayName: 'Deepgram Nova-3',
    shortDescription: 'Fast forced-alignment with native diarization, no translation',
    providerModelId: 'nova-3',
    supportsWordTimings: true,
    supportsDiarize: true,
    supportsTranslate: false,
    supportedLanguages: [],
    maxAudioMinutes: 600,
    qualityTier: 'premium',
    speedTier: 'fast',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.0043,
    fiatPriceUsdPerMinute: withFiatMargin(0.0043),
    loarPriceUsdPerMinute: withLoarMargin(0.0043),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.0043)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'diarize', 'word-timings', 'fast'],
    bestFor: 'Fast multi-speaker transcription at the lowest per-minute price',
  },
  {
    id: 'whisper-large-v3-groq',
    provider: 'groq',
    displayName: 'Whisper-large-v3 (Groq)',
    shortDescription: 'Word-level timings, ~3–4× realtime, 25MB per-file limit',
    providerModelId: 'whisper-large-v3',
    supportsWordTimings: true,
    supportsDiarize: false,
    supportsTranslate: false,
    supportedLanguages: [],
    maxAudioMinutes: 60, // 25MB ceiling — ~60 min @ 64kbps mp3
    qualityTier: 'standard',
    speedTier: 'fast',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.0011,
    fiatPriceUsdPerMinute: withFiatMargin(0.0011),
    loarPriceUsdPerMinute: withLoarMargin(0.0011),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.0011)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'word-timings', 'fast', 'budget'],
    bestFor: 'Cheapest fast word-level transcription; short clips, single speaker',
  },

  // ── AssemblyAI tier additions ─────────────────────────────────────────
  {
    id: 'slam-1-assemblyai',
    provider: 'assemblyai',
    displayName: 'AssemblyAI Slam-1',
    shortDescription:
      'Speech Language Model — prompt-conditioned EN transcription, beats Universal-2 in blind tests',
    providerModelId: 'slam_1',
    supportsWordTimings: true,
    supportsDiarize: true,
    supportsTranslate: false,
    supportedLanguages: ['en'],
    maxAudioMinutes: 600,
    qualityTier: 'premium',
    speedTier: 'medium',
    priceTier: 'medium',
    providerCostUsdPerMinute: 0.0045,
    fiatPriceUsdPerMinute: withFiatMargin(0.0045),
    loarPriceUsdPerMinute: withLoarMargin(0.0045),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.0045)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'diarize', 'word-timings', 'premium', 'english', 'slm'],
    bestFor: 'English-only premium transcription where prompt conditioning matters (jargon, names)',
  },
  {
    id: 'nano-assemblyai',
    provider: 'assemblyai',
    displayName: 'AssemblyAI Nano',
    shortDescription: 'Lightweight tier — limited languages, lowest cost on AAI',
    providerModelId: 'nano',
    supportsWordTimings: true,
    supportsDiarize: false,
    supportsTranslate: false,
    supportedLanguages: ['en', 'es', 'de', 'fr', 'it', 'pt'],
    maxAudioMinutes: 600,
    qualityTier: 'draft',
    speedTier: 'fast',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.002,
    fiatPriceUsdPerMinute: withFiatMargin(0.002),
    loarPriceUsdPerMinute: withLoarMargin(0.002),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.002)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'word-timings', 'budget', 'search'],
    bestFor: 'Bulk archives, search indexing, single-speaker monologue at lowest cost',
  },

  // ── Deepgram tier additions ───────────────────────────────────────────
  {
    id: 'nova-3-medical-deepgram',
    provider: 'deepgram',
    displayName: 'Deepgram Nova-3 Medical',
    shortDescription: 'Nova-3 with medical vocabulary, HIPAA-aware',
    providerModelId: 'nova-3-medical',
    supportsWordTimings: true,
    supportsDiarize: true,
    supportsTranslate: false,
    supportedLanguages: ['en'],
    maxAudioMinutes: 600,
    qualityTier: 'premium',
    speedTier: 'fast',
    priceTier: 'medium',
    providerCostUsdPerMinute: 0.0077,
    fiatPriceUsdPerMinute: withFiatMargin(0.0077),
    loarPriceUsdPerMinute: withLoarMargin(0.0077),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.0077)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: false, // gate behind a "medical" feature flag at UI level
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'diarize', 'word-timings', 'medical', 'hipaa'],
    bestFor: 'Healthcare-domain transcription with medical-term accuracy',
  },
  {
    id: 'nova-3-multilingual-deepgram',
    provider: 'deepgram',
    displayName: 'Deepgram Nova-3 Multilingual',
    shortDescription: 'Nova-3 streaming, 36 languages',
    providerModelId: 'nova-3',
    supportsWordTimings: true,
    supportsDiarize: true,
    supportsTranslate: false,
    supportedLanguages: [],
    maxAudioMinutes: 600,
    qualityTier: 'premium',
    speedTier: 'fast',
    priceTier: 'medium',
    providerCostUsdPerMinute: 0.0092,
    fiatPriceUsdPerMinute: withFiatMargin(0.0092),
    loarPriceUsdPerMinute: withLoarMargin(0.0092),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.0092)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'diarize', 'word-timings', 'multilingual', 'streaming'],
    bestFor: 'Multilingual streaming transcription with speaker labels',
  },
  {
    id: 'nova-2-deepgram',
    provider: 'deepgram',
    displayName: 'Deepgram Nova-2',
    shortDescription: 'Previous-gen, 36 languages, cheaper than Nova-3',
    providerModelId: 'nova-2',
    supportsWordTimings: true,
    supportsDiarize: true,
    supportsTranslate: false,
    supportedLanguages: [],
    maxAudioMinutes: 600,
    qualityTier: 'standard',
    speedTier: 'fast',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.0043,
    fiatPriceUsdPerMinute: withFiatMargin(0.0043),
    loarPriceUsdPerMinute: withLoarMargin(0.0043),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.0043)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: false, // hidden — Nova-3 supersedes for new users
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'diarize', 'word-timings', 'legacy'],
    bestFor: 'Legacy/cost-sensitive transcription with diarization',
  },
  {
    id: 'whisper-cloud-deepgram',
    provider: 'deepgram',
    displayName: 'Deepgram Whisper Cloud',
    shortDescription: 'Whisper-medium hosted on Deepgram, async only',
    providerModelId: 'whisper',
    supportsWordTimings: true,
    supportsDiarize: false,
    supportsTranslate: true,
    supportedLanguages: [],
    maxAudioMinutes: 600,
    qualityTier: 'standard',
    speedTier: 'medium',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.0048,
    fiatPriceUsdPerMinute: withFiatMargin(0.0048),
    loarPriceUsdPerMinute: withLoarMargin(0.0048),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.0048)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: false,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'word-timings', 'whisper', 'translate'],
    bestFor: 'Whisper accuracy without managing a Groq key',
  },

  // ── Groq tier additions ───────────────────────────────────────────────
  {
    id: 'whisper-large-v3-turbo-groq',
    provider: 'groq',
    displayName: 'Whisper-large-v3-turbo (Groq)',
    shortDescription: 'Distilled-decoder Whisper — half the cost, ~same WER on EN',
    providerModelId: 'whisper-large-v3-turbo',
    supportsWordTimings: true,
    supportsDiarize: false,
    supportsTranslate: false,
    supportedLanguages: [],
    maxAudioMinutes: 60,
    qualityTier: 'standard',
    speedTier: 'fast',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.000667, // $0.04/hr
    fiatPriceUsdPerMinute: withFiatMargin(0.000667),
    loarPriceUsdPerMinute: withLoarMargin(0.000667),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.000667)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'word-timings', 'fast', 'budget', 'turbo'],
    bestFor: 'Lowest-cost word-level transcription with full Whisper-large quality',
  },
  {
    id: 'distil-whisper-large-v3-en-groq',
    provider: 'groq',
    displayName: 'Distil-Whisper-large-v3 EN (Groq)',
    shortDescription: 'English-only distill, highest throughput',
    providerModelId: 'distil-whisper-large-v3-en',
    supportsWordTimings: true,
    supportsDiarize: false,
    supportsTranslate: false,
    supportedLanguages: ['en'],
    maxAudioMinutes: 60,
    qualityTier: 'standard',
    speedTier: 'fast',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.000333, // $0.02/hr
    fiatPriceUsdPerMinute: withFiatMargin(0.000333),
    loarPriceUsdPerMinute: withLoarMargin(0.000333),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.000333)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'word-timings', 'fast', 'budget', 'english', 'distil'],
    bestFor: 'Cheapest possible English transcription with timestamps',
  },

  // ── OpenAI ────────────────────────────────────────────────────────────
  {
    id: 'gpt-4o-transcribe-openai',
    provider: 'openai',
    displayName: 'GPT-4o Transcribe (OpenAI)',
    shortDescription: 'Lower WER than whisper-1, same $0.006/min, timestamps + language detect',
    providerModelId: 'gpt-4o-transcribe',
    supportsWordTimings: true,
    supportsDiarize: false,
    supportsTranslate: false,
    supportedLanguages: [],
    maxAudioMinutes: 120,
    qualityTier: 'premium',
    speedTier: 'medium',
    priceTier: 'medium',
    providerCostUsdPerMinute: 0.006,
    fiatPriceUsdPerMinute: withFiatMargin(0.006),
    loarPriceUsdPerMinute: withLoarMargin(0.006),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.006)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'word-timings', 'openai', 'lower-wer'],
    bestFor: 'Replacement for whisper-1 — same price, ~30% lower WER',
  },
  {
    id: 'gpt-4o-mini-transcribe-openai',
    provider: 'openai',
    displayName: 'GPT-4o Mini Transcribe (OpenAI)',
    shortDescription: 'Half the cost of gpt-4o-transcribe, ~same quality',
    providerModelId: 'gpt-4o-mini-transcribe',
    supportsWordTimings: true,
    supportsDiarize: false,
    supportsTranslate: false,
    supportedLanguages: [],
    maxAudioMinutes: 120,
    qualityTier: 'standard',
    speedTier: 'fast',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.003,
    fiatPriceUsdPerMinute: withFiatMargin(0.003),
    loarPriceUsdPerMinute: withLoarMargin(0.003),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.003)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'word-timings', 'openai', 'budget'],
    bestFor: 'Budget OpenAI transcription with word-level timings',
  },
  {
    id: 'gpt-4o-transcribe-diarize-openai',
    provider: 'openai',
    displayName: 'GPT-4o Transcribe + Diarize (OpenAI)',
    shortDescription: 'Adds speaker labels — closes the diarization gap in Voice Studio',
    providerModelId: 'gpt-4o-transcribe-diarize',
    supportsWordTimings: true,
    supportsDiarize: true,
    supportsTranslate: false,
    supportedLanguages: [],
    maxAudioMinutes: 120,
    qualityTier: 'premium',
    speedTier: 'medium',
    priceTier: 'medium',
    providerCostUsdPerMinute: 0.006,
    fiatPriceUsdPerMinute: withFiatMargin(0.006),
    loarPriceUsdPerMinute: withLoarMargin(0.006),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.006)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'diarize', 'word-timings', 'openai', 'multi-speaker'],
    bestFor:
      'Multi-speaker dialogue scenes — closes the no-diarization gap in Voice Studio Captions',
  },
  {
    id: 'whisper-1-openai',
    provider: 'openai',
    displayName: 'Whisper (OpenAI)',
    shortDescription: 'Legacy OpenAI Whisper — kept for parity, prefer gpt-4o-transcribe',
    providerModelId: 'whisper-1',
    supportsWordTimings: true,
    supportsDiarize: false,
    supportsTranslate: true,
    supportedLanguages: [],
    maxAudioMinutes: 120,
    qualityTier: 'standard',
    speedTier: 'medium',
    priceTier: 'medium',
    providerCostUsdPerMinute: 0.006,
    fiatPriceUsdPerMinute: withFiatMargin(0.006),
    loarPriceUsdPerMinute: withLoarMargin(0.006),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.006)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: false, // hidden: gpt-4o-transcribe is the upgrade
    allowedPlans: [],
    serverPoolAvailable: false,
    tags: ['transcribe', 'word-timings', 'openai', 'legacy'],
    bestFor: 'Legacy parity — new code should use gpt-4o-transcribe',
  },

  // ── Z.AI ──────────────────────────────────────────────────────────────
  {
    id: 'glm-asr-2512-zai',
    provider: 'zai',
    displayName: 'GLM-ASR 2512 (Z.AI)',
    shortDescription:
      'Multilingual + Chinese dialects (Sichuanese, Cantonese, Min Nan, Wu) + English',
    providerModelId: 'glm-asr-2512',
    supportsWordTimings: false,
    supportsDiarize: false,
    supportsTranslate: false,
    supportedLanguages: ['zh', 'en'],
    maxAudioMinutes: 120,
    qualityTier: 'premium',
    speedTier: 'medium',
    priceTier: 'low',
    providerCostUsdPerMinute: 0.002, // approximate; needs console verification
    fiatPriceUsdPerMinute: withFiatMargin(0.002),
    loarPriceUsdPerMinute: withLoarMargin(0.002),
    creditCostPerMinute: usdToCredits(withFiatMargin(0.002)),
    lastVerified: '2026-05-17',
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    serverPoolAvailable: true,
    tags: ['transcribe', 'multilingual', 'chinese', 'dialects'],
    bestFor: 'Chinese dialect coverage (Cantonese, Sichuanese, Min Nan, Wu)',
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────

export function getModelById(id: string): TranscriptionModelConfig | undefined {
  return TRANSCRIPTION_MODELS.find((m) => m.id === id);
}

export function getModelByProviderModelId(
  providerModelId: string
): TranscriptionModelConfig | undefined {
  return TRANSCRIPTION_MODELS.find((m) => m.providerModelId === providerModelId);
}

export function getEnabledModels(): TranscriptionModelConfig[] {
  return TRANSCRIPTION_MODELS.filter((m) => m.isEnabled);
}

export function getVisibleModels(): TranscriptionModelConfig[] {
  return TRANSCRIPTION_MODELS.filter((m) => m.isEnabled && m.isVisibleToUsers);
}

export function getModelIds(): string[] {
  return TRANSCRIPTION_MODELS.map((m) => m.id);
}

/**
 * Credit quote for a transcription call.
 *
 * @param modelId   registry id
 * @param minutes   audio duration in minutes (decimals OK)
 * @param byok      true when the user is paying the provider directly via
 *                  their own key; returns the flat BYOK routing fee instead
 *                  of the metered price.
 */
export function quoteCredits(modelId: string, minutes: number, byok = false): number {
  if (byok) return BYOK_ROUTING_FEE_CREDITS;
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Unknown transcription model: ${modelId}`);
  }
  if (!model.isEnabled) {
    throw new Error(`Transcription model is disabled: ${modelId}`);
  }
  if (minutes <= 0) return model.creditCostPerMinute; // minimum charge: 1 minute
  return Math.ceil(model.creditCostPerMinute * minutes);
}

/**
 * Flat fee charged per BYOK call. Set once here — referenced by routers
 * and surfaced in the UI. Matches PRD decision #5.
 */
export const BYOK_ROUTING_FEE_CREDITS = 1; // 0.5 was the proposal; rounded to int
