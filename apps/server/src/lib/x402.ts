/**
 * x402 — pay-per-call for AI agents, settled in USDC on Arc.
 *
 * Canonical x402 ("exact" EVM scheme): the client signs an EIP-3009
 * `TransferWithAuthorization` off-chain and never broadcasts a transaction. The
 * facilitator (this server) verifies the signature and submits
 * `transferWithAuthorization` on the USDC contract, paying gas. Flow:
 *   1. Agent calls a paid resource with no payment → 402 + `accepts` (price,
 *      payTo, asset, and the token's EIP-712 domain in `extra`).
 *   2. Agent signs the EIP-3009 authorization and retries with `X-PAYMENT`
 *      = base64({ x402Version, scheme, network, payload: { signature, authorization } }).
 *   3. We verify (EIP-712 recover + window + nonce) and settle on Arc, then
 *      return the result plus `X-PAYMENT-RESPONSE`.
 *
 * Matches the x402 v1 wire format; network uses CAIP-2 (`eip155:5042002`) since
 * Arc has no stock x402 slug.
 */
import { verifyTypedData, parseUnits, type Hex } from 'viem';
import {
  ARC_USDC,
  ARC_TESTNET_ID,
  USDC_DECIMALS,
  usdcDomain,
  isAuthorizationUsed,
  settleTransferWithAuthorization,
  type Eip3009Authorization,
} from './arc';
import { db, firebaseAvailable } from './firebase';

export const X402_VERSION = 1;
export const X402_NETWORK = process.env.X402_NETWORK || `eip155:${ARC_TESTNET_ID}`;
export const X402_SCHEME = 'exact' as const;

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
  /** EIP-712 domain the client needs to sign the authorization. */
  extra?: { name: string; version: string };
  outputSchema: unknown;
}

/** Build the body returned with an HTTP 402 (sync; `extra` optional). */
export function paymentRequiredBody(args: {
  amountUsdc: string;
  payTo: string;
  resource: string;
  description?: string;
  error?: string;
  extra?: { name: string; version: string };
}) {
  const requirements: PaymentRequirements = {
    scheme: X402_SCHEME,
    network: X402_NETWORK,
    maxAmountRequired: parseUnits(args.amountUsdc, USDC_DECIMALS).toString(),
    resource: args.resource,
    description: args.description ?? 'LOAR paid API call',
    mimeType: 'application/json',
    payTo: args.payTo,
    maxTimeoutSeconds: 300,
    asset: ARC_USDC,
    extra: args.extra,
    outputSchema: null,
  };
  return { x402Version: X402_VERSION, accepts: [requirements], error: args.error };
}

/** 402 body enriched with the live USDC EIP-712 domain (so clients can sign). */
export async function buildPaymentRequired(args: {
  amountUsdc: string;
  payTo: string;
  resource: string;
  description?: string;
  error?: string;
}) {
  const d = await usdcDomain();
  return paymentRequiredBody({ ...args, extra: { name: d.name, version: d.version } });
}

// ── X-PAYMENT payload ────────────────────────────────────────────────────────

export interface ExactEvmPayload {
  signature: string;
  authorization: Eip3009Authorization;
}
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: ExactEvmPayload;
}

/** Decode the base64 `X-PAYMENT` header → payload. Returns null if malformed. */
export function parsePaymentHeader(header: string | undefined | null): PaymentPayload | null {
  if (!header) return null;
  try {
    const json = Buffer.from(header, 'base64').toString('utf8');
    const obj = JSON.parse(json);
    if (obj?.payload?.authorization && obj?.payload?.signature) return obj as PaymentPayload;
    return null;
  } catch {
    return null;
  }
}

// ── Verify + settle (the facilitator) ────────────────────────────────────────

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

export type VerifyResult =
  | { isValid: true; payer: string }
  | { isValid: false; invalidReason: string };

/**
 * Verify a signed EIP-3009 authorization against the requirements — recovers
 * the signer (EIP-712), checks recipient/amount/time-window, and that the
 * nonce is unused on-chain. Does NOT broadcast.
 */
export async function verifyPayment(
  payload: PaymentPayload,
  req: { payTo: string; amountUsdc: string }
): Promise<VerifyResult> {
  if (payload.scheme !== X402_SCHEME)
    return { isValid: false, invalidReason: 'unsupported scheme' };
  const a = payload.payload.authorization;

  if (a.to.toLowerCase() !== req.payTo.toLowerCase()) {
    return { isValid: false, invalidReason: 'authorization `to` != payTo' };
  }
  const required = parseUnits(req.amountUsdc, USDC_DECIMALS);
  let value: bigint;
  try {
    value = BigInt(a.value);
  } catch {
    return { isValid: false, invalidReason: 'bad value' };
  }
  if (value < required) return { isValid: false, invalidReason: 'amount below required' };

  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validAfter) > now) return { isValid: false, invalidReason: 'not yet valid' };
  if (Number(a.validBefore) <= now)
    return { isValid: false, invalidReason: 'authorization expired' };

  // EIP-712 signature recovery against the token's live domain.
  const domain = await usdcDomain();
  let ok = false;
  try {
    ok = await verifyTypedData({
      address: a.from as Hex,
      domain: {
        name: domain.name,
        version: domain.version,
        chainId: domain.chainId,
        verifyingContract: domain.verifyingContract,
      },
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: a.from as Hex,
        to: a.to as Hex,
        value,
        validAfter: BigInt(a.validAfter),
        validBefore: BigInt(a.validBefore),
        nonce: a.nonce as Hex,
      },
      signature: payload.payload.signature as Hex,
    });
  } catch {
    ok = false;
  }
  if (!ok) return { isValid: false, invalidReason: 'invalid signature' };

  if (await isAuthorizationUsed(a.from, a.nonce)) {
    return { isValid: false, invalidReason: 'authorization nonce already used' };
  }
  return { isValid: true, payer: a.from };
}

export type SettleResult =
  | { ok: true; transaction: string; payer: string; network: string }
  | { ok: false; reason: string };

/**
 * Verify + settle an x402 payment for a resource. Idempotent per nonce (the
 * `x402Payments` collection), and the EIP-3009 nonce is single-use on-chain.
 */
export async function settlePayment(args: {
  header: string | undefined | null;
  payTo: string;
  amountUsdc: string;
  resource: string;
}): Promise<SettleResult> {
  const payload = parsePaymentHeader(args.header);
  if (!payload) return { ok: false, reason: 'missing or malformed X-PAYMENT header' };

  const verdict = await verifyPayment(payload, { payTo: args.payTo, amountUsdc: args.amountUsdc });
  if (!verdict.isValid) return { ok: false, reason: verdict.invalidReason };

  const a = payload.payload.authorization;
  const nonceKey = `${a.from.toLowerCase()}:${a.nonce.toLowerCase()}`;

  // Idempotency — a settled nonce returns its prior tx.
  if (firebaseAvailable) {
    const prior = await db.collection('x402Payments').doc(nonceKey).get();
    if (prior.exists) {
      const d = prior.data();
      if (d?.resource !== args.resource) {
        return { ok: false, reason: 'authorization already consumed for another resource' };
      }
      return { ok: true, transaction: d?.transaction, payer: a.from, network: X402_NETWORK };
    }
  }

  let txHash: Hex;
  try {
    txHash = await settleTransferWithAuthorization(a, payload.payload.signature);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'settlement failed' };
  }

  if (firebaseAvailable) {
    await db.collection('x402Payments').doc(nonceKey).set({
      from: a.from.toLowerCase(),
      to: a.to.toLowerCase(),
      nonce: a.nonce.toLowerCase(),
      value: a.value,
      resource: args.resource,
      transaction: txHash,
      network: X402_NETWORK,
      createdAt: new Date(),
    });
  }
  return { ok: true, transaction: txHash, payer: a.from, network: X402_NETWORK };
}

/** Encode the `X-PAYMENT-RESPONSE` header value (base64 SettleResponse). */
export function encodePaymentResponse(settle: {
  transaction: string;
  payer: string;
  network: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      success: true,
      transaction: settle.transaction,
      network: settle.network,
      payer: settle.payer,
    })
  ).toString('base64');
}
