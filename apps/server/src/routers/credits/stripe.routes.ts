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
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';

let stripe: any = null;

function getStripe() {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;

  try {
    // Dynamic import to avoid crash if stripe package not installed
    const Stripe = require('stripe');
    stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' });
    return stripe;
  } catch {
    console.warn('[Stripe] stripe package not installed');
    return null;
  }
}

export const stripeRouter = router({
  /** Check if Stripe is configured */
  isAvailable: publicProcedure.query(() => {
    return { available: !!process.env.STRIPE_SECRET_KEY };
  }),

  /** Create a PaymentIntent for a credit package purchase */
  createPaymentIntent: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        /** Price in USD cents (server verifies against package) */
        amountCents: z.number().int().min(50),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const stripeClient = getStripe();
      if (!stripeClient) {
        throw new Error('Card payments are not yet available. Please use ETH or $LOAR.');
      }

      const intent = await stripeClient.paymentIntents.create({
        amount: input.amountCents,
        currency: 'usd',
        metadata: {
          packageId: input.packageId,
          userId: ctx.user.uid,
          userAddress: ctx.user.address,
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
