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
  | 'extend'
  | 'relight';

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

export type InpaintMode = 'replace' | 'remove' | 'add' | 'fix';

export interface EditingJobRecord {
  id: string;
  userId: string;
  operation: EditingOperation;
  modelId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  inputUrl: string;
  outputUrl?: string;
  prompt?: string;
  negativePrompt?: string;
  maskUrl?: string;
  /** Inpaint action mode — only applies when operation === 'inpaint' */
  mode?: InpaintMode;
  /** Seed used for generation (for reproducibility) */
  seed?: number;
  providerCostUsd: number;
  creditsCharged: number;
  latencyMs?: number;
  failureReason?: string;
  createdAt: Date;
  completedAt?: Date;
  /** Source generation ID if editing from a previous generation */
  sourceGenerationId?: string;
  /** Gallery content doc ID created by publishToGallery (if any) */
  galleryContentId?: string;
  /** Source media attachment ID — set when relight chains a new variant */
  sourceAttachmentId?: string;
  /** Preset IDs that were composed into the relight prompt */
  presetIds?: string[];
  /** Tone pack ID applied during relight (if any) */
  tonePackId?: string;
  /** Universe address scoped to this job (for tone pack application) */
  universeAddress?: string;
}
