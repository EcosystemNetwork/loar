/**
 * Audio Model Registry — Central source of truth for all supported audio/music generation models.
 *
 * Dual-margin pricing model (matches video):
 * - providerCostUsd = what we pay the AI provider per generation
 * - fiatPriceUsd = providerCostUsd * 1.35 (35% margin for card/crypto)
 * - loarPriceUsd = providerCostUsd * 1.25 (25% margin for $LOAR payments)
 */
import type { AudioModelConfig, AudioGenerationMode } from './types';

export const FIAT_MARGIN = 1.35;
export const LOAR_MARGIN = 1.25;
export const LOAR_TO_USD = 0.01;

function withFiatMargin(providerCost: number): number {
  return Math.round(providerCost * FIAT_MARGIN * 100) / 100;
}

function withLoarMargin(providerCost: number): number {
  return Math.round(providerCost * LOAR_MARGIN * 100) / 100;
}

function usdToLoar(usd: number): number {
  return Math.ceil(usd / LOAR_TO_USD);
}

export const AUDIO_MODELS: AudioModelConfig[] = [
  // ── Music Generation ───────────────────────────────────────────────
  {
    id: 'stable-audio-2',
    provider: 'fal',
    displayName: 'Stable Audio 2.0',
    shortDescription: 'High-quality music & sound from text, up to 47s',
    falModelId: 'fal-ai/stable-audio',
    mode: ['text_to_music', 'text_to_sound'],
    qualityTier: 'premium',
    speedTier: 'medium',
    priceTier: 'medium',
    maxDurationSec: 47,
    supportedDurations: [5, 10, 15, 30, 47],
    creditCost: usdToLoar(withFiatMargin(0.04)),
    providerCostUsd: 0.04,
    fiatPriceUsd: withFiatMargin(0.04),
    loarPriceUsd: withLoarMargin(0.04),
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    tags: ['music', 'ambient', 'cinematic', 'sound-design'],
    bestFor: 'Theme music, ambient soundscapes, cinematic scores',
  },
  {
    id: 'musicgen-large',
    provider: 'fal',
    displayName: 'MusicGen Large',
    shortDescription: 'Meta music generation, versatile styles',
    falModelId: 'fal-ai/musicgen/large',
    mode: ['text_to_music'],
    qualityTier: 'standard',
    speedTier: 'fast',
    priceTier: 'low',
    maxDurationSec: 30,
    supportedDurations: [5, 10, 15, 30],
    creditCost: usdToLoar(withFiatMargin(0.02)),
    providerCostUsd: 0.02,
    fiatPriceUsd: withFiatMargin(0.02),
    loarPriceUsd: withLoarMargin(0.02),
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    tags: ['music', 'fast', 'versatile'],
    bestFor: 'Quick music drafts, background tracks',
  },
  {
    id: 'musicgen-stereo-large',
    provider: 'fal',
    displayName: 'MusicGen Stereo',
    shortDescription: 'Stereo music generation with richer spatial audio',
    falModelId: 'fal-ai/musicgen/stereo-large',
    mode: ['text_to_music'],
    qualityTier: 'standard',
    speedTier: 'medium',
    priceTier: 'low',
    maxDurationSec: 30,
    supportedDurations: [5, 10, 15, 30],
    creditCost: usdToLoar(withFiatMargin(0.03)),
    providerCostUsd: 0.03,
    fiatPriceUsd: withFiatMargin(0.03),
    loarPriceUsd: withLoarMargin(0.03),
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    tags: ['music', 'stereo', 'spatial'],
    bestFor: 'Stereo music with spatial depth',
  },
];

// ── Lookup Helpers ───────────────────────────────────────────────────

export function getModelById(id: string): AudioModelConfig | undefined {
  return AUDIO_MODELS.find((m) => m.id === id);
}

export function getModelByFalId(falId: string): AudioModelConfig | undefined {
  return AUDIO_MODELS.find((m) => m.falModelId === falId);
}

export function getEnabledModels(): AudioModelConfig[] {
  return AUDIO_MODELS.filter((m) => m.isEnabled);
}

export function getVisibleModels(): AudioModelConfig[] {
  return AUDIO_MODELS.filter((m) => m.isEnabled && m.isVisibleToUsers);
}

export function getModelsForMode(mode: AudioGenerationMode): AudioModelConfig[] {
  return AUDIO_MODELS.filter((m) => m.isEnabled && m.mode.includes(mode));
}

export function getModelIds(): string[] {
  return AUDIO_MODELS.map((m) => m.id);
}
