/**
 * Platform Configuration Service
 *
 * Centralises every fee, rate, and platform parameter in a single Firestore
 * document (`platformConfig/fees`).  All values have code-level defaults so
 * the platform works before the first admin write.
 *
 * The admin tRPC router (`admin.routes.ts`) is the only place that writes to
 * this collection.  All other routers call `getPlatformConfig()` to read it.
 *
 * Firestore document: platformConfig/fees
 */

import { db } from '../lib/firebase';

// ── Default values ────────────────────────────────────────────────────────

export interface PlatformConfig {
  // ── Credit pricing ────────────────────────────────────────────────
  /** Margin multiplier for card / ETH / crypto credit purchases (e.g. 1.35 = 35%) */
  fiatMargin: number;
  /** Margin multiplier for $LOAR credit purchases (e.g. 1.25 = 25%) */
  loarMargin: number;
  /** Bonus credits awarded on $LOAR purchases as a fraction of base (e.g. 0.1 = 10%) */
  loarCreditBonusFraction: number;
  /** Base cost per credit in USD (provider cost) */
  baseCreditCostUsd: number;

  // ── Universe mint fee ─────────────────────────────────────────────
  /** ETH fee required to mint a universe — informational (enforced on-chain) */
  universeMintFeeEth: number;
  /** Fraction of mint fee sent to LP recipient (e.g. 0.5 = 50%) */
  mintFeeLpFraction: number;
  /** Credits awarded to the universe credit pool from the mint fee */
  universeMintCredits: number;

  // ── Marketplace / digital products ───────────────────────────────
  /** Platform fee on all digital product sales in basis points (1500 = 15%) */
  marketplacePlatformFeeBps: number;

  // ── Collaborations ────────────────────────────────────────────────
  /** Platform cut of collab revenue in basis points */
  collabPlatformFeeBps: number;

  // ── Subscriptions ─────────────────────────────────────────────────
  /** Platform cut of subscription revenue in basis points (0 = creator keeps 100%) */
  subscriptionPlatformFeeBps: number;

  // ── NFT / Episode mints ───────────────────────────────────────────
  /** Platform cut of NFT mint revenue in basis points */
  nftPlatformFeeBps: number;

  // ── ETH pricing ───────────────────────────────────────────────────
  /** Current ETH/USD price — used to compute expected wei for credit purchases */
  ethPriceUsd: number;

  // ── Affiliates & quests ───────────────────────────────────────────
  /** $LOAR awarded to referrer per successful referral */
  affiliateReferrerLoar: number;
  /** $LOAR awarded to new user on referral sign-up */
  affiliateNewUserLoar: number;

  // ── Feature kill switches ─────────────────────────────────────────
  // Flip any of these to `false` to instantly stop the matching action path
  // server-side. Circuit breakers handle *provider* failures; these are for
  // *product* failures (abuse surge, billing incident, on-chain halt).
  /** Allow new AI generation jobs to be queued or run. */
  generationEnabled: boolean;
  /** Allow universe / episode / NFT mint writes. */
  mintingEnabled: boolean;
  /** Allow credit purchases (card, ETH, $LOAR). */
  purchaseEnabled: boolean;
  /** Allow new user profile creation. */
  registrationEnabled: boolean;

  // ── Per-user spend caps ───────────────────────────────────────────
  /** Enforce the monthly spend cap — turn off for load tests / internal runs. */
  monthlySpendCapEnabled: boolean;
  /** Maximum credits a wallet may spend in a rolling 30-day window. */
  monthlySpendCapCredits: number;
  /** Enforce the daily spend cap — second-layer backstop for bursty abuse. */
  dailySpendCapEnabled: boolean;
  /** Maximum credits a wallet may spend in a rolling 24-hour window. */
  dailySpendCapCredits: number;

  // ── Metadata ─────────────────────────────────────────────────────
  updatedAt?: Date;
  updatedBy?: string;
}

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  fiatMargin: 1.35,
  loarMargin: 1.25,
  loarCreditBonusFraction: 0.1,
  baseCreditCostUsd: 0.008,

  universeMintFeeEth: 0.05,
  mintFeeLpFraction: 0.5,
  universeMintCredits: parseInt(process.env.UNIVERSE_MINT_CREDITS ?? '5000', 10),

  marketplacePlatformFeeBps: 1500, // 15%

  collabPlatformFeeBps: 500, // 5%
  subscriptionPlatformFeeBps: 0, // creators keep 100%
  nftPlatformFeeBps: 1500, // 15%

  ethPriceUsd: 3000,

  affiliateReferrerLoar: 100,
  affiliateNewUserLoar: 50,

  generationEnabled: true,
  mintingEnabled: true,
  purchaseEnabled: true,
  registrationEnabled: true,

  monthlySpendCapEnabled: true,
  monthlySpendCapCredits: 2000,
  dailySpendCapEnabled: true,
  dailySpendCapCredits: 500,
};

// ── Simple in-process cache (TTL: 60 s) ──────────────────────────────────

let _cache: PlatformConfig | null = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 60_000;

export async function getPlatformConfig(): Promise<PlatformConfig> {
  const now = Date.now();
  if (_cache && now - _cacheTs < CACHE_TTL_MS) return _cache;

  try {
    const doc = await db.collection('platformConfig').doc('fees').get();
    if (doc.exists) {
      const data = doc.data() as Partial<PlatformConfig>;
      _cache = { ...DEFAULT_PLATFORM_CONFIG, ...data };
    } else {
      _cache = { ...DEFAULT_PLATFORM_CONFIG };
    }
  } catch {
    _cache = { ...DEFAULT_PLATFORM_CONFIG };
  }

  _cacheTs = now;
  return _cache;
}

/** Invalidate the in-process cache (called after admin writes) */
export function invalidatePlatformConfigCache() {
  _cache = null;
  _cacheTs = 0;
}

/** Helper: convert BPS to a multiplier (1500 bps → 0.15) */
export function bpsToFraction(bps: number): number {
  return bps / 10_000;
}

/** Helper: compute platform fee amount from a total */
export function calcPlatformFee(totalWei: bigint, feeBps: number): bigint {
  return (totalWei * BigInt(feeBps)) / BigInt(10_000);
}

// ── Kill switches ────────────────────────────────────────────────────────

export type FeatureKey = 'generation' | 'minting' | 'purchase' | 'registration';

const FEATURE_KEY_MAP: Record<FeatureKey, keyof PlatformConfig> = {
  generation: 'generationEnabled',
  minting: 'mintingEnabled',
  purchase: 'purchaseEnabled',
  registration: 'registrationEnabled',
};

/**
 * Returns whether the named feature is currently enabled.
 * Fails open when the config fetch fails — circuit breakers and rate limits
 * are the last line of defence, not this.
 */
export async function isFeatureEnabled(feature: FeatureKey): Promise<boolean> {
  const cfg = await getPlatformConfig();
  const flagName = FEATURE_KEY_MAP[feature];
  const value = cfg[flagName];
  return value !== false;
}

/**
 * Throws a user-visible error when the feature is disabled.
 * Call at the top of write routes (generation jobs, mints, credit purchases,
 * registrations) so disabling the switch instantly closes new work.
 */
export async function assertFeatureEnabled(feature: FeatureKey): Promise<void> {
  if (!(await isFeatureEnabled(feature))) {
    throw new FeatureDisabledError(feature);
  }
}

export class FeatureDisabledError extends Error {
  readonly code = 'FEATURE_DISABLED';
  readonly feature: FeatureKey;
  constructor(feature: FeatureKey) {
    super(`The ${feature} feature is temporarily disabled by the platform. ` + `Try again later.`);
    this.feature = feature;
    this.name = 'FeatureDisabledError';
  }
}
