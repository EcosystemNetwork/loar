/**
 * Solana subscription SDK — server-side wrapper around the `subscription`
 * program.
 *
 * v1 surface: `subscribe` (user pays SOL × months, gets time-bound access).
 * Tier configuration is creator-side and not routed through the server here.
 *
 * Required env:
 *   SUBSCRIPTION_PROGRAM_ID — devnet/mainnet program ID
 *   UNIVERSE_PROGRAM_ID     — needed to resolve Universe.creator at runtime
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  buildSubscribeIx,
  decodeSubscriptionAccount,
  deriveSubscriptionConfigPda,
  deriveSubscriptionPda,
  deriveTierPda,
  type DecodedSubscription,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

export function isSolanaSubscriptionConfigured(): boolean {
  return !!(
    isCircleSolanaConfigured() &&
    process.env.SUBSCRIPTION_PROGRAM_ID &&
    process.env.UNIVERSE_PROGRAM_ID
  );
}

function subscriptionProgramId(): PublicKey {
  const id = process.env.SUBSCRIPTION_PROGRAM_ID;
  if (!id) throw new Error('SUBSCRIPTION_PROGRAM_ID is not set');
  return new PublicKey(id);
}

// ── Write path ──────────────────────────────────────────────────────────────

export interface SubscribeArgs {
  /** Circle DCW wallet id of the subscriber. */
  subscriberUserId: string;
  /** Universe PDA pubkey (the canonical universe identifier on Solana). */
  universe: PublicKey;
  /** Pubkey of the universe creator (read from Universe.creator). */
  creator: PublicKey;
  /** Platform treasury, from Config.platform. */
  platformTreasury: PublicKey;
  /** 0 = FREE, 1 = BASIC, 2 = PREMIUM, 3 = VIP. */
  tierId: number;
  months: number;
}

export interface SubscribeResult {
  txId: string;
  signature?: string;
  subscriptionPda: string;
  state: string;
}

export async function subscribe(args: SubscribeArgs): Promise<SubscribeResult> {
  if (!isSolanaSubscriptionConfigured()) {
    throw new Error(
      'Solana subscription is not configured — set SUBSCRIPTION_PROGRAM_ID + UNIVERSE_PROGRAM_ID'
    );
  }

  const programId = subscriptionProgramId();
  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(args.subscriberUserId);
  if (!wallet?.address) {
    throw new Error(`subscriber Solana wallet ${args.subscriberUserId} not found`);
  }
  const subscriber = new PublicKey(wallet.address);

  const ix = buildSubscribeIx({
    programId,
    subscriber,
    universeAccount: args.universe,
    universe: args.universe,
    creator: args.creator,
    platformTreasury: args.platformTreasury,
    tierId: args.tierId,
    months: args.months,
  });

  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: [ix],
    computeUnitLimit: 100_000,
  });

  const [subscriptionPda] = deriveSubscriptionPda(programId, subscriber, args.universe);
  return {
    txId: result.txId,
    signature: result.signature,
    subscriptionPda: subscriptionPda.toBase58(),
    state: result.state,
  };
}

// ── Read path ───────────────────────────────────────────────────────────────

export interface SubscriptionReadResult {
  pda: string;
  exists: boolean;
  subscription: DecodedSubscription | null;
  /** Convenience — true if `expires_at > now` and subscription exists. */
  active: boolean;
  /** Seconds remaining until expiry; 0 if expired or missing. */
  remainingSecs: number;
}

export async function readSubscription(
  subscriber: PublicKey,
  universe: PublicKey,
  connection?: Connection
): Promise<SubscriptionReadResult> {
  const programId = subscriptionProgramId();
  const [pda] = deriveSubscriptionPda(programId, subscriber, universe);
  const conn = connection ?? getSolanaConnection();
  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) {
    return {
      pda: pda.toBase58(),
      exists: false,
      subscription: null,
      active: false,
      remainingSecs: 0,
    };
  }
  const body = Buffer.from(acct.data.subarray(8));
  const decoded = decodeSubscriptionAccount(body);
  if (!decoded) {
    return {
      pda: pda.toBase58(),
      exists: true,
      subscription: null,
      active: false,
      remainingSecs: 0,
    };
  }
  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  const remaining = decoded.expiresAt > nowSecs ? Number(decoded.expiresAt - nowSecs) : 0;
  return {
    pda: pda.toBase58(),
    exists: true,
    subscription: decoded,
    active: remaining > 0,
    remainingSecs: remaining,
  };
}

/** Derive a Tier PDA — caller can read it via `connection.getAccountInfo`. */
export function tierPdaFor(universe: PublicKey, tierId: number): PublicKey {
  const [pda] = deriveTierPda(subscriptionProgramId(), universe, tierId);
  return pda;
}

/** Derive the singleton Config PDA. */
export function configPda(): PublicKey {
  const [pda] = deriveSubscriptionConfigPda(subscriptionProgramId());
  return pda;
}
