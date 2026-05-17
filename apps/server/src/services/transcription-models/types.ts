/**
 * Shared types for transcription / caption model routing.
 *
 * Mirrors `audio-models/types.ts` but priced per minute of input audio
 * (not per second of generated output). Adds capability flags so the
 * router can grey out models that don't support what the caller asked
 * for (word-level timings, speaker diarization, in-flight translation).
 */

export type QualityTier = 'draft' | 'standard' | 'premium';
export type SpeedTier = 'fast' | 'medium' | 'slow';
export type PriceTier = 'low' | 'medium' | 'high';

export interface TranscriptionModelConfig {
  id: string;
  provider: string; // 'fal' | 'assemblyai' | 'deepgram' | 'groq' | ...
  displayName: string;
  shortDescription: string;
  /** Provider-side identifier (e.g. fal model slug, AAI version tag). */
  providerModelId: string;

  // ── Capabilities ──────────────────────────────────────────────────
  /** Returns per-word start/end timestamps via forced alignment. */
  supportsWordTimings: boolean;
  /** Tags each segment/word with a speaker label. */
  supportsDiarize: boolean;
  /** Can translate the transcript into a target language in one pass. */
  supportsTranslate: boolean;
  /** ISO-639-1 codes the model accepts as `language`. Empty array = "auto". */
  supportedLanguages: string[];
  /** Max input duration the provider accepts (single call). */
  maxAudioMinutes: number;

  // ── Tiers ─────────────────────────────────────────────────────────
  qualityTier: QualityTier;
  speedTier: SpeedTier;
  priceTier: PriceTier;

  // ── Pricing (per minute of input audio) ──────────────────────────
  /** What we pay the provider per minute of audio. */
  providerCostUsdPerMinute: number;
  /** providerCostUsdPerMinute × FIAT_MARGIN. Display price. */
  fiatPriceUsdPerMinute: number;
  /** providerCostUsdPerMinute × LOAR_MARGIN. */
  loarPriceUsdPerMinute: number;
  /** Credit cost per minute of input audio. */
  creditCostPerMinute: number;
  /** Last manual verification of the provider price. ISO date string. */
  lastVerified: string;

  // ── Gating ────────────────────────────────────────────────────────
  isEnabled: boolean;
  isVisibleToUsers: boolean;
  /** Empty = available to all plans. */
  allowedPlans: string[];
  /**
   * Server-pool key availability. If false, this (model, provider) pair
   * is only usable when the user has supplied their own API key via the
   * BYOK system.
   */
  serverPoolAvailable: boolean;

  tags: string[];
  bestFor: string;
}

// ── Routing ───────────────────────────────────────────────────────────

export type RoutingMode = 'auto' | 'manual';

export type RoutingReasonCode =
  | 'default_model'
  | 'manual_user_selection'
  | 'cheapest_eligible'
  | 'fastest_eligible'
  | 'best_quality_eligible'
  | 'capability_filter';

export interface RoutingDecision {
  chosenModelId: string;
  reasonCode: RoutingReasonCode;
  providerCostUsdPerMinute: number;
  fiatPriceUsdPerMinute: number;
  loarPriceUsdPerMinute: number;
  creditCostPerMinute: number;
  fallbackModelIds: string[];
}

export interface RoutingInput {
  /** Caller-supplied model id; when set, the router validates and returns it. */
  requestedModelId?: string;
  /** Capability requirements — models lacking any are filtered out. */
  requires?: {
    wordTimings?: boolean;
    diarize?: boolean;
    translate?: boolean;
  };
  qualityTarget?: QualityTier;
  costBudget?: 'low' | 'medium' | 'any';
  latencyPreference?: 'fast' | 'balanced' | 'quality';
  /** User's subscription plan, for `allowedPlans` filtering. */
  userPlan?: string;
  /**
   * Set of providers the caller already holds a BYOK key for; models
   * whose only path is BYOK become eligible when their provider is here.
   */
  byokProviders?: string[];
}

// ── Audit row (matches PRD `modelCallAudit` shape) ────────────────────

export interface ModelCallAuditRow {
  userId: string;
  modelId: string;
  provider: string;
  byok: boolean;
  units: number;
  unitKind: 'minute';
  usd: number;
  credits: number;
  latencyMs: number;
  success: boolean;
  errorClass: string | null;
  createdAt: Date;
}
