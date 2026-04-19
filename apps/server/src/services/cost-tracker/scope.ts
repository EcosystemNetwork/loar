/**
 * Cost-tracker request scope.
 *
 * Propagates attribution metadata (userId, apiKeyId, universeAddress, route)
 * through the async call graph without touching every service signature.
 * Any provider wrapper that incurs paid-API cost reads this scope to tag
 * the resulting ledger entry.
 *
 * Set by:
 *   - trpc middleware (per procedure)
 *   - Hono request middleware (per REST call)
 *   - worker pre-hooks (per BullMQ job)
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface CostScope {
  /** Low-case wallet address / session uid. Null = anonymous / system call. */
  userId: string | null;
  /** API key doc id when the call was API-key authenticated. */
  apiKeyId?: string | null;
  /** Linked AI agent when the API key represents an agent. */
  aiAgentId?: string | null;
  /** Universe this work is attributed to, if any. */
  universeAddress?: string | null;
  /** tRPC procedure path, REST route, or worker job kind. */
  route?: string | null;
  /** Correlates ledger entries produced by one inbound request. */
  requestId?: string | null;
}

const als = new AsyncLocalStorage<CostScope>();

const SYSTEM_SCOPE: CostScope = { userId: null, route: 'system' };

export function getCostScope(): CostScope {
  return als.getStore() ?? SYSTEM_SCOPE;
}

export function withCostScope<T>(scope: CostScope, fn: () => Promise<T> | T): Promise<T> | T {
  return als.run(scope, fn);
}

/** Returns a new scope with patched fields; does not mutate the store. */
export function extendCostScope(patch: Partial<CostScope>): CostScope {
  return { ...getCostScope(), ...patch };
}
