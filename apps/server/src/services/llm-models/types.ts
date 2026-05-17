/**
 * LLM model registry types.
 *
 * Covers chat, reasoning, and vision-multimodal models. Pricing is
 * per-million-tokens (input / cached-input / output) — the dominant
 * billing shape across OpenAI, Google, Z.AI, Doubao, Groq.
 */

export type QualityTier = 'draft' | 'standard' | 'premium';
export type SpeedTier = 'fast' | 'medium' | 'slow';
export type PriceTier = 'low' | 'medium' | 'high';

export type LlmCapability =
  | 'chat'
  | 'reasoning'
  | 'vision'
  | 'tools'
  | 'json_mode'
  | 'structured_outputs'
  | 'web_search'
  | 'long_context';

export interface LlmModelConfig {
  id: string;
  provider: 'openai' | 'google' | 'zai' | 'bytedance' | 'groq' | 'anthropic-via-aai';

  displayName: string;
  shortDescription: string;

  /** Provider-side identifier (passed to the SDK / API). */
  providerModelId: string;

  /** Maximum context window in tokens. */
  contextTokens: number;
  /** Maximum output tokens per response (`null` if same as contextTokens). */
  maxOutputTokens: number | null;

  capabilities: LlmCapability[];

  // ── Tiers ─────────────────────────────────────────────────────────
  qualityTier: QualityTier;
  speedTier: SpeedTier;
  priceTier: PriceTier;

  // ── Pricing (USD per million tokens) ─────────────────────────────
  providerInputUsdPerMtok: number;
  providerCachedInputUsdPerMtok: number;
  providerOutputUsdPerMtok: number;
  /** Customer-facing fiat price per Mtok (input). */
  fiatInputUsdPerMtok: number;
  fiatOutputUsdPerMtok: number;
  /** $LOAR-paid price per Mtok (input). */
  loarInputUsdPerMtok: number;
  loarOutputUsdPerMtok: number;
  /** Credit charge per 1k tokens (input).  Output is typically 4× input. */
  creditCostPer1kInputTokens: number;
  creditCostPer1kOutputTokens: number;
  lastVerified: string;

  // ── Gating ─────────────────────────────────────────────────────────
  isEnabled: boolean;
  isVisibleToUsers: boolean;
  allowedPlans: string[];
  serverPoolAvailable: boolean;

  tags: string[];
  bestFor: string;
}

export interface LlmRoutingInput {
  requestedModelId?: string;
  /** Capabilities that the call REQUIRES — models lacking any are filtered out. */
  requires?: Partial<Record<LlmCapability, boolean>>;
  /** Minimum context size in tokens. */
  minContextTokens?: number;
  qualityTarget?: QualityTier;
  costBudget?: 'low' | 'medium' | 'any';
  latencyPreference?: 'fast' | 'balanced' | 'quality';
  userPlan?: string;
  byokProviders?: string[];
}

export interface LlmRoutingDecision {
  chosenModelId: string;
  reasonCode:
    | 'default_model'
    | 'cheapest_eligible'
    | 'fastest_eligible'
    | 'best_quality_eligible'
    | 'capability_filter'
    | 'manual_user_selection';
  providerInputUsdPerMtok: number;
  providerOutputUsdPerMtok: number;
  fiatInputUsdPerMtok: number;
  fiatOutputUsdPerMtok: number;
  loarInputUsdPerMtok: number;
  loarOutputUsdPerMtok: number;
  creditCostPer1kInputTokens: number;
  creditCostPer1kOutputTokens: number;
  fallbackModelIds: string[];
}
