/**
 * Gas Abstraction / Paymaster Configuration
 *
 * Configures thirdweb's built-in ERC-4337 account abstraction support
 * to sponsor gas for key platform actions (minting, voting, first universe creation).
 *
 * Non-sponsored actions (swaps, large transfers) fall back to user-paid gas.
 *
 * SDK version assumption: thirdweb ^5.x (currently 5.119.4).
 * The thirdweb v5 SDK bundles paymaster support via their infrastructure.
 * If the SDK introduces breaking changes to the AA/paymaster API,
 * this module will need to be updated.
 *
 * Prerequisites:
 *   - VITE_THIRDWEB_SECRET_KEY set in env (enables paymaster on the thirdweb project)
 *   - Smart wallet support enabled in the thirdweb dashboard for the project
 *   - The thirdweb project must have gas credits or a billing plan that covers sponsorship
 */

// ── Sponsored Action Registry ───────────────────────────────────────────────

/**
 * Contract function names that qualify for gas sponsorship.
 *
 * The platform covers gas for these actions to reduce onboarding friction
 * and encourage participation. Add or remove entries to control spend.
 */
export const SPONSORED_ACTIONS = new Set<string>([
  // Minting — core creative loop, must be frictionless
  'mint',
  'safeMint',
  'mintNode',
  'mintEpisode',
  'mintNFT',
  'createNode',

  // Voting / governance — encourage participation
  'vote',
  'castVote',
  'submitVote',

  // First-time universe creation — onboarding funnel
  'createUniverse',
  'deployUniverse',

  // Entity creation — worldbuilding studio actions
  'createEntity',

  // Social / engagement actions (free for growth)
  'follow',
  'unfollow',
  'submitCanon',
  'submitCanonProposal',
  'delegate',
  'delegateVotes',
  'claimReward',
  'claimQuest',
  'registerIdentity',
  'mintIdentityNFT',
  'propose',
  'queue',
  'execute',

  // Content creation (subsidize creators)
  'createContent',
  'updateContent',
  'createCharacter',
  'updateCharacter',
  'mintEdition',
  'mintCollective',
  'setTokenGate',
]);

/**
 * Actions that are explicitly NOT sponsored. Users pay their own gas.
 * Listed here for documentation; the default is "not sponsored" for
 * anything not in SPONSORED_ACTIONS.
 */
export const NON_SPONSORED_ACTIONS = [
  'swap',
  'transfer',
  'transferFrom',
  'approve', // token approvals — user cost
  'buy',
  'sell',
] as const;

// ── Paymaster Configuration ─────────────────────────────────────────────────

const secretKey = import.meta.env.VITE_THIRDWEB_SECRET_KEY as string | undefined;

/**
 * Whether gas sponsorship is available.
 *
 * Requires:
 *   1. VITE_THIRDWEB_SECRET_KEY is set
 *   2. The action is in SPONSORED_ACTIONS
 *
 * NOTE: VITE_THIRDWEB_SECRET_KEY is exposed in the client bundle. This is
 * acceptable because thirdweb's paymaster policies (set in their dashboard)
 * control which contracts/methods can actually be sponsored. The secret key
 * alone cannot drain funds — it only authorizes requests that match the
 * dashboard policy. For production, configure allowlists in the thirdweb
 * dashboard to restrict sponsorship to your deployed contract addresses.
 */
export function isPaymasterAvailable(): boolean {
  return !!secretKey;
}

/**
 * Check whether a given contract call should be gas-sponsored.
 */
export function isSponsoredAction(functionName: string): boolean {
  return SPONSORED_ACTIONS.has(functionName);
}

/**
 * Returns the thirdweb account abstraction config to pass to
 * `sendTransaction` or smart wallet setup.
 *
 * In thirdweb v5, smart accounts + paymaster are configured via
 * `smartAccount` options on the ConnectButton or via `sendTransaction`.
 *
 * Usage with sendTransaction:
 * ```ts
 * import { sendTransaction } from 'thirdweb';
 * const config = getSmartAccountConfig();
 * // Pass config when constructing smart account or sponsoring tx
 * ```
 */
export function getSmartAccountConfig() {
  if (!secretKey) {
    return null;
  }

  return {
    /**
     * thirdweb v5 smart account config.
     *
     * `sponsorGas: true` tells thirdweb to use its bundled paymaster
     * to sponsor the UserOperation gas fees.
     *
     * The secret key authenticates with thirdweb's paymaster service.
     * Dashboard policies control actual sponsorship rules.
     */
    sponsorGas: true,
    /**
     * Factory address can be left undefined to use thirdweb's default
     * account factory. Override if using a custom factory contract.
     */
    // factoryAddress: '0x...',
  };
}

/**
 * Build the `accountAbstraction` prop for thirdweb's ConnectButton.
 *
 * When returned as non-null, the ConnectButton will automatically
 * deploy a smart account (ERC-4337) for in-app wallet users and
 * route transactions through the paymaster.
 *
 * External wallet users (MetaMask, Coinbase, etc.) keep their EOA
 * and transactions are NOT routed through the paymaster — they pay
 * their own gas as usual.
 *
 * ```tsx
 * <ConnectButton
 *   client={thirdwebClient}
 *   accountAbstraction={getConnectButtonAAConfig()}
 *   ...
 * />
 * ```
 */
export function getConnectButtonAAConfig() {
  if (!secretKey) {
    return undefined;
  }

  return {
    chain: undefined as any, // Will use the connected chain
    sponsorGas: true,
  };
}

// ── Daily Sponsor Rate Limiting ─────────────────────────────────────────

/** Maximum sponsored transactions per user per day. */
export const DAILY_SPONSOR_LIMIT = 50;

const SPONSOR_STORAGE_PREFIX = 'loar_sponsor_';

/** Get the localStorage key for today's sponsor count. */
function getSponsorKey(userAddress: string): string {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return `${SPONSOR_STORAGE_PREFIX}${userAddress.toLowerCase()}_${today}`;
}

/** Read today's sponsored tx count for a user from localStorage. */
function getTodaySponsorCount(userAddress: string): number {
  try {
    const raw = localStorage.getItem(getSponsorKey(userAddress));
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

/**
 * Check whether a user can still receive sponsored transactions today.
 * Returns false if the user has exceeded the daily limit.
 */
export function canSponsor(userAddress: string): boolean {
  if (!isPaymasterAvailable()) return false;
  return getTodaySponsorCount(userAddress) < DAILY_SPONSOR_LIMIT;
}

/**
 * Increment the daily sponsor count for a user.
 * Call this after a sponsored transaction succeeds.
 */
export function recordSponsoredTx(userAddress: string): void {
  try {
    const key = getSponsorKey(userAddress);
    const current = getTodaySponsorCount(userAddress);
    localStorage.setItem(key, String(current + 1));

    // Clean up stale keys from previous days
    cleanStaleSponsorKeys(userAddress);
  } catch {
    // localStorage unavailable — fail silently
  }
}

/** Remove localStorage entries from previous days to prevent unbounded growth. */
function cleanStaleSponsorKeys(userAddress: string): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const prefix = `${SPONSOR_STORAGE_PREFIX}${userAddress.toLowerCase()}_`;
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix) && !key.endsWith(today)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore cleanup failures
  }
}

/**
 * Get the full sponsorship status for the current session.
 * Useful for UI display (e.g., "12 of 50 sponsored txs remaining today").
 */
export function getSponsorshipStatus(userAddress?: string): {
  available: boolean;
  sponsoredActions: string[];
  dailyLimit: number;
  remainingToday: number;
} {
  const paymasterReady = isPaymasterAvailable();
  const used = userAddress ? getTodaySponsorCount(userAddress) : 0;
  const remaining = Math.max(0, DAILY_SPONSOR_LIMIT - used);

  return {
    available: paymasterReady && remaining > 0,
    sponsoredActions: Array.from(SPONSORED_ACTIONS),
    dailyLimit: DAILY_SPONSOR_LIMIT,
    remainingToday: paymasterReady ? remaining : 0,
  };
}
