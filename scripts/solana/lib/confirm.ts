/**
 * Send a transaction and poll for confirmation without relying on
 * `signatureSubscribe` (which paid RPCs like Alchemy / QuickNode don't expose).
 *
 * Strategy: re-broadcast the same signed tx every `rebroadcastIntervalMs` and
 * poll `getSignatureStatuses` until commitment is reached or `timeoutMs`
 * elapses. The re-broadcast handles the case where the first send was dropped
 * before inclusion; idempotent because the signature is the same.
 */

import {
  Connection,
  Transaction,
  VersionedTransaction,
  Signer,
  TransactionSignature,
  SendOptions,
  Commitment,
  TransactionExpiredBlockheightExceededError,
} from '@solana/web3.js';

export interface ConfirmPollingOptions {
  /** Polling commitment target. Defaults to 'confirmed'. */
  commitment?: Commitment;
  /** Hard ceiling on total wait time. Defaults to 90s. */
  timeoutMs?: number;
  /** How often to re-broadcast the signed tx. Defaults to 10s. */
  rebroadcastIntervalMs?: number;
  /** How often to poll getSignatureStatuses. Defaults to 2s. */
  pollIntervalMs?: number;
  /** Forwarded to sendRawTransaction. */
  sendOptions?: SendOptions;
}

const DEFAULTS: Required<Omit<ConfirmPollingOptions, 'sendOptions'>> = {
  commitment: 'confirmed',
  timeoutMs: 90_000,
  rebroadcastIntervalMs: 10_000,
  pollIntervalMs: 2_000,
};

function rankCommitment(c: Commitment | null | undefined): number {
  if (c === 'finalized') return 3;
  if (c === 'confirmed') return 2;
  if (c === 'processed') return 1;
  return 0;
}

export async function sendAndConfirmPolling(
  connection: Connection,
  tx: Transaction | VersionedTransaction,
  signers: Signer[],
  options: ConfirmPollingOptions = {}
): Promise<TransactionSignature> {
  const opts = { ...DEFAULTS, ...options };
  let raw: Uint8Array;

  if (tx instanceof Transaction) {
    if (!tx.recentBlockhash) {
      const { blockhash } = await connection.getLatestBlockhash(opts.commitment);
      tx.recentBlockhash = blockhash;
    }
    if (!tx.feePayer && signers.length > 0) {
      tx.feePayer = signers[0].publicKey;
    }
    tx.sign(...signers);
    raw = tx.serialize();
  } else {
    if (signers.length > 0) tx.sign(signers);
    raw = tx.serialize();
  }

  const sendOptions: SendOptions = {
    skipPreflight: false,
    preflightCommitment: opts.commitment,
    maxRetries: 0,
    ...options.sendOptions,
  };

  const signature = await connection.sendRawTransaction(raw, sendOptions);

  const start = Date.now();
  let lastRebroadcast = start;
  const targetRank = rankCommitment(opts.commitment);

  while (Date.now() - start < opts.timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: false,
    });
    const status = value[0];
    if (status) {
      if (status.err) {
        throw new Error(`Transaction ${signature} failed: ${JSON.stringify(status.err)}`);
      }
      if (rankCommitment(status.confirmationStatus) >= targetRank) {
        return signature;
      }
    }

    if (Date.now() - lastRebroadcast >= opts.rebroadcastIntervalMs) {
      try {
        await connection.sendRawTransaction(raw, sendOptions);
      } catch {
        /* swallow — duplicate broadcast errors are expected once included */
      }
      lastRebroadcast = Date.now();
    }

    await new Promise((r) => setTimeout(r, opts.pollIntervalMs));
  }

  // Final search of history before giving up — the tx may have just landed.
  const { value: final } = await connection.getSignatureStatuses([signature], {
    searchTransactionHistory: true,
  });
  if (final[0] && !final[0].err && rankCommitment(final[0].confirmationStatus) >= targetRank) {
    return signature;
  }

  throw new TransactionExpiredBlockheightExceededError(signature);
}
