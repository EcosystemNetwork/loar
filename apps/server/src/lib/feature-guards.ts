/**
 * Shared tRPC-facing wrapper around the platform kill switches
 * (`platformConfig.ts` / `/admin/ops`).
 *
 * A disabled feature is expected control flow (an admin flipped a switch
 * for a testnet/incident), not a server bug — this rewraps
 * `FeatureDisabledError` as a FORBIDDEN tRPC error with the original
 * message intact, so it doesn't get logged as an INTERNAL_SERVER_ERROR /
 * sent to Sentry (see `apps/server/src/index.ts`'s trpc `onError` hook).
 *
 * Mirrors the rewrap `assertGenerationAllowed` already does for the
 * 'generation' switch (`lib/generation-guards.ts`) — use this helper for
 * every other switch ('minting', 'purchase', 'registration') so all
 * "create" paths fail the same way.
 */
import { TRPCError } from '@trpc/server';
import {
  assertFeatureEnabled,
  FeatureDisabledError,
  type FeatureKey,
} from '../services/platformConfig';

export async function assertFeatureEnabledOrForbidden(feature: FeatureKey): Promise<void> {
  try {
    await assertFeatureEnabled(feature);
  } catch (err) {
    if (err instanceof FeatureDisabledError) {
      throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
    }
    throw err;
  }
}
