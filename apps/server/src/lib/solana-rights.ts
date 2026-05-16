/**
 * Solana rights SDK — server-side wrapper around the `rights` Anchor program.
 *
 * Trust model: EVM `RightsRegistry.sol` remains the canonical source of truth.
 * This program is an attestation cache so downstream Solana programs
 * (canon marketplace, licensing, escrow) can gate `is_monetizable()` checks
 * locally without a cross-chain RPC. Cross-chain sync happens via
 * `services/rights-bridge.ts`, which calls `pushRightsAttestation()` here.
 *
 * Required env (in addition to standard Circle Solana config):
 *   RIGHTS_PROGRAM_ID                  — devnet/mainnet program ID
 *   CIRCLE_RIGHTS_OPERATOR_WALLET_ID   — Circle DCW wallet that holds the
 *                                        rights_operator authority. Set
 *                                        equal to Config.rights_operator
 *                                        on-chain. At mainnet handover this
 *                                        becomes a Squads vault.
 */
import { PublicKey, type Connection } from '@solana/web3.js';
import {
  buildSetRightsViaAttestationIx,
  decodeRightsAccount,
  deriveRightsPda,
  isMonetizableRightsType,
  type DecodedRights,
  type SolanaRightsType,
} from './anchor-ix';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  isCircleSolanaConfigured,
} from './circle-solana';

/** True when the server can submit rights attestations to Solana. */
export function isSolanaRightsConfigured(): boolean {
  return !!(
    isCircleSolanaConfigured() &&
    process.env.RIGHTS_PROGRAM_ID &&
    process.env.CIRCLE_RIGHTS_OPERATOR_WALLET_ID
  );
}

function rightsProgramId(): PublicKey {
  const id = process.env.RIGHTS_PROGRAM_ID;
  if (!id) throw new Error('RIGHTS_PROGRAM_ID is not set');
  return new PublicKey(id);
}

function operatorWalletId(): string {
  const id = process.env.CIRCLE_RIGHTS_OPERATOR_WALLET_ID;
  if (!id) throw new Error('CIRCLE_RIGHTS_OPERATOR_WALLET_ID is not set');
  return id;
}

// ── Write path ──────────────────────────────────────────────────────────────

export interface PushRightsAttestationArgs {
  contentHash: Buffer; // 32 bytes
  rightsType: SolanaRightsType;
  /** Solana creator pubkey if known, else PublicKey.default. */
  creator: PublicKey;
  /** EVM RightsRegistry.contentCreator at attestation time. 20 bytes. */
  evmCreator: Buffer;
  /** Strictly monotonic per content_hash. Server picks scheme. */
  version: bigint;
  /** EVM tx hash that emitted RightsSet. 32 bytes. */
  evmTxHash: Buffer;
  evmBlockNumber: bigint;
}

export interface PushRightsAttestationResult {
  txId: string;
  signature?: string;
  rightsPda: string;
  /** State per Circle's API — 'COMPLETE' / 'FAILED' / 'PENDING' / etc. */
  state: string;
}

/**
 * Push a single rights attestation to Solana. Builds the
 * `set_rights_via_attestation` instruction, hands it to Circle DCW to sign
 * as the rights_operator wallet, and broadcasts.
 *
 * Throws if `isSolanaRightsConfigured()` is false — callers must gate.
 */
export async function pushRightsAttestation(
  args: PushRightsAttestationArgs
): Promise<PushRightsAttestationResult> {
  if (!isSolanaRightsConfigured()) {
    throw new Error(
      'Solana rights bridge is not configured — set RIGHTS_PROGRAM_ID + CIRCLE_RIGHTS_OPERATOR_WALLET_ID'
    );
  }
  if (args.contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');
  if (args.evmCreator.length !== 20) throw new Error('evmCreator must be 20 bytes');
  if (args.evmTxHash.length !== 32) throw new Error('evmTxHash must be 32 bytes');

  const programId = rightsProgramId();
  const walletId = operatorWalletId();

  // Fetch the operator wallet's address to use as the `operator` signer.
  const { getUserSolanaWallet } = await import('./circle-solana');
  const wallet = await getUserSolanaWallet(walletId);
  if (!wallet?.address) {
    throw new Error(`rights operator wallet ${walletId} not found`);
  }
  const operatorPubkey = new PublicKey(wallet.address);

  const [rightsPda] = deriveRightsPda(programId, args.contentHash);

  const ix = buildSetRightsViaAttestationIx({
    programId,
    operator: operatorPubkey,
    contentHash: args.contentHash,
    rightsType: args.rightsType,
    creator: args.creator,
    evmCreator: args.evmCreator,
    version: args.version,
    evmTxHash: args.evmTxHash,
    evmBlockNumber: args.evmBlockNumber,
  });

  const result = await executeSolanaTransaction({
    walletId,
    cluster: activeCluster(),
    instructions: [ix],
    // Modest CU bump — the write is just a PDA realloc-on-first-write +
    // ~150 bytes of borsh. Stays well under the 200k legacy default but
    // bump to 100k for headroom across compute price spikes.
    computeUnitLimit: 100_000,
  });

  return {
    txId: result.txId,
    signature: result.signature,
    rightsPda: rightsPda.toBase58(),
    state: result.state,
  };
}

// ── Read path ───────────────────────────────────────────────────────────────

export interface RightsReadResult {
  pda: string;
  exists: boolean;
  rights: DecodedRights | null;
  monetizable: boolean;
}

/**
 * Read the Solana rights cache for a given content_hash. Returns
 * `exists: false` when no attestation has landed yet — in that case
 * `monetizable` is false (default-deny matches EVM `isMonetizable`).
 */
export async function readRights(
  contentHash: Buffer,
  connection?: Connection
): Promise<RightsReadResult> {
  if (contentHash.length !== 32) throw new Error('contentHash must be 32 bytes');
  const programId = rightsProgramId();
  const [pda] = deriveRightsPda(programId, contentHash);
  const conn = connection ?? getSolanaConnection();

  const acct = await conn.getAccountInfo(pda, 'confirmed');
  if (!acct) {
    return {
      pda: pda.toBase58(),
      exists: false,
      rights: null,
      monetizable: false,
    };
  }

  // First 8 bytes are the anchor account discriminator — strip before decode.
  const body = Buffer.from(acct.data.subarray(8));
  const decoded = decodeRightsAccount(body);
  if (!decoded) {
    return {
      pda: pda.toBase58(),
      exists: true,
      rights: null,
      monetizable: false,
    };
  }

  return {
    pda: pda.toBase58(),
    exists: true,
    rights: decoded,
    monetizable: isMonetizableRightsType(decoded.rightsType),
  };
}

/** Convenience: just the boolean gate. Equivalent to `RightsRegistry.isMonetizable`. */
export async function isMonetizableOnSolana(
  contentHash: Buffer,
  connection?: Connection
): Promise<boolean> {
  const r = await readRights(contentHash, connection);
  return r.monetizable;
}
