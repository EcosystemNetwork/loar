/**
 * Budget holds + cost-ledger records for the live 3D generation procedures
 * (routers/generation/threed.routes.ts).
 *
 * Those procedures charge credits, start a provider task, and finish in a
 * fire-and-forget background completer that swallows its own errors and marks
 * the generation doc `completed` / `failed`. So:
 *   - `reserveThreedBudget` books the estimated cost up front (before any doc
 *     or credit charge, so a denial needs no refund), and
 *   - `settleThreedJob` waits for the background completer, records the real
 *     cost to the ledger only if the job COMPLETED (a failed task bills nothing),
 *     then releases the hold.
 */
import type { SpendHold } from '../services/cost-tracker';
import { budgetErrorToTrpc } from './video-budget';

/** Background 3D jobs poll for up to ~15 min; the hold's own expiry is just the crash backstop. */
export const THREED_HOLD_TTL_SEC = 30 * 60;

export type ThreedCostProvider = 'meshy' | 'tripo';

/**
 * Book `costUsd` against the daily caps. Returns the hold (null when nothing
 * needed reserving). Refusals surface as 403 (provider paused) / 429 (cap).
 */
export async function reserveThreedBudget(
  provider: ThreedCostProvider,
  costUsd: number
): Promise<SpendHold | null> {
  const { reserveProviderBudget } = await import('../services/cost-tracker');
  try {
    return await reserveProviderBudget({
      provider,
      estimatedUsd: costUsd,
      holdTtlSec: THREED_HOLD_TTL_SEC,
    });
  } catch (err) {
    throw (await budgetErrorToTrpc(err)) ?? err;
  }
}

export interface SettleThreedJobOpts {
  hold: SpendHold | null;
  /** The background completer's promise (it never rejects, but is tolerated if it does). */
  done: Promise<unknown>;
  provider: ThreedCostProvider;
  model: string;
  costUsd: number;
  /** Final status of the generation doc — 'completed' means the provider was billed. */
  readStatus: () => Promise<string | undefined>;
  extra?: Record<string, string | number | boolean | null>;
}

/** Fire-and-forget: ledger the cost if the job completed, then always release the hold. */
export function settleThreedJob(opts: SettleThreedJobOpts): void {
  void opts.done
    .catch(() => undefined)
    .then(async () => {
      try {
        if ((await opts.readStatus()) === 'completed') {
          const { recordProviderCost } = await import('../services/cost-tracker');
          await recordProviderCost({
            provider: opts.provider,
            model: opts.model,
            kind: 'threed_gen',
            costUsd: opts.costUsd,
            extra: opts.extra,
          });
        }
      } catch (err) {
        console.warn('[threed-budget] cost record failed:', (err as Error).message);
      } finally {
        await opts.hold?.release();
      }
    });
}

/** Run `fn`; if it throws before the background job takes over, drop the hold and rethrow. */
export async function releaseHoldOnError<T>(
  hold: SpendHold | null,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    await hold?.release();
    throw err;
  }
}
