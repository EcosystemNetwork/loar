/**
 * Transcription model router — picks the model to use for a transcription
 * call given the caller's requirements and preferences.
 *
 * In manual mode (`requestedModelId` set), the requested model is
 * validated against capability + plan + provider-availability filters and
 * returned, or a descriptive error is thrown.
 *
 * In auto mode (no requestedModelId), eligible models are filtered by
 * capability requirements + plan + provider-availability, then ranked by
 * the chosen preference (`costBudget` / `latencyPreference` /
 * `qualityTarget`).
 */
import { TRPCError } from '@trpc/server';
import { TRANSCRIPTION_MODELS } from './registry';
import type {
  RoutingDecision,
  RoutingInput,
  TranscriptionModelConfig,
  RoutingReasonCode,
} from './types';

function eligibleFor(model: TranscriptionModelConfig, input: RoutingInput): boolean {
  if (!model.isEnabled) return false;
  if (input.requires?.wordTimings && !model.supportsWordTimings) return false;
  if (input.requires?.diarize && !model.supportsDiarize) return false;
  if (input.requires?.translate && !model.supportsTranslate) return false;
  if (
    model.allowedPlans.length > 0 &&
    input.userPlan &&
    !model.allowedPlans.includes(input.userPlan)
  ) {
    return false;
  }
  // If the server has no pooled key for this provider, the only way to
  // dispatch is via the caller's BYOK key.
  if (!model.serverPoolAvailable && !(input.byokProviders ?? []).includes(model.provider)) {
    return false;
  }
  return true;
}

function decisionFor(
  model: TranscriptionModelConfig,
  reasonCode: RoutingReasonCode,
  fallbacks: TranscriptionModelConfig[]
): RoutingDecision {
  return {
    chosenModelId: model.id,
    reasonCode,
    providerCostUsdPerMinute: model.providerCostUsdPerMinute,
    fiatPriceUsdPerMinute: model.fiatPriceUsdPerMinute,
    loarPriceUsdPerMinute: model.loarPriceUsdPerMinute,
    creditCostPerMinute: model.creditCostPerMinute,
    fallbackModelIds: fallbacks.map((m) => m.id),
  };
}

export function routeTranscriptionModel(input: RoutingInput): RoutingDecision {
  // ── Manual selection ────────────────────────────────────────────────
  if (input.requestedModelId) {
    const model = TRANSCRIPTION_MODELS.find((m) => m.id === input.requestedModelId);
    if (!model) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unknown transcription model: ${input.requestedModelId}`,
      });
    }
    if (!eligibleFor(model, input)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Model ${model.id} is not eligible for this request (check plan, capability requirements, or BYOK key).`,
      });
    }
    return decisionFor(model, 'manual_user_selection', []);
  }

  // ── Auto selection ──────────────────────────────────────────────────
  const eligible = TRANSCRIPTION_MODELS.filter((m) => eligibleFor(m, input));
  if (eligible.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'No transcription model satisfies the requested capabilities. Add a BYOK key or relax requirements (wordTimings/diarize/translate).',
    });
  }

  const ranked = [...eligible].sort((a, b) => rank(a, input) - rank(b, input));
  const [chosen, ...fallbacks] = ranked;
  const reasonCode: RoutingReasonCode =
    input.costBudget === 'low'
      ? 'cheapest_eligible'
      : input.latencyPreference === 'fast'
        ? 'fastest_eligible'
        : input.qualityTarget === 'premium'
          ? 'best_quality_eligible'
          : 'default_model';
  return decisionFor(chosen, reasonCode, fallbacks);
}

const QUALITY_RANK: Record<string, number> = { draft: 2, standard: 1, premium: 0 };
const SPEED_RANK: Record<string, number> = { fast: 0, medium: 1, slow: 2 };
const PRICE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

function rank(model: TranscriptionModelConfig, input: RoutingInput): number {
  if (input.costBudget === 'low') return PRICE_RANK[model.priceTier];
  if (input.latencyPreference === 'fast') return SPEED_RANK[model.speedTier];
  if (input.qualityTarget === 'premium') return QUALITY_RANK[model.qualityTier];
  // Default: prefer cheapest, then fastest, then standard quality.
  return (
    PRICE_RANK[model.priceTier] * 10 +
    SPEED_RANK[model.speedTier] * 3 +
    QUALITY_RANK[model.qualityTier]
  );
}
