/**
 * Solana Pay — payment intents + on-chain settlement detection.
 *
 * Flow:
 *   1. POST /api/solana-pay/intent  → returns { reference, url }
 *      Client renders the URL as a QR (or `solana:` deeplink for Phantom mobile).
 *   2. Buyer pays from any Solana wallet, including the reference key as a
 *      read-only signer on the transfer ix. Solana Pay's contract: the unique
 *      `reference` lets us discover the payment without polling every block.
 *   3. GET /api/solana-pay/status?reference=REF → polls findReference +
 *      validateTransfer. When found, marks the intent paid; downstream
 *      services (credits, generation queue) read from the intent doc.
 *
 * Storage:
 *   `solanaPayIntents/{reference}` Firestore docs hold the canonical state.
 *   In dev without Firestore, an in-memory Map is the fallback.
 *
 * Recipient + token:
 *   Recipient: SOLANA_PAY_RECIPIENT env var (platform treasury wallet).
 *   Token:     SOL by default. Pass `splToken` (mint address) in the intent
 *              body to accept USDC-SPL or other SPL tokens instead.
 */
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  encodeURL,
  findReference,
  validateTransfer,
  FindReferenceError,
  ValidateTransferError,
  type ValidateTransferFields,
} from '@solana/pay';
import BigNumber from 'bignumber.js';
import { db, firebaseAvailable } from './firebase';
import { getSolanaConnection } from './circle-solana';

// ── Storage ─────────────────────────────────────────────────────────────────

interface IntentDoc {
  reference: string;
  userId: string;
  recipient: string;
  amount: string; // decimal string (e.g. "0.1" SOL)
  splToken?: string;
  label?: string;
  memo?: string;
  status: 'pending' | 'paid' | 'expired' | 'invalid';
  signature?: string;
  payer?: string;
  createdAt: number; // ms epoch
  expiresAt: number;
  paidAt?: number;
}

const memIntents = new Map<string, IntentDoc>();
const getCol = () => (firebaseAvailable ? db.collection('solanaPayIntents') : null);

async function loadIntent(reference: string): Promise<IntentDoc | null> {
  const col = getCol();
  if (col) {
    const doc = await col.doc(reference).get();
    return doc.exists ? (doc.data() as IntentDoc) : null;
  }
  return memIntents.get(reference) ?? null;
}

async function saveIntent(intent: IntentDoc): Promise<void> {
  const col = getCol();
  if (col) {
    await col.doc(intent.reference).set(intent);
  } else {
    memIntents.set(intent.reference, intent);
  }
}

// ── Intent creation ─────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface CreateIntentArgs {
  userId: string;
  /** Amount as a decimal string (e.g. "0.1" SOL or "1.5" USDC). */
  amount: string;
  /** Optional SPL token mint address (base58). When set, payment must be in this token. */
  splToken?: string;
  /** Display label shown to the buyer in their wallet UI. */
  label?: string;
  /** On-chain memo attached to the payment tx (optional, indexed by Helius). */
  memo?: string;
  /** TTL override in ms. Default 15 min. */
  ttlMs?: number;
}

export interface CreatedIntent {
  reference: string;
  url: string;
  recipient: string;
  amount: string;
  splToken?: string;
  expiresAt: number;
}

function getRecipient(): PublicKey {
  const raw = process.env.SOLANA_PAY_RECIPIENT;
  if (!raw) {
    throw new Error(
      'SOLANA_PAY_RECIPIENT is not configured. Set it to the platform treasury Solana address.'
    );
  }
  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`SOLANA_PAY_RECIPIENT="${raw}" is not a valid Solana address`);
  }
}

export async function createPaymentIntent(args: CreateIntentArgs): Promise<CreatedIntent> {
  const recipient = getRecipient();
  // Fresh reference keypair — only its public key is used (as an extra signer
  // marker on the transfer ix). The private key is discarded.
  const reference = Keypair.generate().publicKey;

  const amount = new BigNumber(args.amount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new Error('amount must be a positive decimal string');
  }

  const splTokenPk = args.splToken ? new PublicKey(args.splToken) : undefined;

  const url = encodeURL({
    recipient,
    amount,
    reference,
    label: args.label ?? 'LOAR',
    memo: args.memo,
    splToken: splTokenPk,
  });

  const now = Date.now();
  const intent: IntentDoc = {
    reference: reference.toBase58(),
    userId: args.userId,
    recipient: recipient.toBase58(),
    amount: amount.toString(),
    splToken: args.splToken,
    label: args.label,
    memo: args.memo,
    status: 'pending',
    createdAt: now,
    expiresAt: now + (args.ttlMs ?? DEFAULT_TTL_MS),
  };
  await saveIntent(intent);

  return {
    reference: intent.reference,
    url: url.toString(),
    recipient: intent.recipient,
    amount: intent.amount,
    splToken: intent.splToken,
    expiresAt: intent.expiresAt,
  };
}

// ── Status / settlement ─────────────────────────────────────────────────────

export interface IntentStatus {
  reference: string;
  status: 'pending' | 'paid' | 'expired' | 'invalid';
  signature?: string;
  payer?: string;
  amount: string;
  splToken?: string;
  expiresAt: number;
}

/**
 * Check whether an intent has been settled on-chain. If found-and-valid,
 * persists the signature + payer so later calls short-circuit.
 *
 * Idempotent — safe to call repeatedly. Returns `pending` if the buyer
 * hasn't paid yet, `expired` after the TTL, `invalid` if the on-chain tx
 * exists but doesn't match the requested recipient/amount/token.
 */
export async function getPaymentStatus(reference: string): Promise<IntentStatus | null> {
  const intent = await loadIntent(reference);
  if (!intent) return null;

  // Short-circuit once paid.
  if (intent.status !== 'pending') {
    return {
      reference: intent.reference,
      status: intent.status,
      signature: intent.signature,
      payer: intent.payer,
      amount: intent.amount,
      splToken: intent.splToken,
      expiresAt: intent.expiresAt,
    };
  }

  if (Date.now() > intent.expiresAt) {
    intent.status = 'expired';
    await saveIntent(intent);
    return {
      reference: intent.reference,
      status: 'expired',
      amount: intent.amount,
      splToken: intent.splToken,
      expiresAt: intent.expiresAt,
    };
  }

  const connection = getSolanaConnection();
  const referencePk = new PublicKey(reference);

  let signatureInfo;
  try {
    signatureInfo = await findReference(connection, referencePk, { finality: 'confirmed' });
  } catch (err) {
    if (err instanceof FindReferenceError) {
      // No tx yet — still pending.
      return {
        reference: intent.reference,
        status: 'pending',
        amount: intent.amount,
        splToken: intent.splToken,
        expiresAt: intent.expiresAt,
      };
    }
    throw err;
  }

  const recipient = new PublicKey(intent.recipient);
  const splToken = intent.splToken ? new PublicKey(intent.splToken) : undefined;

  const validateFields: ValidateTransferFields = {
    recipient,
    amount: new BigNumber(intent.amount),
    splToken,
    reference: referencePk,
  };

  try {
    const tx = await validateTransfer(connection, signatureInfo.signature, validateFields, {
      commitment: 'confirmed',
    });
    intent.status = 'paid';
    intent.signature = signatureInfo.signature;
    intent.paidAt = Date.now();
    // The fee payer is the first signer of the transaction.
    intent.payer = tx.transaction.message.accountKeys[0]?.toBase58();
    await saveIntent(intent);
    return {
      reference: intent.reference,
      status: 'paid',
      signature: intent.signature,
      payer: intent.payer,
      amount: intent.amount,
      splToken: intent.splToken,
      expiresAt: intent.expiresAt,
    };
  } catch (err) {
    if (err instanceof ValidateTransferError) {
      // Tx exists but doesn't match — possible griefing (someone sent the
      // wrong amount with our reference). Mark invalid so the caller can
      // alert the buyer. Do NOT credit.
      intent.status = 'invalid';
      intent.signature = signatureInfo.signature;
      await saveIntent(intent);
      return {
        reference: intent.reference,
        status: 'invalid',
        signature: intent.signature,
        amount: intent.amount,
        splToken: intent.splToken,
        expiresAt: intent.expiresAt,
      };
    }
    throw err;
  }
}
