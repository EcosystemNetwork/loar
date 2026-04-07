/**
 * Image Model Registry — all supported image generation models.
 *
 * Pricing mirrors the video registry dual-margin model:
 *   providerCostUsd — what we pay fal per image
 *   fiatPriceUsd    — providerCostUsd × 1.35 (card / ETH / crypto)
 *   loarPriceUsd    — providerCostUsd × 1.25 ($LOAR payments)
 *   creditCostPerImage — internal credits per single image
 */
import { FIAT_MARGIN, LOAR_MARGIN, LOAR_TO_USD } from '../video-models/registry';
import type { ImageModelConfig, ImageGenerationTask } from './types';

function withFiatMargin(cost: number) {
  return Math.round(cost * FIAT_MARGIN * 100) / 100;
}
function withLoarMargin(cost: number) {
  return Math.round(cost * LOAR_MARGIN * 100) / 100;
}
function usdToLoar(usd: number) {
  return Math.ceil(usd / LOAR_TO_USD);
}

export const IMAGE_MODELS: ImageModelConfig[] = [
  // ── Draft / Fast ─────────────────────────────────────────────────────
  {
    id: 'flux-schnell',
    provider: 'fal',
    displayName: 'FLUX Schnell',
    shortDescription: 'Fastest drafts — 4-step inference',
    falModelId: 'fal-ai/flux/schnell',
    tasks: ['text_to_image'],
    qualityTier: 'draft',
    speedTier: 'fast',
    priceTier: 'low',
    maxImages: 4,
    supportedSizes: [
      'square_hd',
      'square',
      'portrait_4_3',
      'portrait_16_9',
      'landscape_4_3',
      'landscape_16_9',
    ],
    supportsNegativePrompt: false,
    supportsSeed: true,
    creditCostPerImage: usdToLoar(withFiatMargin(0.003)),
    providerCostUsd: 0.003,
    fiatPriceUsd: withFiatMargin(0.003),
    loarPriceUsd: withLoarMargin(0.003),
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    tags: ['draft', 'fast', 'flux', 'iteration'],
    bestFor: 'Rapid iteration and concept sketching',
  },

  // ── Standard ─────────────────────────────────────────────────────────
  {
    id: 'nano-banana',
    provider: 'fal',
    displayName: 'Nano Banana',
    shortDescription: 'Default — great balance of quality and speed',
    falModelId: 'fal-ai/nano-banana',
    tasks: ['text_to_image', 'image_to_image'],
    qualityTier: 'standard',
    speedTier: 'fast',
    priceTier: 'low',
    maxImages: 4,
    supportedSizes: [
      'square_hd',
      'square',
      'portrait_4_3',
      'portrait_16_9',
      'landscape_4_3',
      'landscape_16_9',
    ],
    supportsNegativePrompt: false,
    supportsSeed: true,
    creditCostPerImage: usdToLoar(withFiatMargin(0.006)),
    providerCostUsd: 0.006,
    fiatPriceUsd: withFiatMargin(0.006),
    loarPriceUsd: withLoarMargin(0.006),
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    tags: ['standard', 'fast', 'default', 'character', 'scene'],
    bestFor: 'Character portraits, scene concepts, and entity artwork',
  },
  {
    id: 'flux-dev',
    provider: 'fal',
    displayName: 'FLUX Dev',
    shortDescription: 'High-detail research-grade output',
    falModelId: 'fal-ai/flux/dev',
    tasks: ['text_to_image', 'image_to_image'],
    qualityTier: 'standard',
    speedTier: 'medium',
    priceTier: 'medium',
    maxImages: 4,
    supportedSizes: [
      'square_hd',
      'square',
      'portrait_4_3',
      'portrait_16_9',
      'landscape_4_3',
      'landscape_16_9',
    ],
    supportsNegativePrompt: true,
    supportsSeed: true,
    creditCostPerImage: usdToLoar(withFiatMargin(0.025)),
    providerCostUsd: 0.025,
    fiatPriceUsd: withFiatMargin(0.025),
    loarPriceUsd: withLoarMargin(0.025),
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    tags: ['standard', 'detail', 'flux', 'negative-prompt'],
    bestFor: 'Detailed character art and high-fidelity concept renders',
  },

  // ── Premium ───────────────────────────────────────────────────────────
  {
    id: 'flux-pro',
    provider: 'fal',
    displayName: 'FLUX Pro',
    shortDescription: 'Commercial-grade, highest FLUX quality',
    falModelId: 'fal-ai/flux-pro',
    tasks: ['text_to_image'],
    qualityTier: 'premium',
    speedTier: 'medium',
    priceTier: 'high',
    maxImages: 4,
    supportedSizes: [
      'square_hd',
      'square',
      'portrait_4_3',
      'portrait_16_9',
      'landscape_4_3',
      'landscape_16_9',
    ],
    supportsNegativePrompt: true,
    supportsSeed: true,
    creditCostPerImage: usdToLoar(withFiatMargin(0.05)),
    providerCostUsd: 0.05,
    fiatPriceUsd: withFiatMargin(0.05),
    loarPriceUsd: withLoarMargin(0.05),
    isEnabled: true,
    isVisibleToUsers: true,
    allowedPlans: [],
    tags: ['premium', 'commercial', 'flux', 'nft', 'final'],
    bestFor: 'Final renders, NFT art, and premium entity visuals',
  },
];

// ── Lookup Helpers ────────────────────────────────────────────────────

const modelsById = new Map(IMAGE_MODELS.map((m) => [m.id, m]));

export function getImageModelById(id: string): ImageModelConfig | undefined {
  return modelsById.get(id);
}

export function getEnabledImageModels(): ImageModelConfig[] {
  return IMAGE_MODELS.filter((m) => m.isEnabled);
}

export function getVisibleImageModels(): ImageModelConfig[] {
  return IMAGE_MODELS.filter((m) => m.isEnabled && m.isVisibleToUsers);
}

export function getImageModelsForTask(task: ImageGenerationTask): ImageModelConfig[] {
  return getVisibleImageModels().filter((m) => m.tasks.includes(task));
}

export function getImageModelIds(): string[] {
  return IMAGE_MODELS.map((m) => m.id);
}
