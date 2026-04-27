/**
 * Shared types for Video Model Routing and Generation
 */

// ── Model Registry Types ──────────────────────────────────────────────

export type VideoGenerationMode = 'text_to_video' | 'image_to_video';
export type QualityTier = 'draft' | 'standard' | 'premium';
export type SpeedTier = 'fast' | 'medium' | 'slow';
export type PriceTier = 'low' | 'medium' | 'high';

export interface VideoModelConfig {
  id: string;
  provider: string; // 'fal' | 'bytedance'
  displayName: string;
  shortDescription: string;
  falModelId: string; // FAL model ID (used when provider='fal')
  bytedanceModelId?: string; // ModelArk model ID (used when provider='bytedance')
  zaiModelId?: string; // Z.AI model id (used when provider='zai'), e.g. 'cogvideox-3'
  mode: VideoGenerationMode[];
  qualityTier: QualityTier;
  speedTier: SpeedTier;
  priceTier: PriceTier;
  supportsAudio: boolean;
  supports1080p: boolean;
  supports4k: boolean;
  maxDurationSec: number;
  supportedDurations: number[];
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  creditCost: number; // internal credits consumed per generation
  providerCostUsd: number; // actual cost to platform from provider
  fiatPriceUsd: number; // price at 35% margin (card/crypto)
  loarPriceUsd: number; // price at 25% margin ($LOAR payments)
  isEnabled: boolean;
  isVisibleToUsers: boolean;
  allowedPlans: string[]; // empty = all plans
  tags: string[];
  bestFor: string;
}

// ── Routing Types ─────────────────────────────────────────────────────

export type RoutingMode = 'auto' | 'manual';

export type RoutingReasonCode =
  | 'default_draft_model'
  | 'premium_final_render'
  | 'cheapest_eligible'
  | 'fastest_eligible'
  | 'best_quality_eligible'
  | 'provider_unavailable_fallback'
  | 'user_plan_restriction'
  | 'universe_preference_applied'
  | 'manual_user_selection';

export interface RoutingDecision {
  chosenModelId: string;
  reasonCode: RoutingReasonCode;
  providerCostUsd: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  creditCost: number;
  fallbackModelIds: string[];
}

export interface RoutingInput {
  mode: VideoGenerationMode;
  durationSec: number;
  resolution: string;
  audio: boolean;
  userPlan?: string;
  universeId?: string;
  universePreferredModel?: string;
  qualityTarget?: QualityTier;
  costBudget?: 'low' | 'medium' | 'any';
  latencyPreference?: 'fast' | 'balanced' | 'quality';
}

// ── Generation Request/Record Types ───────────────────────────────────

export interface CreateVideoGenerationRequest {
  prompt: string;
  imageUrl?: string;
  mode: VideoGenerationMode;
  durationSec: number;
  resolution: string;
  aspectRatio?: string;
  audio?: boolean;
  routingMode: RoutingMode;
  selectedModelId?: string;
  allowFallback?: boolean;
  universeId?: string;
  negativePrompt?: string;
  // Model-specific params
  motionStrength?: number;
  cfgScale?: number;
  enablePromptExpansion?: boolean;
}

export interface VideoGenerationRecord {
  id: string;
  userId: string;
  universeId?: string;
  routingMode: RoutingMode;
  requestedModelId?: string;
  finalModelId: string;
  fallbackModelId?: string;
  provider: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  prompt: string;
  mode: VideoGenerationMode;
  durationSec: number;
  resolution: string;
  aspectRatio?: string;
  providerCostUsd: number;
  actualProviderCostUsd?: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  creditsCharged: number;
  paymentMethod?: 'fiat' | 'crypto' | 'loar' | 'credits';
  marginUsd: number;
  latencyMs?: number;
  videoUrl?: string;
  failureReason?: string;
  routingReasonCode: RoutingReasonCode;
  createdAt: Date;
  completedAt?: Date;
}
