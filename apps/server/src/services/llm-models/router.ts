/**
 * LLM model router — picks a chat/reasoning/vision model given the
 * caller's required capabilities, plan, BYOK keys, and cost/quality/
 * latency preferences.
 *
 * Mirrors the TTS + transcription routers. Use this instead of hardcoding
 * provider model IDs at call sites so cost-tier shifts can be done
 * registry-side.
 *
 * Typical usage:
 *
 *   const { chosenModelId } = routeLlmModel({
 *     requires: { vision: true, tools: true },
 *     minContextTokens: 32_000,
 *     costBudget: 'low',
 *     byokProviders: callerByokProviders,
 *   });
 *   const result = await dispatchLlm({ modelId: chosenModelId, ... });
 */
import { TRPCError } from '@trpc/server';
import { LLM_MODELS } from './registry';
import { llmRouterDecisionTotal } from '../cost-tracker';
import type { LlmCapability, LlmModelConfig, LlmRoutingDecision, LlmRoutingInput } from './types';

function meetsCapability(model: LlmModelConfig, cap: LlmCapability): boolean {
  return model.capabilities.includes(cap);
}

// Higher number = better quality. A `qualityTarget` of 'standard' admits
// 'standard' and 'premium' but excludes 'draft' models like glm-4.5-flash.
const QUALITY_FLOOR: Record<string, number> = { draft: 0, standard: 1, premium: 2 };

function eligible(model: LlmModelConfig, input: LlmRoutingInput): boolean {
  if (!model.isEnabled) return false;

  if (input.requires) {
    for (const [cap, required] of Object.entries(input.requires)) {
      if (required && !meetsCapability(model, cap as LlmCapability)) return false;
    }
  }

  if (input.minContextTokens != null && model.contextTokens < input.minContextTokens) {
    return false;
  }

  if (
    input.qualityTarget &&
    QUALITY_FLOOR[model.qualityTier] < QUALITY_FLOOR[input.qualityTarget]
  ) {
    return false;
  }

  if (
    model.allowedPlans.length > 0 &&
    input.userPlan &&
    !model.allowedPlans.includes(input.userPlan)
  ) {
    return false;
  }

  // Without a server-pool key the only dispatch path is the caller's BYOK.
  if (!model.serverPoolAvailable && !(input.byokProviders ?? []).includes(model.provider)) {
    return false;
  }

  return true;
}

function decisionFor(
  model: LlmModelConfig,
  reasonCode: LlmRoutingDecision['reasonCode'],
  fallbacks: LlmModelConfig[]
): LlmRoutingDecision {
  return {
    chosenModelId: model.id,
    reasonCode,
    providerInputUsdPerMtok: model.providerInputUsdPerMtok,
    providerOutputUsdPerMtok: model.providerOutputUsdPerMtok,
    fiatInputUsdPerMtok: model.fiatInputUsdPerMtok,
    fiatOutputUsdPerMtok: model.fiatOutputUsdPerMtok,
    loarInputUsdPerMtok: model.loarInputUsdPerMtok,
    loarOutputUsdPerMtok: model.loarOutputUsdPerMtok,
    creditCostPer1kInputTokens: model.creditCostPer1kInputTokens,
    creditCostPer1kOutputTokens: model.creditCostPer1kOutputTokens,
    fallbackModelIds: fallbacks.map((m) => m.id),
  };
}

const QUALITY_RANK: Record<string, number> = { draft: 2, standard: 1, premium: 0 };
const SPEED_RANK: Record<string, number> = { fast: 0, medium: 1, slow: 2 };
const PRICE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

// Cheap tiebreaker by exact input price — keeps the router from picking
// e.g. GPT-4.1-mini ($0.40 in) over Llama-3.1-8B ($0.05 in) just because
// they share priceTier='low'.
function inputCostBucket(model: LlmModelConfig): number {
  return model.providerInputUsdPerMtok;
}

function rank(model: LlmModelConfig, input: LlmRoutingInput): number {
  if (input.costBudget === 'low') {
    return PRICE_RANK[model.priceTier] * 100 + inputCostBucket(model);
  }
  if (input.latencyPreference === 'fast') return SPEED_RANK[model.speedTier];
  if (input.qualityTarget === 'premium') return QUALITY_RANK[model.qualityTier];
  // Balanced default: cheap > fast > quality.
  return (
    PRICE_RANK[model.priceTier] * 1000 +
    SPEED_RANK[model.speedTier] * 30 +
    QUALITY_RANK[model.qualityTier] * 1 +
    inputCostBucket(model) * 0.1
  );
}

export function routeLlmModel(input: LlmRoutingInput): LlmRoutingDecision {
  if (input.requestedModelId) {
    const model = LLM_MODELS.find((m) => m.id === input.requestedModelId);
    if (!model) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Unknown LLM model: ${input.requestedModelId}`,
      });
    }
    if (!eligible(model, input)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `LLM model ${model.id} is not eligible (check plan, capability requirements, context size, or BYOK key).`,
      });
    }
    return decisionFor(model, 'manual_user_selection', []);
  }

  const filtered = LLM_MODELS.filter((m) => eligible(m, input));
  if (filtered.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'No LLM model satisfies the requested constraints. Relax capability requirements, lower minContextTokens, or add a BYOK key.',
    });
  }

  const ranked = [...filtered].sort((a, b) => rank(a, input) - rank(b, input));
  const [chosen, ...fallbacks] = ranked;
  const reasonCode: LlmRoutingDecision['reasonCode'] =
    input.costBudget === 'low'
      ? 'cheapest_eligible'
      : input.latencyPreference === 'fast'
        ? 'fastest_eligible'
        : input.qualityTarget === 'premium'
          ? 'best_quality_eligible'
          : 'default_model';

  // Single line for log scrapers — grep for `[llm-router]` in prod to audit
  // which models the autoroute is landing on under different traffic shapes.
  if (process.env.LLM_ROUTER_LOG !== 'off') {
    console.info(
      `[llm-router] chose=${chosen.id} reason=${reasonCode} eligible=${filtered.length} costBudget=${input.costBudget ?? 'any'} quality=${input.qualityTarget ?? 'any'}`
    );
  }

  // Prometheus: graph autoroute drift, spot stuck providers, confirm
  // cost-tier flips translate to real call mix shifts.
  llmRouterDecisionTotal
    .labels(
      chosen.id,
      chosen.provider,
      reasonCode,
      input.costBudget ?? 'any',
      input.qualityTarget ?? 'any'
    )
    .inc();

  return decisionFor(chosen, reasonCode, fallbacks);
}
