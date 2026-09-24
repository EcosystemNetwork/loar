/**
 * Budget-hold plumbing shared by the video generation route and its queue
 * worker: translating cost-tracker refusals to HTTP-ish errors, reserving the
 * hold at queued-job admission, and releasing it from the worker.
 *
 * Kept out of generation.routes.ts / generation.worker.ts so the admission and
 * release rules can be tested directly against a real Redis.
 */
import { TRPCError } from '@trpc/server';
import type { CostProvider, SpendHold, SpendHoldRef } from '../services/cost-tracker';

/** Queued jobs can wait behind others — longer safety expiry than an inline call's default. */
export const QUEUED_HOLD_TTL_SEC = 45 * 60;

/**
 * Cost-tracker refusals (provider paused / cap reached) -> the matching TRPCError.
 * Returns null for any other error so callers can rethrow it untouched.
 */
export async function budgetErrorToTrpc(err: unknown): Promise<TRPCError | null> {
  const { ProviderPausedError, CostCapExceededError } = await import('../services/cost-tracker');
  if (err instanceof ProviderPausedError) {
    return new TRPCError({ code: 'FORBIDDEN', message: err.message, cause: err });
  }
  if (err instanceof CostCapExceededError) {
    return new TRPCError({ code: 'TOO_MANY_REQUESTS', message: err.message, cause: err });
  }
  return null;
}

/** True for a refusal produced by `budgetErrorToTrpc` — says nothing about provider health. */
export function isBudgetRefusal(err: unknown): boolean {
  return err instanceof TRPCError && ['FORBIDDEN', 'TOO_MANY_REQUESTS'].includes(err.code);
}

/**
 * Reserve budget for a job that is about to be enqueued. Returns the hold (put
 * `hold.ref` in the job data), or null when there is nothing to reserve (free
 * model, no caps configured, or Redis unavailable).
 *
 * On a refusal, `onDenied` runs first (refund credits, mark the generation
 * failed) and then the refusal is rethrown as a TRPCError — so the caller must
 * call this OUTSIDE any try/catch that would swallow it into an inline fallback.
 */
export async function reserveQueuedVideoBudget(opts: {
  provider: CostProvider;
  providerCostUsd: number;
  onDenied: (err: Error) => Promise<void>;
}): Promise<SpendHold | null> {
  if (!(opts.providerCostUsd > 0)) return null;
  const { reserveProviderBudget } = await import('../services/cost-tracker');
  try {
    return await reserveProviderBudget({
      provider: opts.provider,
      estimatedUsd: opts.providerCostUsd,
      holdTtlSec: QUEUED_HOLD_TTL_SEC,
    });
  } catch (err) {
    await opts.onDenied(err instanceof Error ? err : new Error('Budget exceeded'));
    throw (await budgetErrorToTrpc(err)) ?? err;
  }
}

/** The slice of a BullMQ job the release logic needs. */
export interface HoldCarryingJob {
  data: { spendHold?: SpendHoldRef };
  attemptsMade: number;
  opts?: { attempts?: number };
}

/** True when no further retry will run after the current attempt. */
export function isFinalAttempt(job: Pick<HoldCarryingJob, 'attemptsMade' | 'opts'>): boolean {
  return job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
}

/** Drop the admission-time hold, if the job carries one. Never throws. */
export async function releaseJobSpendHold(job: HoldCarryingJob): Promise<void> {
  if (!job.data.spendHold) return;
  try {
    const { releaseSpendHold } = await import('../services/cost-tracker');
    await releaseSpendHold(job.data.spendHold);
  } catch (err) {
    console.warn('[worker] spend hold release failed (it will expire):', (err as Error).message);
  }
}

/**
 * Run a job body and release its hold afterwards: always on success, and on a
 * throw only when it was the final attempt — a retry stays protected.
 */
export async function runReleasingSpendHold<T>(
  job: HoldCarryingJob,
  body: () => Promise<T>
): Promise<T> {
  try {
    const result = await body();
    await releaseJobSpendHold(job);
    return result;
  } catch (err) {
    if (isFinalAttempt(job)) await releaseJobSpendHold(job);
    throw err;
  }
}
