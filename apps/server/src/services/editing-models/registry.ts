/**
 * Video Editing Models Registry
 *
 * Central source of truth for all post-processing / editing models.
 * Covers: upscaling, frame interpolation, video-to-video restyle,
 * inpainting, background removal, and clip extension.
 *
 * All models are accessed via FAL.ai API.
 */
import type { EditingModelConfig, EditingOperation } from './types';

/** Margin for credit card / ETH / other crypto purchases */
const FIAT_MARGIN = 1.35;

/** Margin for $LOAR token purchases */
const LOAR_MARGIN = 1.25;

/** $LOAR token to USD conversion rate */
const LOAR_TO_USD = 0.01;

function withFiatMargin(cost: number): number {
  return Math.round(cost * FIAT_MARGIN * 100) / 100;
}
function withLoarMargin(cost: number): number {
  return Math.round(cost * LOAR_MARGIN * 100) / 100;
}
function usdToLoar(usd: number): number {
  return Math.ceil(usd / LOAR_TO_USD);
}

export const EDITING_MODELS: EditingModelConfig[] = [
  // ── Upscale ──────────────────────────────────────────────────────────
  {
    id: 'upscale-esrgan',
    operation: 'upscale',
    provider: 'fal',
    displayName: 'Real-ESRGAN 4×',
    shortDescription: 'Fast 4× super-resolution for images and video frames',
    falModelId: 'fal-ai/real-esrgan',
    tier: 'fast',
    providerCostUsd: 0.01,
    fiatPriceUsd: withFiatMargin(0.01),
    loarPriceUsd: withLoarMargin(0.01),
    creditCost: usdToLoar(withFiatMargin(0.01)),
    isEnabled: true,
    maxInputResolution: '1080p',
    outputResolution: '4k',
    supportsVideo: false,
    supportsImage: true,
    tags: ['upscale', '4k', 'super-resolution', 'fast'],
    bestFor: 'Quick 4× upscale of images and video frames',
  },
  {
    id: 'upscale-clarity',
    operation: 'upscale',
    provider: 'fal',
    displayName: 'Clarity Upscaler',
    shortDescription: 'AI-enhanced upscale with detail regeneration',
    falModelId: 'fal-ai/clarity-upscaler',
    tier: 'quality',
    providerCostUsd: 0.04,
    fiatPriceUsd: withFiatMargin(0.04),
    loarPriceUsd: withLoarMargin(0.04),
    creditCost: usdToLoar(withFiatMargin(0.04)),
    isEnabled: true,
    maxInputResolution: '1080p',
    outputResolution: '4k',
    supportsVideo: false,
    supportsImage: true,
    tags: ['upscale', '4k', 'detail', 'quality'],
    bestFor: 'High-quality upscale with AI detail enhancement',
  },
  {
    id: 'upscale-creative',
    operation: 'upscale',
    provider: 'fal',
    displayName: 'Creative Upscaler',
    shortDescription: 'Prompt-guided upscale — adds detail based on description',
    falModelId: 'fal-ai/creative-upscaler',
    tier: 'quality',
    providerCostUsd: 0.05,
    fiatPriceUsd: withFiatMargin(0.05),
    loarPriceUsd: withLoarMargin(0.05),
    creditCost: usdToLoar(withFiatMargin(0.05)),
    isEnabled: true,
    maxInputResolution: '1080p',
    outputResolution: '4k',
    supportsVideo: false,
    supportsImage: true,
    tags: ['upscale', '4k', 'creative', 'prompt-guided'],
    bestFor: 'Upscale with prompt-guided detail generation',
  },

  // ── Frame Interpolation ──────────────────────────────────────────────
  {
    id: 'interpolate-film',
    operation: 'interpolate',
    provider: 'fal',
    displayName: 'FILM Interpolation',
    shortDescription: 'Smooth slow-motion via frame interpolation (2× – 8×)',
    falModelId: 'fal-ai/frame-interpolation',
    tier: 'fast',
    providerCostUsd: 0.02,
    fiatPriceUsd: withFiatMargin(0.02),
    loarPriceUsd: withLoarMargin(0.02),
    creditCost: usdToLoar(withFiatMargin(0.02)),
    isEnabled: true,
    supportsVideo: true,
    supportsImage: false,
    tags: ['interpolation', 'slow-motion', 'smooth', 'frame-rate'],
    bestFor: 'Create smooth slow-motion from any video',
  },

  // ── Video-to-Video Restyle ───────────────────────────────────────────
  {
    id: 'restyle-wan-v2v',
    operation: 'restyle',
    provider: 'fal',
    displayName: 'WAN Video-to-Video',
    shortDescription: 'Restyle a video with a new prompt while preserving motion',
    falModelId: 'fal-ai/wan/v2.1/video-to-video',
    tier: 'standard',
    providerCostUsd: 0.08,
    fiatPriceUsd: withFiatMargin(0.08),
    loarPriceUsd: withLoarMargin(0.08),
    creditCost: usdToLoar(withFiatMargin(0.08)),
    isEnabled: true,
    supportsVideo: true,
    supportsImage: false,
    tags: ['restyle', 'video-to-video', 'style-transfer', 'motion-preserve'],
    bestFor: 'Restyle video while keeping original motion and structure',
  },
  {
    id: 'restyle-kling-v2v',
    operation: 'restyle',
    provider: 'fal',
    displayName: 'Kling Video-to-Video',
    shortDescription: 'Premium video restyling with Kling quality',
    falModelId: 'fal-ai/kling-video/v2/master/video-to-video',
    tier: 'quality',
    providerCostUsd: 0.15,
    fiatPriceUsd: withFiatMargin(0.15),
    loarPriceUsd: withLoarMargin(0.15),
    creditCost: usdToLoar(withFiatMargin(0.15)),
    isEnabled: true,
    supportsVideo: true,
    supportsImage: false,
    tags: ['restyle', 'video-to-video', 'premium', 'kling'],
    bestFor: 'Premium quality video restyling',
  },

  // ── Inpainting (Image — applied to video keyframes) ──────────────────
  {
    id: 'inpaint-flux',
    operation: 'inpaint',
    provider: 'fal',
    displayName: 'FLUX Fill Inpaint',
    shortDescription: 'Paint over a region and describe the replacement',
    falModelId: 'fal-ai/flux/dev/inpainting',
    tier: 'standard',
    providerCostUsd: 0.02,
    fiatPriceUsd: withFiatMargin(0.02),
    loarPriceUsd: withLoarMargin(0.02),
    creditCost: usdToLoar(withFiatMargin(0.02)),
    isEnabled: true,
    supportsVideo: false,
    supportsImage: true,
    tags: ['inpaint', 'edit', 'region', 'replace'],
    bestFor: 'Replace objects or areas in video frames',
  },

  // ── Background Removal ───────────────────────────────────────────────
  {
    id: 'remove-bg-birefnet',
    operation: 'remove_bg',
    provider: 'fal',
    displayName: 'BiRefNet Background Removal',
    shortDescription: 'Remove or replace video/image backgrounds',
    falModelId: 'fal-ai/birefnet',
    tier: 'fast',
    providerCostUsd: 0.005,
    fiatPriceUsd: withFiatMargin(0.005),
    loarPriceUsd: withLoarMargin(0.005),
    creditCost: usdToLoar(withFiatMargin(0.005)),
    isEnabled: true,
    supportsVideo: false,
    supportsImage: true,
    tags: ['background', 'remove', 'mask', 'segment'],
    bestFor: 'Clean background removal for compositing',
  },

  // ── Video Extension ──────────────────────────────────────────────────
  {
    id: 'extend-wan',
    operation: 'extend',
    provider: 'fal',
    displayName: 'WAN Video Extend',
    shortDescription: 'Extend a video clip by generating continuation frames',
    falModelId: 'fal-ai/wan/v2.1/image-to-video',
    tier: 'standard',
    providerCostUsd: 0.08,
    fiatPriceUsd: withFiatMargin(0.08),
    loarPriceUsd: withLoarMargin(0.08),
    creditCost: usdToLoar(withFiatMargin(0.08)),
    isEnabled: true,
    supportsVideo: true,
    supportsImage: false,
    tags: ['extend', 'continuation', 'longer', 'video'],
    bestFor: 'Extend clips by generating continuation from last frame',
  },
];

// ── Lookup helpers ──────────────────────────────────────────────────────

export function getEditingModelById(id: string): EditingModelConfig | undefined {
  return EDITING_MODELS.find((m) => m.id === id);
}

export function getEditingModelsForOperation(op: EditingOperation): EditingModelConfig[] {
  return EDITING_MODELS.filter((m) => m.operation === op && m.isEnabled);
}

export function getEnabledEditingModels(): EditingModelConfig[] {
  return EDITING_MODELS.filter((m) => m.isEnabled);
}

export function getDefaultModelForOperation(op: EditingOperation): EditingModelConfig | undefined {
  const models = getEditingModelsForOperation(op);
  // Prefer 'standard' tier, then 'fast', then 'quality'
  return (
    models.find((m) => m.tier === 'standard') || models.find((m) => m.tier === 'fast') || models[0]
  );
}
