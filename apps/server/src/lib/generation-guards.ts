/**
 * Shared gate for any credit-spending generation path.
 *
 * Every local `deductCredits` in the generation routers should call
 * `assertGenerationAllowed(uid, credits)` *before* opening the Firestore
 * transaction. Throws a tRPC-compatible error when:
 *   - the `generation` kill switch is off, or
 *   - the caller's rolling monthly spend cap would be exceeded.
 *
 * A single chokepoint keeps the 11+ existing `deductCredits` implementations
 * in lockstep without rewriting each one to use a centralised deducter.
 */
import { TRPCError } from '@trpc/server';
import {
  assertFeatureEnabled,
  FeatureDisabledError,
  type FeatureKey,
} from '../services/platformConfig';
import { assertSpendAllowed, MonthlySpendCapExceededError } from '../services/spend-cap';

export async function assertGenerationAllowed(uid: string, credits: number): Promise<void> {
  try {
    await assertFeatureEnabled('generation');
    await assertSpendAllowed(uid, credits);
  } catch (err) {
    if (err instanceof FeatureDisabledError || err instanceof MonthlySpendCapExceededError) {
      throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
    }
    throw err;
  }
}

/** Generic variant for non-generation features (mint, purchase, registration). */
export async function assertFeatureAllowed(feature: FeatureKey): Promise<void> {
  try {
    await assertFeatureEnabled(feature);
  } catch (err) {
    if (err instanceof FeatureDisabledError) {
      throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
    }
    throw err;
  }
}
