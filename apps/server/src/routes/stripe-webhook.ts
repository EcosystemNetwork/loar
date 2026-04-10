/**
 * Stripe Webhook Handler
 *
 * Handles `payment_intent.succeeded` events to issue credits even when
 * the user closes their browser mid-checkout.
 *
 * Flow:
 *   1. Stripe sends POST /api/stripe/webhook with signed payload
 *   2. Server verifies signature using STRIPE_WEBHOOK_SECRET
 *   3. On payment_intent.succeeded: look up metadata (packageId, userId)
 *   4. If credits haven't been issued yet (dedup check), issue them
 *
 * Requires: STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET env vars.
 */
import { Hono } from 'hono';
import { db } from '../lib/firebase';
import { getStripe } from '../routers/credits/stripe.routes';
import { DEFAULT_PACKAGES } from '../routers/credits/credits.routes';

export const stripeWebhookRoutes = new Hono();

stripeWebhookRoutes.post('/webhook', async (c) => {
  const stripeClient = getStripe();
  if (!stripeClient) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return c.json({ error: 'Webhook secret not configured' }, 503);
  }

  const sig = c.req.header('stripe-signature');
  if (!sig) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  // Stripe requires the raw body for signature verification
  const rawBody = await c.req.text();

  let event: any;
  try {
    event = stripeClient.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const { packageId, userId } = intent.metadata ?? {};

    if (!packageId || !userId) {
      // Not a credit purchase PaymentIntent — ignore
      return c.json({ received: true });
    }

    try {
      const pkg = DEFAULT_PACKAGES.find((p) => p.id === packageId);
      if (!pkg) {
        console.error(`[Stripe Webhook] Unknown package: ${packageId}`);
        return c.json({ received: true, error: 'Unknown package' });
      }

      const totalCredits = pkg.credits + pkg.bonusCredits;

      // Atomic: dedup + balance update + tx record in one Firestore transaction
      const txDocId = `fiat-${intent.id}`;
      let alreadyProcessed = false;
      await db.runTransaction(async (tx) => {
        const dedupRef = db.collection('creditTransactions').doc(txDocId);
        const dedupDoc = await tx.get(dedupRef);
        if (dedupDoc.exists) {
          alreadyProcessed = true;
          return;
        }

        const userRef = db.collection('userCredits').doc(userId);
        const userDoc = await tx.get(userRef);
        const prev = userDoc.data() ?? {};

        tx.set(
          userRef,
          {
            uid: userId,
            balance: (prev.balance || 0) + totalCredits,
            totalPurchased: (prev.totalPurchased || 0) + pkg.credits,
            totalBonusReceived: (prev.totalBonusReceived || 0) + pkg.bonusCredits,
            totalFiatPurchases: (prev.totalFiatPurchases || 0) + 1,
            totalSpent: prev.totalSpent || 0,
            totalLoarPurchases: prev.totalLoarPurchases || 0,
            updatedAt: new Date(),
            ...(!userDoc.exists && { createdAt: new Date() }),
          },
          { merge: true }
        );

        tx.set(dedupRef, {
          id: txDocId,
          uid: userId,
          type: 'purchase',
          paymentMethod: 'card',
          packageId,
          packageName: pkg.name,
          credits: pkg.credits,
          bonusCredits: pkg.bonusCredits,
          totalCredits,
          pricePaidUsd: pkg.fiatPriceUsd,
          marginPercent: 35,
          paymentRef: intent.id,
          amountPaid: intent.amount,
          source: 'stripe_webhook',
          createdAt: new Date(),
        });
      });

      if (alreadyProcessed) {
        return c.json({ received: true, alreadyProcessed: true });
      }

      console.log(`[Stripe Webhook] Issued ${totalCredits} credits to ${userId} for ${packageId}`);
    } catch (err) {
      console.error('[Stripe Webhook] Failed to issue credits:', err);
      // Return 500 so Stripe retries
      return c.json({ error: 'Failed to process' }, 500);
    }
  }

  return c.json({ received: true });
});
