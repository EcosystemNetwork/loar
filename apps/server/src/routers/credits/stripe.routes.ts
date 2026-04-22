/**
 * Stripe Payment Routes — Create payment intents for credit purchases.
 *
 * Flow:
 *   1. Frontend calls `createPaymentIntent` with packageId
 *   2. Server creates a Stripe PaymentIntent, returns clientSecret
 *   3. Frontend confirms payment using Stripe Elements
 *   4. On success, frontend calls `credits.purchaseWithFiat` with the pi_xxx ID
 *
 * Requires STRIPE_SECRET_KEY env var. If not set, card payments are disabled.
 */
import { z } from 'zod';
import Stripe from 'stripe';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { DEFAULT_PACKAGES } from './credits.routes';

let stripe: Stripe | null = null;

export function getStripe() {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripe = new Stripe(key);
  return stripe;
}

export const stripeRouter = router({
  /** Check if Stripe is configured */
  isAvailable: publicProcedure.query(() => {
    return { available: !!process.env.STRIPE_SECRET_KEY };
  }),

  /** Create a PaymentIntent for a credit package purchase. Amount is derived
   * server-side from the package id — never trusted from the client. */
  createPaymentIntent: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const stripeClient = getStripe();
      if (!stripeClient) {
        throw new Error('Card payments are not yet available. Please use ETH or $LOAR.');
      }

      const pkg = DEFAULT_PACKAGES.find((p) => p.id === input.packageId);
      if (!pkg) {
        throw new Error(`Unknown credit package: ${input.packageId}`);
      }
      const amountCents = Math.round(pkg.fiatPriceUsd * 100);
      if (amountCents < 50) {
        throw new Error('Package price is below Stripe minimum.');
      }

      const intent = await stripeClient.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        metadata: {
          packageId: input.packageId,
          userId: ctx.user.uid,
          userAddress: ctx.user.address ?? '',
          expectedAmountCents: String(amountCents),
        },
        automatic_payment_methods: { enabled: true },
      });

      return {
        clientSecret: intent.client_secret,
        paymentIntentId: intent.id,
      };
    }),

  /** Verify a completed payment (webhook alternative for simple setup) */
  verifyPayment: protectedProcedure
    .input(z.object({ paymentIntentId: z.string() }))
    .query(async ({ input }) => {
      const stripeClient = getStripe();
      if (!stripeClient) throw new Error('Stripe not configured');

      const intent = await stripeClient.paymentIntents.retrieve(input.paymentIntentId);
      return {
        status: intent.status,
        amount: intent.amount,
        currency: intent.currency,
        packageId: intent.metadata?.packageId,
        succeeded: intent.status === 'succeeded',
      };
    }),
});

/**
 * Server-side Stripe PaymentIntent verification.
 * Confirms:
 *   1. Stripe is configured
 *   2. The PaymentIntent exists and status === 'succeeded'
 *   3. The metadata.packageId matches the requested package
 *   4. The amount matches the expected package price
 *
 * Throws on any mismatch so callers can reject the purchase.
 */
export async function verifyStripePayment(
  paymentIntentId: string,
  expectedPackageId: string,
  expectedAmountCents: number,
  expectedUserId?: string
): Promise<void> {
  const stripeClient = getStripe();
  if (!stripeClient) {
    throw new Error(
      'Card payments are not available. Stripe is not configured. Please use ETH or $LOAR.'
    );
  }

  if (!paymentIntentId.startsWith('pi_')) {
    throw new Error(
      'Invalid payment reference. Card payments require a Stripe PaymentIntent ID (pi_...).'
    );
  }

  const intent = await stripeClient.paymentIntents.retrieve(paymentIntentId);

  if (intent.status !== 'succeeded') {
    throw new Error(
      `Payment has not been completed. Current status: ${intent.status}. Please complete payment before purchasing credits.`
    );
  }

  if (intent.metadata?.packageId !== expectedPackageId) {
    throw new Error(
      'Payment metadata does not match the requested package. Do not reuse payment intents across packages.'
    );
  }

  if (intent.amount < expectedAmountCents) {
    throw new Error(
      `Payment amount ($${(intent.amount / 100).toFixed(2)}) is less than the package price ($${(expectedAmountCents / 100).toFixed(2)}).`
    );
  }

  // C4 fix: Verify the payment was created by the authenticated user
  if (expectedUserId && intent.metadata?.userId !== expectedUserId) {
    throw new Error(
      'Payment was not created by your account. You can only claim credits for your own payments.'
    );
  }
}
