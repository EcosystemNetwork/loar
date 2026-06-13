/**
 * x402 — pay-per-call for AI agents, settled in USDC on Arc.
 *
 * Implements the x402 (HTTP 402 Payment Required) handshake as a lightweight
 * facilitator over Arc:
 *   1. Agent calls a paid resource with no payment → 402 + `accepts` (the
 *      price, the payTo address, the asset/network).
 *   2. Agent pays USDC on Arc (see arc.payUsdc) and retries with an
 *      `X-PAYMENT` header carrying the settlement txHash.
 *   3. We verify the on-chain transfer and grant access once per tx (replay
 *      protected via Firestore).
 *
 * This lets autonomous agents pay for LOAR API calls / inference / data access
 * per-use — the Circle "agentic economy" pattern.
 */
import { ARC_USDC, ARC_TESTNET_ID, USDC_DECIMALS, verifyUsdcPayment } from './arc';
import { db, firebaseAvailable } from './firebase';
import { parseUnits } from 'viem';

export const X402_VERSION = 1;
export const X402_NETWORK = 'arc-testnet';

export interface PaymentRequirements {
  scheme: 'exact';
  network: string;
  /** Raw USDC (6 decimals) required. */
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra: { decimals: number; chainId: number };
}

/** Build the body returned with an HTTP 402. */
export function paymentRequiredBody(args: {
  amountUsdc: string;
  payTo: string;
  resource: string;
  description?: string;
  error?: string;
}) {
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: X402_NETWORK,
    maxAmountRequired: parseUnits(args.amountUsdc, USDC_DECIMALS).toString(),
    resource: args.resource,
    description: args.description ?? 'LOAR paid API call',
    mimeType: 'application/json',
    payTo: args.payTo,
    maxTimeoutSeconds: 300,
    asset: ARC_USDC,
    extra: { decimals: USDC_DECIMALS, chainId: ARC_TESTNET_ID },
  };
  return { x402Version: X402_VERSION, accepts: [requirements], error: args.error };
}

interface PaymentPayload {
  txHash?: string;
}

/** Decode the base64 `X-PAYMENT` header → payload. Returns null if malformed. */
export function parsePaymentHeader(header: string | undefined | null): PaymentPayload | null {
  if (!header) return null;
  try {
    const json = Buffer.from(header, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    return typeof obj === 'object' && obj ? (obj as PaymentPayload) : null;
  } catch {
    return null;
  }
}

export type SettleResult =
  | { ok: true; txHash: string; amountRaw: string }
  | { ok: false; reason: string };

/**
 * Verify + consume an x402 payment for a resource. Idempotent per txHash: a tx
 * can only unlock one request (replay protection via the `x402Payments`
 * collection).
 */
export async function settlePayment(args: {
  header: string | undefined | null;
  payTo: string;
  amountUsdc: string;
  resource: string;
}): Promise<SettleResult> {
  const payload = parsePaymentHeader(args.header);
  if (!payload?.txHash) return { ok: false, reason: 'missing or malformed X-PAYMENT header' };
  const txHash = payload.txHash.toLowerCase();

  // Replay guard — claim the tx before granting access.
  if (firebaseAvailable) {
    const ref = db.collection('x402Payments').doc(txHash);
    const existing = await ref.get();
    if (existing.exists && existing.data()?.resource !== args.resource) {
      return { ok: false, reason: 'payment already consumed for another resource' };
    }
    if (existing.exists) {
      // Same resource + same tx → allow (idempotent retry).
      return { ok: true, txHash, amountRaw: existing.data()?.amountRaw ?? '0' };
    }
  }

  const verified = await verifyUsdcPayment({
    txHash,
    payTo: args.payTo,
    minUsdc: args.amountUsdc,
  });
  if (!verified) return { ok: false, reason: 'payment not found / insufficient / unconfirmed' };

  if (firebaseAvailable) {
    await db.collection('x402Payments').doc(txHash).set({
      txHash,
      resource: args.resource,
      payTo: args.payTo.toLowerCase(),
      amountRaw: verified.amountRaw.toString(),
      createdAt: new Date(),
    });
  }
  return { ok: true, txHash, amountRaw: verified.amountRaw.toString() };
}
