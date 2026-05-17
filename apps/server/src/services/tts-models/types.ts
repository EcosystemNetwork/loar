/**
 * TTS (text-to-speech) model registry types.
 *
 * Distinct from `audio-models` (music + SFX) and `transcription-models`
 * (STT). TTS pricing is per-million-characters in nearly every provider,
 * with a few outliers billed per-token of audio output (OpenAI realtime).
 */

export type QualityTier = 'draft' | 'standard' | 'premium';
export type SpeedTier = 'fast' | 'medium' | 'slow';
export type PriceTier = 'low' | 'medium' | 'high';

export interface TtsVoicePreset {
  /** Provider-specific voice identifier (`alloy`, `aura-2-thalia-en`, etc.). */
  id: string;
  /** Display name surfaced in UI. */
  name: string;
  /** ISO-639-1 primary language, or 'multi' when the voice is multilingual. */
  language: string;
  /** 'male' | 'female' | 'neutral' — heuristic for filter chips. */
  gender?: 'male' | 'female' | 'neutral';
  /** Free-form descriptor (e.g. "warm narrator", "newscast"). */
  style?: string;
}

export interface TtsModelConfig {
  id: string;
  provider: 'elevenlabs' | 'openai' | 'deepgram' | 'groq' | 'google' | 'zai' | 'bytedance' | 'fal';

  displayName: string;
  shortDescription: string;

  /** Provider-side identifier. Pass-through value when calling the SDK. */
  providerModelId: string;

  /** Approximate first-audio latency in milliseconds (0 if unknown). */
  firstAudioLatencyMs: number;

  /** Maximum characters per request, or `Infinity` when unbounded. */
  maxChars: number;

  /** Supported output audio container formats. */
  supportedFormats: Array<'mp3' | 'wav' | 'pcm' | 'opus' | 'flac' | 'mulaw' | 'aac'>;

  /** ISO-639-1 codes the model can speak (empty = English-only). */
  supportedLanguages: string[];

  /** Common voice presets to surface in the picker. */
  voices: TtsVoicePreset[];

  /** Some providers expose voice-design / instant-clone capability. */
  supportsVoiceClone: boolean;
  /** Lets caller steer emotion/style via natural-language instructions. */
  supportsStyleSteer: boolean;
  /** Available as a streaming endpoint (server-sent or websocket). */
  supportsStreaming: boolean;

  // ── Tiers ─────────────────────────────────────────────────────────
  qualityTier: QualityTier;
  speedTier: SpeedTier;
  priceTier: PriceTier;

  // ── Pricing (per million characters) ─────────────────────────────
  providerCostUsdPerMillionChars: number;
  fiatPriceUsdPerMillionChars: number;
  loarPriceUsdPerMillionChars: number;
  /** Credit cost charged per 1k chars (the unit our UI shows). */
  creditCostPer1kChars: number;
  lastVerified: string;

  // ── Gating ─────────────────────────────────────────────────────────
  isEnabled: boolean;
  isVisibleToUsers: boolean;
  allowedPlans: string[];
  /** Server-pool key present (false → BYOK-only). */
  serverPoolAvailable: boolean;

  tags: string[];
  bestFor: string;
}

export interface TtsRoutingInput {
  requestedModelId?: string;
  qualityTarget?: QualityTier;
  latencyPreference?: 'fast' | 'balanced' | 'quality';
  costBudget?: 'low' | 'medium' | 'any';
  language?: string;
  /** Pre-locked voice — narrows to providers that own this voice id. */
  voiceId?: string;
  userPlan?: string;
  byokProviders?: string[];
}

export interface TtsRoutingDecision {
  chosenModelId: string;
  reasonCode:
    | 'default_model'
    | 'cheapest_eligible'
    | 'fastest_eligible'
    | 'best_quality_eligible'
    | 'manual_user_selection'
    | 'voice_locked';
  providerCostUsdPerMillionChars: number;
  fiatPriceUsdPerMillionChars: number;
  loarPriceUsdPerMillionChars: number;
  creditCostPer1kChars: number;
  fallbackModelIds: string[];
}
