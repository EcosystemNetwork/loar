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
import { db, firebaseAvailable } from './firebase';

const { Permission, Permissions } = multisig.types;
void Permission; // re-exported via Permissions.all() — silence unused import warning

const getMultisigsCol = () => (firebaseAvailable ? db.collection('solanaMultisigs') : null);

/**
 * Persisted record of a multisig we created. The `createKey` pubkey is the
 * load-bearing field: without it we can't rederive the multisigPda (the PDA
 * seed depends on it), and we can't audit ownership history.
 */
export interface MultisigRecord {
  multisigPda: string;
  vaultPda: string;
  createKey: string;
  userId: string;
  members: string[];
  threshold: number;
  label?: string;
  createdAt: number;
  txSignature: string;
}

export async function getMultisigRecord(multisigPda: string): Promise<MultisigRecord | null> {
  const col = getMultisigsCol();
  if (!col) return null;
  const doc = await col.doc(multisigPda).get();
  return doc.exists ? (doc.data() as MultisigRecord) : null;
}

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

  const record: MultisigRecord = {
    multisigPda: multisigPda.toBase58(),
    vaultPda: vaultPda.toBase58(),
    createKey: createKey.publicKey.toBase58(),
    userId: args.userId,
    members: args.members,
    threshold: args.threshold,
    label: args.label,
    createdAt: Date.now(),
    txSignature: tx.signature ?? tx.txId,
  };

  // Persist createKey + member roster so we can later derive vault PDAs,
  // audit who provisioned the multisig, and look up by member address.
  // Best-effort: a Firestore write failure doesn't undo the on-chain create.
  const col = getMultisigsCol();
  if (col) {
    try {
      await col.doc(record.multisigPda).set(record);
    } catch (err) {
      console.warn(
        `[squads] Firestore record write failed for ${record.multisigPda}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return {
    multisigPda: record.multisigPda,
    vaultPda: record.vaultPda,
    txSignature: record.txSignature,
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
 *
 * Race handling: two concurrent proposers both read `transactionIndex = N`
 * and submit `N+1`. The first commit wins; the second errors on-chain with
 * "account already exists" (since the proposal PDA is seeded by tx index).
 * We retry once with the freshly-incremented index — almost always sufficient,
 * since multisig proposals are low-frequency. If two retries collide it's a
 * pathological pattern; surface the error to the caller.
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
  const [vaultPda] = multisig.getVaultPda({ multisigPda, index: 0 });

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    // Read current transaction index fresh on each attempt — on retry we
    // pick up whichever competing proposer landed first.
    const multisigAccount = await multisig.accounts.Multisig.fromAccountAddress(
      connection,
      multisigPda
    );
    const txIndex = BigInt(multisigAccount.transactionIndex.toString()) + 1n;

    const txMessage = new (await import('@solana/web3.js')).TransactionMessage({
      payerKey: vaultPda,
      recentBlockhash: (await connection.getLatestBlockhash('confirmed')).blockhash,
      instructions: args.innerInstructions,
    });

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

    try {
      const tx = await executeSolanaTransaction({
        walletId: wallet.walletId,
        cluster,
        instructions: [createIx, proposalIx],
        computeUnitLimit: 300_000,
      });
      return { txIndex, txSignature: tx.signature ?? tx.txId };
    } catch (err) {
      lastError = err;
      // "already in use" / 0x0 (custom program error) are the typical
      // signatures of a lost index race. Anything else is fatal.
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      const isIndexRace =
        msg.includes('already in use') || msg.includes('custom program error: 0x0');
      if (!isIndexRace) throw err;
      // brief backoff before re-reading the index
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw lastError ?? new Error('Multisig propose failed after retry');
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
