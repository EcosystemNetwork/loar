/**
 * Squads v4 multisig integration — Solana parity with the Gnosis Safe layer
 * used for shared Universe ownership on EVM.
 *
 * Each multi-owner Universe gets a Squads multisig as its on-chain admin.
 * Universe instructions that require admin (`publish_universe`, `canonize_episode`)
 * are routed through the Squads program: a member proposes the tx via Squads
 * `vault_transaction_create`, others vote, and once threshold is reached the
 * tx executes the wrapped instruction via the multisig's vault PDA.
 *
 * Server role: helper service for create + propose + execute. The Circle DCW
 * wallet is one of the multisig members (so AI-triggered admin actions can
 * proceed when other members are absent and threshold = 1).
 *
 * For v1 the multisig is created at universe-mint time when caller passes
 * additional member addresses. Single-owner universes skip Squads entirely
 * and use the Universe PDA's `creator` field directly.
 */
import { Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import {
  activeCluster,
  executeSolanaTransaction,
  getSolanaConnection,
  getOrCreateSolanaWallet,
} from './circle-solana';

const { Permission, Permissions } = multisig.types;

// ── Multisig creation ───────────────────────────────────────────────────────

export interface CreateMultisigArgs {
  /** LOAR user id that triggers + pays for creation. */
  userId: string;
  /** Base58 member pubkeys — must include the creator's Circle Solana wallet. */
  members: string[];
  /** Number of approvals required to execute a tx. 1 ≤ threshold ≤ members.length. */
  threshold: number;
  /** Optional human-readable label (stored in createKey for indexing). */
  label?: string;
}

export interface CreatedMultisig {
  multisigPda: string;
  vaultPda: string;
  txSignature: string;
}

/**
 * Deploy a new Squads multisig owned by the given members.
 *
 * The Circle DCW wallet pays for creation. We use a fresh `createKey` keypair
 * so the multisig PDA is deterministic from (programId, createKey) — store
 * `createKey.publicKey` server-side so we can rederive the PDA later.
 */
export async function createUniverseMultisig(args: CreateMultisigArgs): Promise<CreatedMultisig> {
  if (args.threshold < 1 || args.threshold > args.members.length) {
    throw new Error('threshold must be between 1 and members.length');
  }

  const cluster = activeCluster();
  const wallet = await getOrCreateSolanaWallet(args.userId, cluster);
  const creator = new PublicKey(wallet.address);

  // createKey is a one-time-use signer that seeds the multisig PDA. Persisted
  // server-side (pubkey only) so we can rederive vault addresses later.
  const createKey = Keypair.generate();
  const [multisigPda] = multisig.getMultisigPda({ createKey: createKey.publicKey });
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  const memberStructs = args.members.map((m) => ({
    key: new PublicKey(m),
    permissions: Permissions.all(),
  }));

  const ix: TransactionInstruction = await multisig.instructions.multisigCreateV2({
    createKey: createKey.publicKey,
    creator,
    multisigPda,
    configAuthority: null,
    threshold: args.threshold,
    members: memberStructs,
    timeLock: 0,
    treasury: creator,
    rentCollector: creator,
    memo: args.label,
  });

  const tx = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster,
    instructions: [ix],
    additionalSigners: [createKey],
    computeUnitLimit: 200_000,
  });

  return {
    multisigPda: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    txSignature: tx.signature ?? tx.txId,
  };
}

// ── Proposing + voting ──────────────────────────────────────────────────────

export interface ProposeTxArgs {
  userId: string;
  multisigAddress: string;
  /** The actual instructions to execute via the vault. */
  innerInstructions: TransactionInstruction[];
  /** Human-readable memo stored on-chain for audit. */
  memo?: string;
}

/**
 * Propose a transaction for execution by the multisig. Returns the transaction
 * index (monotonic per multisig) which is used as the key for subsequent
 * approve/execute calls.
 */
export async function proposeMultisigTx(args: ProposeTxArgs): Promise<{
  txIndex: bigint;
  txSignature: string;
}> {
  const cluster = activeCluster();
  const connection = getSolanaConnection();
  const wallet = await getOrCreateSolanaWallet(args.userId, cluster);
  const creator = new PublicKey(wallet.address);
  const multisigPda = new PublicKey(args.multisigAddress);

  // Read current state to get the next transaction index.
  const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
    connection,
    multisigPda
  );
  // multisigAccount.transactionIndex is a BN — go via string for BigInt safety.
  const txIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  const txMessage = new (await import('@solana/web3.js')).TransactionMessage({
    payerKey: vaultPda,
    recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
    instructions: args.innerInstructions,
  });

  // Two ixs: create the vault transaction + create the proposal entry.
  const createIx = await multisig.instructions.vaultTransactionCreate({
    multisigPda,
    transactionIndex: txIndex,
    creator,
    vaultIndex: 0,
    ephemeralSigners: 0,
    transactionMessage: txMessage,
    memo: args.memo,
  });
  const proposalIx = await multisig.instructions.proposalCreate({
    multisigPda,
    transactionIndex: txIndex,
    creator,
  });

  const tx = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster,
    instructions: [createIx, proposalIx],
    computeUnitLimit: 300_000,
  });

  return { txIndex, txSignature: tx.signature ?? tx.txId };
}

/** Approve a pending multisig tx as the caller. */
export async function approveMultisigTx(args: {
  userId: string;
  multisigAddress: string;
  txIndex: bigint;
}): Promise<{ txSignature: string }> {
  const cluster = activeCluster();
  const wallet = await getOrCreateSolanaWallet(args.userId, cluster);
  const member = new PublicKey(wallet.address);
  const multisigPda = new PublicKey(args.multisigAddress);

  const ix = await multisig.instructions.proposalApprove({
    multisigPda,
    transactionIndex: args.txIndex,
    member,
  });

  const tx = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster,
    instructions: [ix],
    computeUnitLimit: 100_000,
  });
  return { txSignature: tx.signature ?? tx.txId };
}

/** Execute an approved multisig tx (anyone can call once threshold met). */
export async function executeMultisigTx(args: {
  userId: string;
  multisigAddress: string;
  txIndex: bigint;
}): Promise<{ txSignature: string }> {
  const cluster = activeCluster();
  const wallet = await getOrCreateSolanaWallet(args.userId, cluster);
  const member = new PublicKey(wallet.address);
  const multisigPda = new PublicKey(args.multisigAddress);

  const ix = await multisig.instructions.vaultTransactionExecute({
    connection: getSolanaConnection(),
    multisigPda,
    transactionIndex: args.txIndex,
    member,
  });

  const tx = await executeSolanaTransaction({
    walletId: wallet.walletId,
    cluster,
    instructions: [ix.instruction],
    computeUnitLimit: 500_000,
  });
  return { txSignature: tx.signature ?? tx.txId };
}

// ── Read helpers ────────────────────────────────────────────────────────────

/** Derive the vault PDA from a multisig address (vault index 0 by default). */
export function deriveVaultPda(multisigAddress: string, vaultIndex = 0): string {
  const [vault] = multisig.getVaultPda({
    multisigPda: new PublicKey(multisigAddress),
    index: vaultIndex,
  });
  return vault.toBase58();
}
