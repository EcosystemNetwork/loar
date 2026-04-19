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
import { recordCreditsTx } from './metrics';

export async function assertGenerationAllowed(uid: string, credits: number): Promise<void> {
  try {
    await assertFeatureEnabled('generation');
    await assertSpendAllowed(uid, credits);
    // Record the spend attempt as 'success' when guards pass. Post-guard
    // failures (insufficient balance caught in deductCredits' transaction)
    // are rare relative to guard failures (kill switch / cap exceeded), so
    // this is a close-enough proxy for the Grafana credits panels until
    // each route migrates to a consolidated lib/credits.ts helper.
    recordCreditsTx('spend', 'success');
    // PostHog funnel: successful generation admission → user's conversion.
    void import('./analytics').then(({ captureServerEvent }) =>
      captureServerEvent('generation:admitted', { distinctId: uid, credits })
    );
  } catch (err) {
    if (err instanceof FeatureDisabledError || err instanceof MonthlySpendCapExceededError) {
      recordCreditsTx('spend', 'failure');
      void import('./analytics').then(({ captureServerEvent }) =>
        captureServerEvent('generation:blocked', {
          distinctId: uid,
          reason: err instanceof FeatureDisabledError ? 'kill_switch' : 'spend_cap',
          credits,
        })
      );
      throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
    }
    recordCreditsTx('spend', 'failure');
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
