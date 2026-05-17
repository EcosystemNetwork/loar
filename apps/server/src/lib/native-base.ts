/**
 * Shared helpers for native-protocol adapters in apps/server/src/lib/native-*.
 *
 * Adapters compose Solana-native protocols (Realms, Streamflow, Jupiter,
 * Tensor, Metaplex Core) without re-implementing them. This module keeps
 * the boilerplate of user→wallet resolution + Circle DCW dispatch in one
 * place so each adapter can stay tight (200-300 LOC).
 */
import {
  type AddressLookupTableAccount,
  PublicKey,
  type TransactionInstruction,
  type VersionedTransaction,
} from '@solana/web3.js';
import {
  activeCluster,
  executeSolanaTransaction,
  getUserSolanaWallet,
  isCircleSolanaConfigured,
} from './circle-solana';

export interface ResolvedSolanaWallet {
  walletId: string;
  pubkey: PublicKey;
}

/**
 * Look up a user's Circle DCW Solana wallet and return both the walletId
 * (for `executeSolanaTransaction`) and the pubkey (for ix building). Throws
 * a clear error when the wallet isn't provisioned yet.
 */
export async function resolveUserSolanaWallet(userId: string): Promise<ResolvedSolanaWallet> {
  const wallet = await getUserSolanaWallet(userId);
  if (!wallet?.address) {
    throw new Error(`Solana wallet for user ${userId} is not provisioned yet`);
  }
  return {
    walletId: wallet.walletId,
    pubkey: new PublicKey(wallet.address),
  };
}

export interface SendNativeTxArgs {
  userId: string;
  instructions: TransactionInstruction[];
  /** Address lookup tables required by the protocol's versioned tx. */
  lookupTables?: AddressLookupTableAccount[];
  /** Compute units. Default 200_000 — bump for complex flows. */
  computeUnitLimit?: number;
  /** Priority fee in micro-lamports per CU; defaults to Helius medium. */
  priorityFeeMicroLamports?: number;
}

export interface SendNativeTxResult {
  txId: string;
  signature?: string;
  state: string;
}

/**
 * Build, sign, and broadcast a tx through Circle DCW on behalf of a LOAR
 * user. Convenience wrapper around `executeSolanaTransaction` that handles
 * the user→wallet resolution.
 */
export async function sendNativeTx(args: SendNativeTxArgs): Promise<SendNativeTxResult> {
  const wallet = await resolveUserSolanaWallet(args.userId);
  const result = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster: activeCluster(),
    instructions: args.instructions,
    lookupTables: args.lookupTables,
    computeUnitLimit: args.computeUnitLimit,
    priorityFeeMicroLamports: args.priorityFeeMicroLamports,
  });
  return { txId: result.txId, signature: result.signature, state: result.state };
}

/**
 * Some native protocols (Jupiter, Tensor) hand you a fully-built
 * VersionedTransaction. We can't pass that directly through Circle DCW —
 * Circle requires instruction-level input so it can re-build the tx with
 * its own fee payer. This helper extracts ix's from a v0 message so the
 * caller can re-submit via `sendNativeTx`.
 *
 * Limitation: assumes the v0 message uses no Address Lookup Tables. If
 * lookup tables are present, the caller must resolve them and pass into
 * `sendNativeTx`. Jupiter swaps frequently use ALTs — see native-jupiter.ts
 * for the resolution path.
 */
export function extractInstructions(tx: VersionedTransaction): TransactionInstruction[] {
  const msg = tx.message;
  const accountKeys = msg.staticAccountKeys;
  return msg.compiledInstructions.map((cix) => ({
    programId: accountKeys[cix.programIdIndex],
    keys: cix.accountKeyIndexes.map((idx) => ({
      pubkey: accountKeys[idx],
      // Header conventions encode signer/writable bits:
      //   header.numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts
      isSigner: idx < msg.header.numRequiredSignatures,
      isWritable:
        idx < msg.header.numRequiredSignatures - msg.header.numReadonlySignedAccounts ||
        (idx >= msg.header.numRequiredSignatures &&
          idx < accountKeys.length - msg.header.numReadonlyUnsignedAccounts),
    })),
    data: Buffer.from(cix.data),
  }));
}

/** Convenience config gate — native adapters require Circle Solana + a per-protocol id. */
export function isNativeBaseConfigured(): boolean {
  return isCircleSolanaConfigured();
}
