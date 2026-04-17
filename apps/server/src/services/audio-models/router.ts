/**
 * Audio Model Routing Engine
 *
 * Selects the best audio model based on generation parameters,
 * cost preferences, and provider health.
 */
import type {
  RoutingDecision,
  RoutingInput,
  RoutingReasonCode,
  AudioModelConfig,
  QualityTier,
} from './types';
import { getModelsForMode, getModelById } from './registry';

// ── Provider Health ──────────────────────────────────────────────────
// Threshold-based: provider is only marked unhealthy after multiple
// failures within a sliding window.

const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 2 * 60 * 1000;
const RECOVERY_MS = 5 * 60 * 1000;

interface ProviderHealthState {
  failures: number[];
  markedUnhealthyAt: number | null;
}

const providerHealth: Map<string, ProviderHealthState> = new Map();

function getOrCreateState(provider: string): ProviderHealthState {
  let state = providerHealth.get(provider);
  if (!state) {
    state = { failures: [], markedUnhealthyAt: null };
    providerHealth.set(provider, state);
  }
  return state;
}

export function markProviderUnhealthy(provider: string): void {
  const state = getOrCreateState(provider);
  const now = Date.now();
  state.failures.push(now);
  state.failures = state.failures.filter((t) => now - t < FAILURE_WINDOW_MS);
  if (state.failures.length >= FAILURE_THRESHOLD && !state.markedUnhealthyAt) {
    state.markedUnhealthyAt = now;
    console.warn(
      `[ProviderHealth] ${provider} marked unhealthy after ${state.failures.length} failures in ${FAILURE_WINDOW_MS / 1000}s`
    );
  }
}

export function markProviderHealthy(provider: string): void {
  const state = getOrCreateState(provider);
  state.failures = [];
  state.markedUnhealthyAt = null;
}

function isProviderHealthy(provider: string): boolean {
  const state = providerHealth.get(provider);
  if (!state || !state.markedUnhealthyAt) return true;
  if (Date.now() - state.markedUnhealthyAt > RECOVERY_MS) {
    state.markedUnhealthyAt = null;
    state.failures = [];
    return true;
  }
  return false;
}

// ── Scoring Helpers ──────────────────────────────────────────────────

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

// ── Filter Models ────────────────────────────────────────────────────

function filterEligibleModels(models: AudioModelConfig[], input: RoutingInput): AudioModelConfig[] {
  return models.filter((m) => {
    if (!m.mode.includes(input.mode)) return false;
    if (!m.isEnabled) return false;
    if (input.durationSec > m.maxDurationSec) return false;
    if (!isProviderHealthy(m.provider)) return false;
    return true;
  });
}

// ── Score Models ─────────────────────────────────────────────────────

function scoreModel(model: AudioModelConfig, input: RoutingInput): number {
  let score = 0;

  // Quality alignment
  const targetQuality = input.qualityTarget ?? 'standard';
  const qDiff = Math.abs(qualityScore[model.qualityTier] - qualityScore[targetQuality]);
  score += (3 - qDiff) * 10;

  // Cost preference
  if (input.costBudget === 'low') {
    score += costScore[model.priceTier] * 5;
  } else if (input.costBudget === 'medium') {
    score += costScore[model.priceTier] * 3;
  }

  // Speed preference
  if (input.latencyPreference === 'fast') {
    score += speedScore[model.speedTier] * 5;
  } else if (input.latencyPreference === 'quality') {
    score += qualityScore[model.qualityTier] * 5;
  } else {
    score += speedScore[model.speedTier] * 2 + qualityScore[model.qualityTier] * 2;
  }

  return score;
}

// ── Route Model ──────────────────────────────────────────────────────

export function routeModel(input: RoutingInput): RoutingDecision {
  const allModels = getModelsForMode(input.mode);
  const eligible = filterEligibleModels(allModels, input);

  if (eligible.length === 0) {
    // Fallback to first enabled model regardless of constraints
    const fallback = allModels.find((m) => m.isEnabled);
    if (!fallback) throw new Error('No audio models available');

    return {
      chosenModelId: fallback.id,
      reasonCode: 'provider_unavailable_fallback',
      providerCostUsd: fallback.providerCostUsd,
      fiatPriceUsd: fallback.fiatPriceUsd,
      loarPriceUsd: fallback.loarPriceUsd,
      creditCost: fallback.creditCost,
      fallbackModelIds: [],
    };
  }

  // Score and sort
  const scored = eligible
    .map((m) => ({ model: m, score: scoreModel(m, input) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0].model;
  const fallbacks = scored.slice(1, 3).map((s) => s.model.id);

  let reasonCode: RoutingReasonCode = 'default_model';
  if (input.costBudget === 'low') reasonCode = 'cheapest_eligible';
  else if (input.latencyPreference === 'fast') reasonCode = 'fastest_eligible';
  else if (input.qualityTarget === 'premium') reasonCode = 'best_quality_eligible';

  return {
    chosenModelId: best.id,
    reasonCode,
    providerCostUsd: best.providerCostUsd,
    fiatPriceUsd: best.fiatPriceUsd,
    loarPriceUsd: best.loarPriceUsd,
    creditCost: best.creditCost,
    fallbackModelIds: fallbacks,
  };
}

export function validateManualSelection(modelId: string): AudioModelConfig {
  const model = getModelById(modelId);
  if (!model) throw new Error(`Unknown audio model: ${modelId}`);
  if (!model.isEnabled) throw new Error(`Audio model ${modelId} is currently disabled`);
  if (!isProviderHealthy(model.provider)) {
    throw new Error(`Provider ${model.provider} is temporarily unavailable`);
  }
  return model;
}
