/**
 * Image Model Routing Engine
 *
 * Selects the best image model based on task, quality preferences,
 * cost budget, and provider health. Mirrors the video routing engine.
 */
import type {
  ImageModelConfig,
  ImageRoutingDecision,
  ImageRoutingInput,
  ImageRoutingReasonCode,
  QualityTier,
} from './types';
import { getImageModelsForTask, getImageModelById } from './registry';

// ── Provider Health (in-memory, same pattern as video router) ─────────

const providerHealth: Map<string, { healthy: boolean; lastChecked: Date }> = new Map();

export function markImageProviderUnhealthy(provider: string): void {
  providerHealth.set(provider, { healthy: false, lastChecked: new Date() });
}

export function markImageProviderHealthy(provider: string): void {
  providerHealth.set(provider, { healthy: true, lastChecked: new Date() });
}

function isProviderHealthy(provider: string): boolean {
  const status = providerHealth.get(provider);
  if (!status) return true;
  if (!status.healthy && Date.now() - status.lastChecked.getTime() > 5 * 60 * 1000) return true;
  return status.healthy;
}

// ── Scoring ───────────────────────────────────────────────────────────

const qualityScore: Record<QualityTier, number> = { draft: 1, standard: 2, premium: 3 };
const speedScore: Record<string, number> = { fast: 3, medium: 2, slow: 1 };
const costScore: Record<string, number> = { low: 3, medium: 2, high: 1 };

function filterEligible(models: ImageModelConfig[], input: ImageRoutingInput): ImageModelConfig[] {
  return models.filter((m) => {
    if (!m.tasks.includes(input.task)) return false;
    if (!m.isEnabled) return false;
    if (!isProviderHealthy(m.provider)) return false;
    if (m.allowedPlans.length > 0 && input.userPlan && !m.allowedPlans.includes(input.userPlan))
      return false;
    if (input.qualityTarget && qualityScore[m.qualityTier] < qualityScore[input.qualityTarget])
      return false;
    if (input.costBudget === 'low' && m.priceTier === 'high') return false;
    if (input.costBudget === 'medium' && m.priceTier === 'high') return false;
    return true;
  });
}

function scoreModel(model: ImageModelConfig, input: ImageRoutingInput): number {
  let score = 0;
  const pref = input.latencyPreference || 'balanced';

  if (pref === 'fast') {
    score += speedScore[model.speedTier] * 3;
    score += costScore[model.priceTier] * 2;
    score += qualityScore[model.qualityTier] * 1;
  } else if (pref === 'quality') {
    score += qualityScore[model.qualityTier] * 3;
    score += speedScore[model.speedTier] * 1;
    score += costScore[model.priceTier] * 1;
  } else {
    score += qualityScore[model.qualityTier] * 2;
    score += speedScore[model.speedTier] * 2;
    score += costScore[model.priceTier] * 2;
  }

  if (input.universePreferredModel && model.id === input.universePreferredModel) score += 5;

  return score;
}

function toDecision(
  model: ImageModelConfig,
  reasonCode: ImageRoutingReasonCode,
  fallbacks: ImageModelConfig[]
): ImageRoutingDecision {
  return {
    chosenModelId: model.id,
    reasonCode,
    providerCostUsd: model.providerCostUsd,
    fiatPriceUsd: model.fiatPriceUsd,
    loarPriceUsd: model.loarPriceUsd,
    creditCostPerImage: model.creditCostPerImage,
    fallbackModelIds: fallbacks.map((m) => m.id),
  };
}

// ── Main Router ───────────────────────────────────────────────────────

export function routeImageModel(input: ImageRoutingInput): ImageRoutingDecision {
  const allModels = getImageModelsForTask(input.task);
  const eligible = filterEligible(allModels, input);

  if (eligible.length === 0) {
    // Relax constraints
    const relaxed = allModels.filter((m) => m.isEnabled && isProviderHealthy(m.provider));
    if (relaxed.length === 0) {
      const lastResort = getImageModelById('nano-banana');
      if (lastResort) return toDecision(lastResort, 'provider_unavailable_fallback', []);
      throw new Error('No image models available');
    }
    const scored = relaxed
      .map((m) => ({ model: m, score: scoreModel(m, input) }))
      .sort((a, b) => b.score - a.score);
    return toDecision(
      scored[0].model,
      'provider_unavailable_fallback',
      scored.slice(1, 3).map((s) => s.model)
    );
  }

  const scored = eligible
    .map((m) => ({ model: m, score: scoreModel(m, input) }))
    .sort((a, b) => b.score - a.score);

  const chosen = scored[0].model;

  let reasonCode: ImageRoutingReasonCode = 'default_draft_model';
  if (input.universePreferredModel && chosen.id === input.universePreferredModel) {
    reasonCode = 'universe_preference_applied';
  } else if (input.latencyPreference === 'fast') {
    reasonCode = 'fastest_eligible';
  } else if (input.latencyPreference === 'quality') {
    reasonCode = 'best_quality_eligible';
  } else if (input.costBudget === 'low') {
    reasonCode = 'cheapest_eligible';
  } else if (chosen.qualityTier === 'premium') {
    reasonCode = 'best_quality_eligible';
  }

  return toDecision(chosen, reasonCode, scored.slice(1, 3).map((s) => s.model));
}

export function validateImageModelSelection(
  modelId: string,
  input: ImageRoutingInput
): { valid: boolean; reason?: string; suggestion?: string } {
  const model = getImageModelById(modelId);
  if (!model) return { valid: false, reason: 'Model not found', suggestion: 'nano-banana' };
  if (!model.isEnabled)
    return { valid: false, reason: `${model.displayName} is currently disabled` };
  if (!model.tasks.includes(input.task))
    return {
      valid: false,
      reason: `${model.displayName} does not support ${input.task.replace('_', '-')}`,
      suggestion: 'nano-banana',
    };
  if (!isProviderHealthy(model.provider))
    return {
      valid: false,
      reason: `${model.displayName} provider is temporarily unavailable`,
    };
  if (
    model.allowedPlans.length > 0 &&
    input.userPlan &&
    !model.allowedPlans.includes(input.userPlan)
  )
    return { valid: false, reason: `${model.displayName} requires a higher plan` };
  return { valid: true };
}
