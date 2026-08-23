/**
 * Stripe Webhook Handler
 *
 * Handles `payment_intent.succeeded` events to issue credits even when
 * the user closes their browser mid-checkout, and `charge.refunded` /
 * `charge.dispute.created` events to claw those credits back.
 *
 * Flow:
 *   1. Stripe sends POST /api/stripe/webhook with signed payload
 *   2. Server verifies signature using STRIPE_WEBHOOK_SECRET
 *   3. On payment_intent.succeeded: look up metadata (packageId, userId)
 *      and issue credits (dedup'd against personal + universe-pool purchases)
 *   4. On charge.refunded / charge.dispute.created: find the matching
 *      personal or universe-pool purchase by payment intent ID and debit
 *      the credits that were granted for it (SEC-1 — closes the "pay, claim
 *      credits, then refund/chargeback" gap now that `verifyStripePayment`
 *      only rejects payments *already* refunded/disputed at claim time).
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

      // Defense-in-depth: never grant credits if the actual paid amount is less
      // than the package price. createPaymentIntent derives amount server-side,
      // but if a legacy or tampered intent arrives we refuse to issue credits.
      const expectedCents = Math.round(pkg.fiatPriceUsd * 100);
      if (typeof intent.amount !== 'number' || intent.amount < expectedCents) {
        console.error(
          `[Stripe Webhook] Amount mismatch for ${intent.id}: paid=${intent.amount} expected>=${expectedCents} package=${packageId}`
        );
        // 400 — do not retry; this is a permanent mismatch
        return c.json({ error: 'amount mismatch' }, 400);
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

  if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    // Both event payloads carry the originating PaymentIntent ID: `charge.refunded`'s
    // object is the Charge itself, `charge.dispute.created`'s object is a Dispute
    // that also exposes `payment_intent`.
    const obj = event.data.object;
    const paymentIntentId: string | undefined =
      typeof obj.payment_intent === 'string'
        ? obj.payment_intent
        : (obj.payment_intent?.id ?? obj.id);

    if (!paymentIntentId) {
      return c.json({ received: true });
    }

    try {
      // Best-effort clawback, best-effort logged: claw back whichever grant(s)
      // this PaymentIntent funded. Debit is clamped at 0 (never goes negative)
      // since credits may have already been spent — that shortfall is logged
      // for manual reconciliation rather than blocking the webhook.
      let clawedBack = false;

      // 1. Personal credit purchase (purchaseWithFiat / this webhook's own
      //    payment_intent.succeeded branch both write to this same doc id).
      const personalTxRef = db.collection('creditTransactions').doc(`fiat-${paymentIntentId}`);
      await db.runTransaction(async (tx) => {
        const dedupDoc = await tx.get(personalTxRef);
        if (!dedupDoc.exists) return;
        const data = dedupDoc.data() ?? {};
        if (data.refunded) return; // already clawed back
        const totalCredits = (data.totalCredits as number) || 0;
        const uid = data.uid as string | undefined;
        if (!uid || totalCredits <= 0) return;

        const userRef = db.collection('userCredits').doc(uid);
        const userDoc = await tx.get(userRef);
        const prevBalance = (userDoc.data()?.balance as number) || 0;
        const newBalance = Math.max(0, prevBalance - totalCredits);

        tx.set(userRef, { balance: newBalance, updatedAt: new Date() }, { merge: true });
        tx.set(
          personalTxRef,
          {
            refunded: true,
            refundedAt: new Date(),
            refundEventType: event.type,
            creditsClawedBack: prevBalance - newBalance,
          },
          { merge: true }
        );
        clawedBack = true;
        if (newBalance === 0 && prevBalance < totalCredits) {
          console.error(
            `[Stripe Webhook] Refund clawback for ${paymentIntentId}: user ${uid} balance was insufficient ` +
              `to fully claw back ${totalCredits} credits (only had ${prevBalance}). Flagged for manual review.`
          );
        }
      });

      // 2. Universe shared-pool funding (fundPool writes fund-{universeId}-{paymentRef}).
      const poolTxSnap = await db
        .collection('universeCreditTransactions')
        .where('paymentRef', '==', paymentIntentId)
        .where('type', '==', 'fund')
        .limit(1)
        .get();
      if (!poolTxSnap.empty) {
        const poolTxRef = poolTxSnap.docs[0].ref;
        await db.runTransaction(async (tx) => {
          const dedupDoc = await tx.get(poolTxRef);
          if (!dedupDoc.exists) return;
          const data = dedupDoc.data() ?? {};
          if (data.refunded) return;
          const credits = (data.credits as number) || 0;
          const universeId = data.universeId as string | undefined;
          if (!universeId || credits <= 0) return;

          const poolRef = db.collection('universeCredits').doc(universeId);
          const poolDoc = await tx.get(poolRef);
          const prevBalance = (poolDoc.data()?.balance as number) || 0;
          const newBalance = Math.max(0, prevBalance - credits);

          tx.set(poolRef, { balance: newBalance, updatedAt: new Date() }, { merge: true });
          tx.set(
            poolTxRef,
            {
              refunded: true,
              refundedAt: new Date(),
              refundEventType: event.type,
              creditsClawedBack: prevBalance - newBalance,
            },
            { merge: true }
          );
          clawedBack = true;
          if (newBalance === 0 && prevBalance < credits) {
            console.error(
              `[Stripe Webhook] Refund clawback for ${paymentIntentId}: universe ${universeId} pool balance ` +
                `was insufficient to fully claw back ${credits} credits (only had ${prevBalance}). Flagged for manual review.`
            );
          }
        });
      }

      console.log(
        `[Stripe Webhook] Processed ${event.type} for ${paymentIntentId}: clawedBack=${clawedBack}`
      );
    } catch (err) {
      console.error(`[Stripe Webhook] Failed to process ${event.type} clawback:`, err);
      // Return 500 so Stripe retries
      return c.json({ error: 'Failed to process' }, 500);
    }
  }

  return c.json({ received: true });
});
