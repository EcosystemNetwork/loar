/**
 * Video Editing Models — Types
 *
 * Post-processing capabilities: upscale, frame interpolation,
 * video-to-video restyle, and inpainting.
 */

export type EditingOperation =
  | 'upscale'
  | 'interpolate'
  | 'restyle'
  | 'inpaint'
  | 'remove_bg'
  | 'extend';

export type EditingTier = 'fast' | 'standard' | 'quality';

export interface EditingModelConfig {
  id: string;
  operation: EditingOperation;
  provider: 'fal';
  displayName: string;
  shortDescription: string;
  falModelId: string;
  tier: EditingTier;
  providerCostUsd: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  creditCost: number;
  isEnabled: boolean;
  /** Max input resolution supported */
  maxInputResolution?: string;
  /** Output resolution (for upscale) */
  outputResolution?: string;
  /** Supports video input (vs image-only) */
  supportsVideo: boolean;
  /** Supports image input */
  supportsImage: boolean;
  tags: string[];
  bestFor: string;
}

export interface EditingJobRecord {
  id: string;
  userId: string;
  operation: EditingOperation;
  modelId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  inputUrl: string;
  outputUrl?: string;
  prompt?: string;
  maskUrl?: string;
  providerCostUsd: number;
  creditsCharged: number;
  latencyMs?: number;
  failureReason?: string;
  createdAt: Date;
  completedAt?: Date;
  /** Source generation ID if editing from a previous generation */
  sourceGenerationId?: string;
}
