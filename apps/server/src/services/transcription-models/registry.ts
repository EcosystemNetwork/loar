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
