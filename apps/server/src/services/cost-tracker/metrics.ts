/**
 * Prometheus metrics for cost tracking.
 * Counters are additive — safe to emit on every record regardless of persistence.
 */

import { Counter, Gauge } from 'prom-client';

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
