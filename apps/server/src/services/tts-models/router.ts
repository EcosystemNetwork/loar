/**
 * TTS model router — picks the model to synthesize speech given the
 * caller's voice/language/latency/cost preferences.
 *
 * Mirrors the transcription router: manual mode (requestedModelId) goes
 * through capability + BYOK filters; auto mode ranks eligible models by
 * the chosen preference axis.
 */
import { TRPCError } from '@trpc/server';
import { TTS_MODELS } from './registry';
import type { TtsModelConfig, TtsRoutingDecision, TtsRoutingInput } from './types';

function eligible(model: TtsModelConfig, input: TtsRoutingInput): boolean {
  if (!model.isEnabled) return false;
  if (input.language) {
    // Empty supportedLanguages = all languages (or English-only when the
    // provider hides it behind the model entry's `tags`).
    if (model.supportedLanguages.length > 0 && !model.supportedLanguages.includes(input.language)) {
      return false;
    }
  }
  if (input.voiceId) {
    if (model.voices.length > 0 && !model.voices.some((v) => v.id === input.voiceId)) {
      return false;
    }
  }
  if (
    model.allowedPlans.length > 0 &&
    input.userPlan &&
    !model.allowedPlans.includes(input.userPlan)
  ) {
    return false;
  }
  if (!model.serverPoolAvailable && !(input.byokProviders ?? []).includes(model.provider)) {
    return false;
  }
  return true;
}

function decisionFor(
  model: TtsModelConfig,
  reasonCode: TtsRoutingDecision['reasonCode'],
  fallbacks: TtsModelConfig[]
): TtsRoutingDecision {
  return {
    chosenModelId: model.id,
    reasonCode,
    providerCostUsdPerMillionChars: model.providerCostUsdPerMillionChars,
    fiatPriceUsdPerMillionChars: model.fiatPriceUsdPerMillionChars,
    loarPriceUsdPerMillionChars: model.loarPriceUsdPerMillionChars,
    creditCostPer1kChars: model.creditCostPer1kChars,
    fallbackModelIds: fallbacks.map((m) => m.id),
  };
}

const QUALITY_RANK: Record<string, number> = { draft: 2, standard: 1, premium: 0 };
const SPEED_RANK: Record<string, number> = { fast: 0, medium: 1, slow: 2 };
const PRICE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

function rank(model: TtsModelConfig, input: TtsRoutingInput): number {
  if (input.costBudget === 'low') return PRICE_RANK[model.priceTier];
  if (input.latencyPreference === 'fast') return SPEED_RANK[model.speedTier];
  if (input.qualityTarget === 'premium') return QUALITY_RANK[model.qualityTier];
  return (
    PRICE_RANK[model.priceTier] * 10 +
    SPEED_RANK[model.speedTier] * 3 +
    QUALITY_RANK[model.qualityTier]
  );
}

export function routeTtsModel(input: TtsRoutingInput): TtsRoutingDecision {
  if (input.requestedModelId) {
    const model = TTS_MODELS.find((m) => m.id === input.requestedModelId);
    if (!model) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unknown TTS model: ${input.requestedModelId}`,
      });
    }
    if (!eligible(model, input)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `TTS model ${model.id} is not eligible (check plan, language, voice, or BYOK key).`,
      });
    }
    if (input.voiceId) {
      return decisionFor(model, 'voice_locked', []);
    }
    return decisionFor(model, 'manual_user_selection', []);
  }

  const filtered = TTS_MODELS.filter((m) => eligible(m, input));
  if (filtered.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'No TTS model satisfies the requested constraints. Add a BYOK key or relax language/voice.',
    });
  }

  const ranked = [...filtered].sort((a, b) => rank(a, input) - rank(b, input));
  const [chosen, ...fallbacks] = ranked;
  const reasonCode: TtsRoutingDecision['reasonCode'] =
    input.costBudget === 'low'
      ? 'cheapest_eligible'
      : input.latencyPreference === 'fast'
        ? 'fastest_eligible'
        : input.qualityTarget === 'premium'
          ? 'best_quality_eligible'
          : 'default_model';
  return decisionFor(chosen, reasonCode, fallbacks);
}
