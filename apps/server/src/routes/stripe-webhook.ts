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
      // Dedup: check if credits were already issued for this PaymentIntent
      const existing = await db
        .collection('creditTransactions')
        .where('paymentRef', '==', intent.id)
        .limit(1)
        .get();

      if (!existing.empty) {
        // Credits already issued (frontend completed first) — skip
        return c.json({ received: true, alreadyProcessed: true });
      }

      const pkg = DEFAULT_PACKAGES.find((p) => p.id === packageId);
      if (!pkg) {
        console.error(`[Stripe Webhook] Unknown package: ${packageId}`);
        return c.json({ received: true, error: 'Unknown package' });
      }

      const totalCredits = pkg.credits + pkg.bonusCredits;

      // Issue credits
      const userRef = db.collection('userCredits').doc(userId);
      const userDoc = await userRef.get();

      const updateData: Record<string, any> = {
        balance: (userDoc.data()?.balance || 0) + totalCredits,
        totalPurchased: (userDoc.data()?.totalPurchased || 0) + pkg.credits,
        totalBonusReceived: (userDoc.data()?.totalBonusReceived || 0) + pkg.bonusCredits,
        totalFiatPurchases: (userDoc.data()?.totalFiatPurchases || 0) + 1,
        updatedAt: new Date(),
      };

      if (userDoc.exists) {
        await userRef.update(updateData);
      } else {
        await userRef.set({
          uid: userId,
          ...updateData,
          totalSpent: 0,
          totalLoarPurchases: 0,
          createdAt: new Date(),
        });
      }

      // Record transaction
      await db.collection('creditTransactions').add({
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

      console.log(`[Stripe Webhook] Issued ${totalCredits} credits to ${userId} for ${packageId}`);
    } catch (err) {
      console.error('[Stripe Webhook] Failed to issue credits:', err);
      // Return 500 so Stripe retries
      return c.json({ error: 'Failed to process' }, 500);
    }
  }

  return c.json({ received: true });
});
