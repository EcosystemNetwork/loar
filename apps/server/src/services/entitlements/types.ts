/**
 * Account-wide entitlements — one-time unlocks that flip a permanent flag
 * on the user (`userEntitlements/{userId}`).
 *
 * v1 entitlement: `byokFeeWaived` — once unlocked, generations that use a
 * BYOK provider key skip the platform credit charge entirely. Acquired via:
 *   - Stripe payment ($25 default, all PMs Stripe supports)
 *   - On-chain crypto payment (native ETH on Sepolia/Base Sepolia, or
 *     USDC via Solana Pay)
 *   - Admin-minted redeem code
 *
 * Non-transferable, non-refundable. Stated in the UI before payment.
 */

export type UnlockMethod = 'stripe' | 'eth' | 'usdc-sol' | 'code';

export interface UserEntitlement {
  uid: string;
  byokFeeWaived: boolean;
  unlockedAt: Date | null;
  unlockedVia: UnlockMethod | null;
  /** Stripe paymentIntentId | EVM tx hash | Solana Pay reference | code id */
  sourceRef: string | null;
  /** Amount actually paid (USD cents for stripe, wei for ETH, USDC base units for SPL) */
  amountPaid: string | null;
  updatedAt: Date;
}

export interface BYOKUnlockCode {
  /** Code string itself — also the doc id (uppercased, alphanumeric). */
  code: string;
  /** Optional human-readable note (e.g. "podcast giveaway 2026-05"). */
  note: string;
  maxRedemptions: number;
  redeemedBy: string[];
  redeemedAt: Date[];
  expiresAt: Date | null;
  createdBy: string;
  createdAt: Date;
  active: boolean;
}

export class EntitlementAlreadyActiveError extends Error {
  constructor(public uid: string) {
    super('Fee waiver is already active for this account.');
    this.name = 'EntitlementAlreadyActiveError';
  }
}

export class InvalidUnlockCodeError extends Error {
  constructor(
    public code: string,
    reason: string
  ) {
    super(`Invalid unlock code: ${reason}`);
    this.name = 'InvalidUnlockCodeError';
  }
}

export class CodeAlreadyRedeemedError extends Error {
  constructor(public code: string) {
    super('You have already redeemed this code.');
    this.name = 'CodeAlreadyRedeemedError';
  }
}
