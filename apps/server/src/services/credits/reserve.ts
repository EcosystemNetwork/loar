/**
 * `reserve()` — retired.
 *
 * Credits/points no longer exist as a gate or a ledger for generation:
 * every user brings their own provider keys (BYOK), so there is nothing to
 * reserve, debit, or reconcile. This is kept as a no-op that returns a
 * synthetic reservation id so the ~13 `withReservation` call sites need no
 * change. The only guard still applied is the platform-wide generation
 * kill switch.
 */
import { randomUUID } from 'crypto';
import { assertGenerationAllowed } from '../../lib/generation-guards';
import type { ReserveInput, ReserveResult } from './types';

export async function reserve(input: ReserveInput): Promise<ReserveResult> {
  // Admin "AI generation" kill switch only. Passing 0 means the (now
  // disabled) monthly/daily spend caps can never trip.
  await assertGenerationAllowed(input.userId, 0);
  return { reservationId: randomUUID(), balanceAfter: 0 };
}
