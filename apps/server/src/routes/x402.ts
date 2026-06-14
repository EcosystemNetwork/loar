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
import { buildPaymentRequired, settlePayment, encodePaymentResponse } from '../lib/x402';

export const x402Routes = new Hono();

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
