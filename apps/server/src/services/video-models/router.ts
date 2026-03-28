/**
 * Video Model Routing Engine v1
 *
 * Selects the best model based on generation parameters, user plan,
 * cost preferences, and provider health. Returns a routing decision
 * with reason codes and fallback list.
 */
import type {
  RoutingDecision,
  RoutingInput,
  RoutingReasonCode,
  VideoModelConfig,
  QualityTier,
} from './types';
import { getModelsForMode, getModelById } from './registry';

// ── Provider Health (in-memory, upgradeable to Redis/Firestore later) ─

const providerHealth: Map<string, { healthy: boolean; lastChecked: Date }> = new Map();

export function markProviderUnhealthy(provider: string): void {
  providerHealth.set(provider, { healthy: false, lastChecked: new Date() });
}

export function markProviderHealthy(provider: string): void {
  providerHealth.set(provider, { healthy: true, lastChecked: new Date() });
}

function isProviderHealthy(provider: string): boolean {
  const status = providerHealth.get(provider);
  if (!status) return true; // assume healthy if unknown
  // Auto-recover after 5 minutes
  if (!status.healthy && Date.now() - status.lastChecked.getTime() > 5 * 60 * 1000) {
    return true;
  }
  return status.healthy;
}

// ── Scoring Helpers ───────────────────────────────────────────────────

const qualityScore: Record<QualityTier, number> = {
  draft: 1,
  standard: 2,
  premium: 3,
};

const speedScore: Record<string, number> = {
  fast: 3,
  medium: 2,
  slow: 1,
};

const costScore: Record<string, number> = {
  low: 3,
  medium: 2,
  high: 1,
};

// ── Filter Models ─────────────────────────────────────────────────────

function filterEligibleModels(models: VideoModelConfig[], input: RoutingInput): VideoModelConfig[] {
  return models.filter((m) => {
    // Must support the generation mode
    if (!m.mode.includes(input.mode)) return false;

    // Must be enabled
    if (!m.isEnabled) return false;

    // Must support requested duration
    if (input.durationSec > m.maxDurationSec) return false;

    // Must support requested resolution (if specified)
    if (input.resolution && input.resolution !== 'auto') {
      if (m.supportedResolutions.length > 0 && !m.supportedResolutions.includes(input.resolution)) {
        return false;
      }
    }

    // Audio requirement
    if (input.audio && !m.supportsAudio) return false;

    // Provider health
    if (!isProviderHealthy(m.provider)) return false;

    // Plan restrictions
    if (m.allowedPlans.length > 0 && input.userPlan) {
      if (!m.allowedPlans.includes(input.userPlan)) return false;
    }

    // Quality floor
    if (input.qualityTarget) {
      if (qualityScore[m.qualityTier] < qualityScore[input.qualityTarget]) return false;
    }

    // Cost ceiling
    if (input.costBudget === 'low' && m.priceTier === 'high') return false;
    if (input.costBudget === 'medium' && m.priceTier === 'high') return false;

    return true;
  });
}

// ── Scoring ───────────────────────────────────────────────────────────

function scoreModel(model: VideoModelConfig, input: RoutingInput): number {
  let score = 0;

  // Base: balance of quality, speed, and cost
  const preference = input.latencyPreference || 'balanced';

  if (preference === 'fast') {
    score += speedScore[model.speedTier] * 3;
    score += costScore[model.priceTier] * 2;
    score += qualityScore[model.qualityTier] * 1;
  } else if (preference === 'quality') {
    score += qualityScore[model.qualityTier] * 3;
    score += speedScore[model.speedTier] * 1;
    score += costScore[model.priceTier] * 1;
  } else {
    // balanced (default) — favor cost efficiency
    score += qualityScore[model.qualityTier] * 2;
    score += speedScore[model.speedTier] * 2;
    score += costScore[model.priceTier] * 2;
  }

  // Bonus for audio support when audio is requested
  if (input.audio && model.supportsAudio) score += 2;

  // Bonus for 1080p when requested
  if (input.resolution === '1080p' && model.supports1080p) score += 1;

  // Universe preference bonus
  if (input.universePreferredModel && model.id === input.universePreferredModel) {
    score += 5;
  }

  return score;
}

// ── Main Router ───────────────────────────────────────────────────────

export function routeModel(input: RoutingInput): RoutingDecision {
  const allModels = getModelsForMode(input.mode);
  const eligible = filterEligibleModels(allModels, input);

  if (eligible.length === 0) {
    // Fallback: relax constraints and try again with all enabled models
    const relaxed = allModels.filter(
      (m) => m.isEnabled && m.mode.includes(input.mode) && isProviderHealthy(m.provider)
    );

    if (relaxed.length === 0) {
      // Last resort: use LTX for text or Wan for image
      const lastResortId = input.mode === 'text_to_video' ? 'ltx-video' : 'wan25-i2v';
      const lastResort = getModelById(lastResortId);
      if (lastResort) {
        return {
          chosenModelId: lastResort.id,
          reasonCode: 'provider_unavailable_fallback',
          providerCostUsd: lastResort.providerCostUsd,
          fiatPriceUsd: lastResort.fiatPriceUsd,
          loarPriceUsd: lastResort.loarPriceUsd,
          creditCost: lastResort.creditCost,
          fallbackModelIds: [],
        };
      }
      throw new Error('No video models available');
    }

    const scored = relaxed
      .map((m) => ({ model: m, score: scoreModel(m, input) }))
      .sort((a, b) => b.score - a.score);

    return {
      chosenModelId: scored[0].model.id,
      reasonCode: 'provider_unavailable_fallback',
      providerCostUsd: scored[0].model.providerCostUsd,
      fiatPriceUsd: scored[0].model.fiatPriceUsd,
      loarPriceUsd: scored[0].model.loarPriceUsd,
      creditCost: scored[0].model.creditCost,
      fallbackModelIds: scored.slice(1, 4).map((s) => s.model.id),
    };
  }

  // Score and sort eligible models
  const scored = eligible
    .map((m) => ({ model: m, score: scoreModel(m, input) }))
    .sort((a, b) => b.score - a.score);

  const chosen = scored[0].model;

  // Determine reason code
  let reasonCode: RoutingReasonCode = 'default_draft_model';
  if (input.universePreferredModel && chosen.id === input.universePreferredModel) {
    reasonCode = 'universe_preference_applied';
  } else if (input.latencyPreference === 'fast') {
    reasonCode = 'fastest_eligible';
  } else if (input.latencyPreference === 'quality') {
    reasonCode = 'best_quality_eligible';
  } else if (input.costBudget === 'low') {
    reasonCode = 'cheapest_eligible';
  } else if (chosen.qualityTier === 'premium') {
    reasonCode = 'premium_final_render';
  } else {
    reasonCode = 'default_draft_model';
  }

  return {
    chosenModelId: chosen.id,
    reasonCode,
    providerCostUsd: chosen.providerCostUsd,
    fiatPriceUsd: chosen.fiatPriceUsd,
    loarPriceUsd: chosen.loarPriceUsd,
    creditCost: chosen.creditCost,
    fallbackModelIds: scored.slice(1, 4).map((s) => s.model.id),
  };
}

/**
 * Route for manual selection — validates that the chosen model is eligible.
 */
export function validateManualSelection(
  modelId: string,
  input: RoutingInput
): { valid: boolean; reason?: string; suggestion?: string } {
  const model = getModelById(modelId);
  if (!model) {
    return { valid: false, reason: 'Model not found', suggestion: 'wan25-t2v' };
  }
  if (!model.isEnabled) {
    return { valid: false, reason: `${model.displayName} is currently disabled` };
  }
  if (!model.mode.includes(input.mode)) {
    const alternatives = getModelsForMode(input.mode);
    return {
      valid: false,
      reason: `${model.displayName} does not support ${input.mode.replace('_', '-')}`,
      suggestion: alternatives[0]?.id,
    };
  }
  if (!isProviderHealthy(model.provider)) {
    return {
      valid: false,
      reason: `${model.displayName} provider is temporarily unavailable`,
    };
  }
  if (
    model.allowedPlans.length > 0 &&
    input.userPlan &&
    !model.allowedPlans.includes(input.userPlan)
  ) {
    return {
      valid: false,
      reason: `${model.displayName} requires a higher plan`,
    };
  }
  if (input.durationSec > model.maxDurationSec) {
    return {
      valid: false,
      reason: `${model.displayName} supports max ${model.maxDurationSec}s (requested ${input.durationSec}s)`,
    };
  }

  return { valid: true };
}
