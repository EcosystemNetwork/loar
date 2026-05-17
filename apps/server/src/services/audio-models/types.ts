/**
 * Shared types for Audio/Music Model Routing and Generation
 */

// ── Model Registry Types ──────────────────────────────────────────────

export type AudioGenerationMode = 'text_to_music' | 'text_to_sound';
export type QualityTier = 'draft' | 'standard' | 'premium';
export type SpeedTier = 'fast' | 'medium' | 'slow';
export type PriceTier = 'low' | 'medium' | 'high';

export interface AudioModelConfig {
  id: string;
  provider: string; // 'fal' | 'elevenlabs' | 'google' | 'bytedance' | 'zai'
  displayName: string;
  shortDescription: string;
  falModelId?: string;
  /** ElevenLabs `model_id` (e.g. `music_v1`). */
  elevenlabsModelId?: string;
  /** Google Gemini API model param (e.g. `lyria-3-pro-preview`). */
  googleModelId?: string;
  /** ByteDance ModelArk model param. */
  bytedanceModelId?: string;
  mode: AudioGenerationMode[];
  qualityTier: QualityTier;
  speedTier: SpeedTier;
  priceTier: PriceTier;
  maxDurationSec: number;
  supportedDurations: number[];
  creditCost: number;
  providerCostUsd: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  isEnabled: boolean;
  isVisibleToUsers: boolean;
  allowedPlans: string[];
  tags: string[];
  bestFor: string;
}

// ── Routing Types ─────────────────────────────────────────────────────

export type RoutingMode = 'auto' | 'manual';

export type RoutingReasonCode =
  | 'default_model'
  | 'cheapest_eligible'
  | 'fastest_eligible'
  | 'best_quality_eligible'
  | 'provider_unavailable_fallback'
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
  mode: AudioGenerationMode;
  durationSec: number;
  qualityTarget?: QualityTier;
  costBudget?: 'low' | 'medium' | 'any';
  latencyPreference?: 'fast' | 'balanced' | 'quality';
}

// ── Generation Record Types ───────────────────────────────────────────

export interface AudioGenerationRecord {
  id: string;
  userId: string;
  entityId?: string;
  universeId?: string;
  routingMode: RoutingMode;
  requestedModelId?: string;
  finalModelId: string;
  provider: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  prompt: string;
  mode: AudioGenerationMode;
  durationSec: number;
  genre?: string;
  style?: string;
  providerCostUsd: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  creditsCharged: number;
  marginUsd: number;
  latencyMs?: number;
  audioUrl?: string;
  permanentAudioUrl?: string;
  failureReason?: string;
  routingReasonCode: RoutingReasonCode;
  createdAt: Date;
  completedAt?: Date;
}
