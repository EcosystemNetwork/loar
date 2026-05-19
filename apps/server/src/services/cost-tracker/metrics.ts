/**
 * Prometheus metrics for cost tracking.
 * Counters are additive — safe to emit on every record regardless of persistence.
 */

import { Counter, Gauge, Histogram } from 'prom-client';

export const providerCostUsdTotal = new Counter({
  name: 'loar_provider_cost_usd_total',
  help: 'USD cost of paid provider API calls, attributed by provider/kind/model.',
  labelNames: ['provider', 'kind', 'model'] as const,
});

export const providerTokensTotal = new Counter({
  name: 'loar_provider_tokens_total',
  help: 'Input + output tokens billed by the provider.',
  labelNames: ['provider', 'kind', 'model', 'direction'] as const,
});

// LLM router decisions: lets ops graph autoroute drift over time, spot
// providers that suddenly never win (key missing? all rate-limited?), and
// confirm that cost-tier flips translate into real call mix shifts.
//
// Cardinality intentionally kept small (~30 models × 5 reasons × 3 budgets ≈ 450
// active series). `quality_target` was dropped: it's coarse and was often
// undefined, contributing cardinality without much signal — `reason_code`
// already captures intent (cheapest_eligible / best_quality_eligible / …).
export const llmRouterDecisionTotal = new Counter({
  name: 'loar_llm_router_decision_total',
  help: 'Count of routeLlmModel decisions, labelled by chosen model + provider + reason + cost budget.',
  labelNames: ['chosen_model', 'provider', 'reason_code', 'cost_budget'] as const,
});

// Per-provider dispatch latency. Buckets span 100ms → 5min to cover both
// fast chat (Groq, Gemini Flash) and slow video extraction (Gemini Pro,
// Sora). Use rate() / histogram_quantile() in PromQL for p50/p95/p99.
export const llmDispatchLatencySeconds = new Histogram({
  name: 'loar_llm_dispatch_latency_seconds',
  help: 'End-to-end dispatch latency in seconds, per provider/kind. Excludes router + rate-limit wait — measured around dispatchLlmInner only.',
  labelNames: ['provider', 'kind'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
});

// Fallback hops: every time dispatchLlmWithFallback walks past the primary
// to a fallback. Spike = provider degradation; sustained nonzero = the
// primary is genuinely overcommitted and needs cap tuning.
export const llmFallbackHopTotal = new Counter({
  name: 'loar_llm_fallback_hop_total',
  help: 'Count of fallback hops in dispatchLlmWithFallback, labelled by primary → fallback model.',
  labelNames: ['primary_model', 'fallback_model'] as const,
});

// Provider-call failure counter — emitted on EVERY failed attempt, including
// ones that were subsequently recovered by a fallback. Useful for per-provider
// health graphs but does NOT measure user-visible failures. For that, see
// `llmRequestFailureTotal` below. Reason label is coarse (paused, cap,
// rate_limit, timeout, auth, other) — see classifyDispatchError() in
// dispatch.ts for the mapping.
export const providerCallFailureTotal = new Counter({
  name: 'loar_provider_call_failure_total',
  help: 'Count of failed provider API attempts (includes those recovered by fallback).',
  labelNames: ['provider', 'kind', 'model', 'reason'] as const,
});

// User-visible request failures — fires once per dispatchLlmWithFallback call
// whose entire chain was exhausted. Divide by total LLM requests to get the
// real "the model layer let me down" rate. If this is rising while
// providerCallFailureTotal is flat, a single provider is degrading and the
// fallback chain is doing its job; if both rise together, the entire chain
// (and possibly the rate-limit gate) is undersized.
export const llmRequestFailureTotal = new Counter({
  name: 'loar_llm_request_failure_total',
  help: 'Count of dispatchLlmWithFallback calls whose entire chain failed.',
  labelNames: ['primary_model', 'reason'] as const,
});

export const platformMarginRatio = new Gauge({
  name: 'loar_platform_margin_ratio',
  help: 'Rolling gross margin: (revenueUsd - costUsd) / revenueUsd. Target >= 0.30.',
  labelNames: ['window'] as const,
});

export const platformRevenueUsdTotal = new Counter({
  name: 'loar_platform_revenue_usd_total',
  help: 'USD revenue recognised (credit purchases, subscriptions).',
  labelNames: ['source'] as const,
});

export function recordProviderCostMetric(args: {
  provider: string;
  kind: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}) {
  if (args.costUsd > 0) {
    providerCostUsdTotal.labels(args.provider, args.kind, args.model).inc(args.costUsd);
  }
  if (args.inputTokens > 0) {
    providerTokensTotal.labels(args.provider, args.kind, args.model, 'in').inc(args.inputTokens);
  }
  if (args.outputTokens > 0) {
    providerTokensTotal.labels(args.provider, args.kind, args.model, 'out').inc(args.outputTokens);
  }
}

export function recordRevenue(source: 'credits' | 'subscription' | 'marketplace', usd: number) {
  if (usd > 0) platformRevenueUsdTotal.labels(source).inc(usd);
}

export function setPlatformMargin(window: 'day' | 'week' | 'month', margin: number) {
  if (Number.isFinite(margin)) platformMarginRatio.labels(window).set(margin);
}
