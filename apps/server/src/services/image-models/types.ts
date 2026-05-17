/**
 * Shared types for Image Model Routing and Generation
 */

// ── Model Registry Types ──────────────────────────────────────────────

export type ImageGenerationTask = 'text_to_image' | 'image_to_image';
export type ImageSizePreset =
  | 'square_hd'
  | 'square'
  | 'portrait_4_3'
  | 'portrait_16_9'
  | 'landscape_4_3'
  | 'landscape_16_9';
export type QualityTier = 'draft' | 'standard' | 'premium';
export type SpeedTier = 'fast' | 'medium' | 'slow';
export type PriceTier = 'low' | 'medium' | 'high';

export interface ImageModelConfig {
  id: string;
  provider: 'fal' | 'comfyui' | 'bytedance' | 'google' | 'zai' | 'openai';
  displayName: string;
  shortDescription: string;
  falModelId?: string; // undefined for non-fal providers
  bytedanceModelId?: string; // ModelArk model ID (used when provider='bytedance')
  googleModelId?: string; // Google generativelanguage model id (used when provider='google')
  zaiModelId?: string; // Z.AI model id (used when provider='zai'), e.g. 'cogview-4'
  openaiModelId?: string; // OpenAI model id (used when provider='openai'), e.g. 'gpt-image-1.5'
  tasks: ImageGenerationTask[];
  qualityTier: QualityTier;
  speedTier: SpeedTier;
  priceTier: PriceTier;
  maxImages: number; // max images per request
  supportedSizes: ImageSizePreset[];
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  creditCostPerImage: number; // credits per single image
  providerCostUsd: number; // cost per image to platform
  fiatPriceUsd: number; // user price at 35% margin
  loarPriceUsd: number; // user price at 25% margin (LOAR payments)
  isEnabled: boolean;
  isVisibleToUsers: boolean;
  allowedPlans: string[]; // empty = all plans
  tags: string[];
  bestFor: string;
}

// ── Routing Types ─────────────────────────────────────────────────────

export type ImageRoutingReasonCode =
  | 'default_draft_model'
  | 'best_quality_eligible'
  | 'fastest_eligible'
  | 'cheapest_eligible'
  | 'provider_unavailable_fallback'
  | 'universe_preference_applied'
  | 'manual_user_selection';

export interface ImageRoutingInput {
  task: ImageGenerationTask;
  numImages?: number;
  qualityTarget?: QualityTier;
  costBudget?: 'low' | 'medium' | 'any';
  latencyPreference?: 'fast' | 'balanced' | 'quality';
  userPlan?: string;
  universePreferredModel?: string;
}

export interface ImageRoutingDecision {
  chosenModelId: string;
  reasonCode: ImageRoutingReasonCode;
  providerCostUsd: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  creditCostPerImage: number;
  fallbackModelIds: string[];
}

// ── Generation Record ─────────────────────────────────────────────────

export interface ImageGenerationRecord {
  id: string;
  userId: string;
  entityId?: string;
  universeId?: string;
  routingMode: 'auto' | 'manual';
  requestedModelId?: string;
  finalModelId: string;
  fallbackModelId?: string;
  provider: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  prompt: string;
  negativePrompt?: string;
  task: ImageGenerationTask;
  imageSize: ImageSizePreset;
  numImages: number;
  seed?: number;
  providerCostUsd: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  creditsCharged: number;
  marginUsd: number;
  latencyMs?: number;
  imageUrls?: string[];
  failureReason?: string;
  routingReasonCode: ImageRoutingReasonCode;
  createdAt: Date;
  completedAt?: Date;
}
