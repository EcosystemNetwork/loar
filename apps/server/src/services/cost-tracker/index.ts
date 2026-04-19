/**
 * Cost-tracker subsystem.
 *
 * Universal, provider-agnostic ledger + aggregates for every paid external
 * API call. Scope (userId, apiKeyId, universeAddress, route) is carried via
 * AsyncLocalStorage so callers don't thread extra parameters.
 *
 * Usage pattern (service):
 *
 *   import { recordProviderCost } from '@/services/cost-tracker';
 *
 *   const { response, cost } = await callGemini(...);
 *   await recordProviderCost({
 *     provider: 'gemini', model: 'gemini-2.5-pro', kind: 'vlm',
 *     costUsd: cost.usd, inputTokens: cost.in, outputTokens: cost.out,
 *   });
 *
 * Scope propagation (tRPC middleware):
 *
 *   withCostScope({ userId, apiKeyId, route: 'vlm.extract.start' }, async () => {
 *     return procedure(input);
 *   });
 *
 * Admin read path: `admin.cost.*` tRPC router.
 */

export { getCostScope, withCostScope, extendCostScope } from './scope';
export { recordProviderCost } from './record';
export type { CostProvider, CostKind, RecordProviderCostInput } from './record';
export { computeMargin, marginTarget } from './margin';
export type { MarginWindow } from './margin';
export { getOverview, getByUser, getByApiKey, getByUniverse, getRecentLedger } from './query';
export type { AggregateRow, LedgerEntry } from './query';
export {
  recordProviderCostMetric,
  recordRevenue,
  setPlatformMargin,
  providerCostUsdTotal,
  providerTokensTotal,
  platformMarginRatio,
  platformRevenueUsdTotal,
} from './metrics';
