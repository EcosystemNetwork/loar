/**
 * x402-gated demo endpoints — a paid API an AI agent settles on Arc.
 *
 *   POST /api/x402/echo
 *     - no X-PAYMENT header        → 402 + payment requirements
 *     - valid X-PAYMENT (Arc tx)   → 200 + the result
 *
 * This is a runnable example of the Circle "agentic economy" pattern: an
 * autonomous agent pays per call. Price + recipient are env-configurable.
 *
 * Env:
 *   X402_PAY_TO     — address that receives payment (defaults to TREASURY_ADDRESS)
 *   X402_PRICE_USDC — price per call (defaults to "0.01")
 */
import { Hono } from 'hono';
import { parseUnits } from 'viem';
import { USDC_DECIMALS } from '../lib/arc';
import {
  buildPaymentRequired,
  settlePayment,
  encodePaymentResponse,
  parsePaymentHeader,
} from '../lib/x402';

export const x402Routes = new Hono();

/**
 * Cheap, RPC-free pre-validation of the X-PAYMENT header. Rejects malformed,
 * misdirected, underpaid, or expired authorizations BEFORE settlePayment does
 * any on-chain work (signature recovery domain read, nonce read, and the gas-
 * paying broadcast). Returns a human reason on failure, or null when the
 * payload passes these local checks and is worth settling on-chain.
 *
 * Deliberately does NOT recover the signature here — that needs the token's
 * EIP-712 domain (an RPC on cold start) and is performed by settlePayment.
 * The goal is to drop the obvious garbage an attacker can spray for free.
 */
function localPaymentPrecheck(args: {
  header: string | undefined | null;
  payTo: string;
  amountUsdc: string;
}): string | null {
  const payload = parsePaymentHeader(args.header);
  if (!payload) return 'missing or malformed X-PAYMENT header';

  const a = payload.payload.authorization;
  if (!a?.to || a.to.toLowerCase() !== args.payTo.toLowerCase()) {
    return 'authorization `to` != payTo';
  }

  let required: bigint;
  let value: bigint;
  try {
    required = parseUnits(args.amountUsdc, USDC_DECIMALS);
    value = BigInt(a.value);
  } catch {
    return 'bad value';
  }
  if (value < required) return 'amount below required';

  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validAfter) > now) return 'not yet valid';
  if (Number(a.validBefore) <= now) return 'authorization expired';

  return null;
}

function payTo(): string | null {
  return process.env.X402_PAY_TO || process.env.TREASURY_ADDRESS || null;
}
function price(): string {
  return process.env.X402_PRICE_USDC || '0.01';
}

x402Routes.post('/echo', async (c) => {
  const resource = '/api/x402/echo';
  const recipient = payTo();
  if (!recipient) {
    return c.json({ error: 'x402 not configured (set X402_PAY_TO)' }, 503);
  }

  const payment = c.req.header('X-PAYMENT');
  if (!payment) {
    return c.json(
      await buildPaymentRequired({
        amountUsdc: price(),
        payTo: recipient,
        resource,
        description: 'Echo service — pay-per-call demo',
      }),
      402
    );
  }

  // Cheap local pre-check — reject obviously-bad payloads before any RPC/gas.
  const precheckError = localPaymentPrecheck({
    header: payment,
    payTo: recipient,
    amountUsdc: price(),
  });
  if (precheckError) {
    return c.json(
      await buildPaymentRequired({
        amountUsdc: price(),
        payTo: recipient,
        resource,
        error: precheckError,
      }),
      402
    );
  }

  const settled = await settlePayment({
    header: payment,
    payTo: recipient,
    amountUsdc: price(),
    resource,
  });
  if (!settled.ok) {
    return c.json(
      await buildPaymentRequired({
        amountUsdc: price(),
        payTo: recipient,
        resource,
        error: settled.reason,
      }),
      402
    );
  }

  // Payment confirmed + settled on-chain — do the (paid) work.
  c.header('X-PAYMENT-RESPONSE', encodePaymentResponse(settled));
  const body = await c.req.json().catch(() => ({}));
  return c.json({
    paid: true,
    transaction: settled.transaction,
    payer: settled.payer,
    network: settled.network,
    echo: body,
    servedAt: new Date().toISOString(),
  });
});
