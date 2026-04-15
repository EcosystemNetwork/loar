/**
 * Platform Subscription Router — Stripe-based monthly plans with credit refreshes.
 *
 * Tiers: Starter, Plus, Ultra (popular), Business
 * Each tier includes monthly credits that refresh on billing cycle.
 * One-time credit top-ups remain available alongside subscriptions.
 *
 * Flow:
 *   1. User picks a tier on /pricing
 *   2. createCheckoutSession → Stripe Checkout (subscription mode)
 *   3. Stripe webhook invoice.paid → credit refresh
 *   4. createPortalSession → Stripe Billing Portal for management
 */
import { z } from 'zod';
import { publicProcedure, protectedProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { getStripe } from '../credits/stripe.routes';
import { getPlatformConfig } from '../../services/platformConfig';
import { createPublicClient, http, parseUnits, type Hash } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';

// ── $LOAR pricing ────────────────────────────────────────────────────
// Each $LOAR = $0.0025 (0.25 cents)
const LOAR_PRICE_USD = 0.0025;

const LOAR_TOKEN_ADDRESS = (process.env.LOAR_TOKEN_ADDRESS ?? '') as `0x${string}`;
const TREASURY_ADDRESS = (process.env.TREASURY_ADDRESS ?? '') as `0x${string}`;
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const;

function getChainClient(chainId?: number) {
  if (chainId === baseSepolia.id) {
    return createPublicClient({
      chain: baseSepolia,
      transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
    });
  }
  return createPublicClient({
    chain: sepolia,
    transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
  });
}

/** Calculate $LOAR tokens needed for a USD price */
function usdToLoarTokens(usd: number): number {
  return Math.ceil(usd / LOAR_PRICE_USD);
}

// ── Tier definitions ─────────────────────────────────────────────────

export interface SubscriptionTierFeatures {
  maxVideoQuality: 'standard' | 'premium';
  maxConcurrentJobs: number;
  priorityQueue: boolean;
  privateContent: boolean;
  apiAccess: boolean;
  maxStorageGb: number;
  teamSeats: number;
  commercialLicense: boolean;
  customModels: boolean;
  dedicatedSupport: boolean;
}

export interface SubscriptionTier {
  id: string;
  name: string;
  monthlyPriceUsd: number;
  annualPriceUsd: number; // per month when billed annually
  monthlyCredits: number;
  popular?: boolean;
  features: SubscriptionTierFeatures;
  featureList: string[]; // UI display bullets
}

export const PLATFORM_TIERS: SubscriptionTier[] = [
  {
    id: 'starter',
    name: 'Starter',
    monthlyPriceUsd: 15,
    annualPriceUsd: 12,
    monthlyCredits: 150,
    features: {
      maxVideoQuality: 'standard',
      maxConcurrentJobs: 1,
      priorityQueue: false,
      privateContent: false,
      apiAccess: false,
      maxStorageGb: 5,
      teamSeats: 0,
      commercialLicense: false,
      customModels: false,
      dedicatedSupport: false,
    },
    featureList: [
      '150 credits/month',
      '720p video generation',
      '1 concurrent job',
      '5 GB storage',
      'Community support',
    ],
  },
  {
    id: 'plus',
    name: 'Plus',
    monthlyPriceUsd: 40,
    annualPriceUsd: 32,
    monthlyCredits: 1000,
    features: {
      maxVideoQuality: 'premium',
      maxConcurrentJobs: 3,
      priorityQueue: false,
      privateContent: true,
      apiAccess: false,
      maxStorageGb: 25,
      teamSeats: 0,
      commercialLicense: false,
      customModels: false,
      dedicatedSupport: false,
    },
    featureList: [
      '1,000 credits/month',
      '4K video generation',
      '3 concurrent jobs',
      '25 GB storage',
      'Private content',
      'All AI models',
    ],
  },
  {
    id: 'ultra',
    name: 'Ultra',
    monthlyPriceUsd: 80,
    annualPriceUsd: 64,
    monthlyCredits: 3500,
    popular: true,
    features: {
      maxVideoQuality: 'premium',
      maxConcurrentJobs: 5,
      priorityQueue: true,
      privateContent: true,
      apiAccess: true,
      maxStorageGb: 100,
      teamSeats: 0,
      commercialLicense: true,
      customModels: true,
      dedicatedSupport: false,
    },
    featureList: [
      '3,500 credits/month',
      '4K video generation',
      '5 concurrent jobs',
      'Priority queue',
      '100 GB storage',
      'API access',
      'Commercial license',
      'Custom model training',
    ],
  },
  {
    id: 'business',
    name: 'Business',
    monthlyPriceUsd: 150,
    annualPriceUsd: 120,
    monthlyCredits: 8000,
    features: {
      maxVideoQuality: 'premium',
      maxConcurrentJobs: 10,
      priorityQueue: true,
      privateContent: true,
      apiAccess: true,
      maxStorageGb: 500,
      teamSeats: 5,
      commercialLicense: true,
      customModels: true,
      dedicatedSupport: true,
    },
    featureList: [
      '8,000 credits/month',
      '4K video generation',
      '10 concurrent jobs',
      'Priority queue',
      '500 GB storage',
      'API access',
      'Commercial license',
      'Custom model training',
      '5 team seats',
      'Dedicated support',
    ],
  },
];

// ── Stripe Price ID mapping ──────────────────────────────────────────

function getStripePriceId(tierId: string, billing: 'monthly' | 'annual'): string | null {
  const prefix = billing === 'annual' ? 'STRIPE_PRICE_ANNUAL_' : 'STRIPE_PRICE_';
  return process.env[`${prefix}${tierId.toUpperCase()}`] ?? null;
}

// ── Firestore helpers ────────────────────────────────────────────────

const subscriptionsCol = () => db.collection('platformSubscriptions');

export async function getUserSubscription(uid: string) {
  const doc = await subscriptionsCol().doc(uid.toLowerCase()).get();
  if (!doc.exists) return null;
  return doc.data() as {
    uid: string;
    tierId: string;
    stripeSubscriptionId: string;
    stripeCustomerId: string;
    status: string;
    currentPeriodStart: any;
    currentPeriodEnd: any;
    cancelAtPeriodEnd: boolean;
    creditsRefreshedAt: any;
    createdAt: any;
    updatedAt: any;
  };
}

// ── Router ───────────────────────────────────────────────────────────

export const platformSubscriptionsRouter = router({
  /** Get all subscription tiers with pricing (USD + $LOAR) */
  getTiers: publicProcedure.query(async () => {
    return PLATFORM_TIERS.map((tier) => ({
      ...tier,
      loarPriceUsd: LOAR_PRICE_USD,
      // $LOAR token amounts needed
      monthlyLoarTokens: usdToLoarTokens(tier.monthlyPriceUsd),
      annualLoarTokens: usdToLoarTokens(tier.annualPriceUsd),
    }));
  }),

  /** Get the current user's active subscription */
  getMySubscription: protectedProcedure.query(async ({ ctx }) => {
    const sub = await getUserSubscription(ctx.user.uid);
    if (!sub) return null;

    const tier = PLATFORM_TIERS.find((t) => t.id === sub.tierId);
    return {
      ...sub,
      tier: tier ?? null,
      currentPeriodStart:
        sub.currentPeriodStart?.toDate?.()?.toISOString?.() ?? sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd?.toDate?.()?.toISOString?.() ?? sub.currentPeriodEnd,
      creditsRefreshedAt:
        sub.creditsRefreshedAt?.toDate?.()?.toISOString?.() ?? sub.creditsRefreshedAt,
    };
  }),

  /** Create a Stripe Checkout Session for a subscription */
  createCheckoutSession: protectedProcedure
    .input(
      z.object({
        tierId: z.enum(['starter', 'plus', 'ultra', 'business']),
        billing: z.enum(['monthly', 'annual']).default('monthly'),
        successUrl: z.string().url(),
        cancelUrl: z.string().url(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const stripeClient = getStripe();
      if (!stripeClient) {
        throw new Error('Stripe is not configured. Card payments unavailable.');
      }

      const priceId = getStripePriceId(input.tierId, input.billing);
      if (!priceId) {
        throw new Error(
          `Stripe price not configured for ${input.tierId}/${input.billing}. Set STRIPE_PRICE_${input.billing === 'annual' ? 'ANNUAL_' : ''}${input.tierId.toUpperCase()} env var.`
        );
      }

      // Check for existing subscription
      const existing = await getUserSubscription(ctx.user.uid);
      const customerOptions: Record<string, any> = {};

      if (existing?.stripeCustomerId) {
        customerOptions.customer = existing.stripeCustomerId;
      } else {
        customerOptions.customer_email = ctx.user.email || undefined;
      }

      const session = await stripeClient.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        ...customerOptions,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata: {
          userId: ctx.user.uid,
          tierId: input.tierId,
          billing: input.billing,
        },
        subscription_data: {
          metadata: {
            userId: ctx.user.uid,
            tierId: input.tierId,
          },
        },
      });

      return { url: session.url, sessionId: session.id };
    }),

  /** Create a Stripe Billing Portal session for subscription management */
  createPortalSession: protectedProcedure
    .input(z.object({ returnUrl: z.string().url() }))
    .mutation(async ({ input, ctx }) => {
      const stripeClient = getStripe();
      if (!stripeClient) throw new Error('Stripe is not configured.');

      const sub = await getUserSubscription(ctx.user.uid);
      if (!sub?.stripeCustomerId) {
        throw new Error('No active subscription found.');
      }

      const session = await stripeClient.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: input.returnUrl,
      });

      return { url: session.url };
    }),

  /** Cancel subscription at period end */
  cancelSubscription: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await getUserSubscription(ctx.user.uid);
    if (!sub) throw new Error('No active subscription found.');

    // Stripe-managed subs
    if (sub.stripeSubscriptionId) {
      const stripeClient = getStripe();
      if (stripeClient) {
        await stripeClient.subscriptions.update(sub.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
      }
    }

    await subscriptionsCol().doc(ctx.user.uid.toLowerCase()).update({
      cancelAtPeriodEnd: true,
      updatedAt: new Date(),
    });

    return { ok: true };
  }),

  /**
   * Subscribe with $LOAR tokens — on-chain payment.
   *
   * User transfers $LOAR to treasury, then calls this with the txHash.
   * Server verifies the transfer, creates a 30-day subscription, and issues credits.
   *
   * Each $LOAR = $0.0025 (0.25 cents).
   */
  subscribeWithLoar: protectedProcedure
    .input(
      z.object({
        tierId: z.enum(['starter', 'plus', 'ultra', 'business']),
        billing: z.enum(['monthly', 'annual']).default('monthly'),
        txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid transaction hash'),
        loarAmount: z.string(), // $LOAR tokens transferred (wei/18-decimal string)
        chainId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tier = PLATFORM_TIERS.find((t) => t.id === input.tierId);
      if (!tier) throw new Error('Invalid tier');

      const priceUsd = input.billing === 'annual' ? tier.annualPriceUsd : tier.monthlyPriceUsd;
      const expectedLoarTokens = usdToLoarTokens(priceUsd);
      const expectedWei = parseUnits(expectedLoarTokens.toString(), 18);

      // Verify on-chain $LOAR transfer
      if (!LOAR_TOKEN_ADDRESS || LOAR_TOKEN_ADDRESS === '0x') {
        throw new Error('LOAR_TOKEN_ADDRESS is not configured');
      }
      if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x') {
        throw new Error('TREASURY_ADDRESS is not configured');
      }

      const client = getChainClient(input.chainId);

      let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
      try {
        receipt = await client.getTransactionReceipt({ hash: input.txHash as Hash });
      } catch {
        throw new Error('Transaction not found on-chain. Wait for confirmation and try again.');
      }

      if (receipt.status !== 'success') {
        throw new Error('Transaction was reverted on-chain.');
      }

      // Find $LOAR Transfer event to treasury
      const transferLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() === LOAR_TOKEN_ADDRESS.toLowerCase() &&
          log.topics[0] === TRANSFER_TOPIC &&
          log.topics[2] &&
          `0x${log.topics[2].slice(26)}`.toLowerCase() === TREASURY_ADDRESS.toLowerCase()
      );

      if (!transferLog) {
        throw new Error('No $LOAR transfer to treasury found in this transaction.');
      }

      const transferredWei = BigInt(transferLog.data);
      const minRequired = (expectedWei * 99n) / 100n; // 1% tolerance
      if (transferredWei < minRequired) {
        throw new Error(
          `Insufficient $LOAR. Expected ${expectedLoarTokens} LOAR, got ${(transferredWei / 10n ** 18n).toString()}.`
        );
      }

      // Dedup
      const dedupKey = `sub-loar-${input.txHash}`;
      const existingTx = await db.collection('creditTransactions').doc(dedupKey).get();
      if (existingTx.exists) {
        throw new Error('This transaction has already been used.');
      }

      // Calculate subscription period
      const now = new Date();
      const periodMonths = input.billing === 'annual' ? 12 : 1;
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + periodMonths);

      const uid = ctx.user.uid.toLowerCase();

      // Create subscription + issue credits atomically
      await db.runTransaction(async (tx) => {
        const txDocRef = db.collection('creditTransactions').doc(dedupKey);
        const txDoc = await tx.get(txDocRef);
        if (txDoc.exists) return; // Double-check dedup

        // Write subscription record
        const subRef = subscriptionsCol().doc(uid);
        tx.set(subRef, {
          uid,
          tierId: input.tierId,
          stripeSubscriptionId: null, // $LOAR-paid, no Stripe
          stripeCustomerId: null,
          status: 'active',
          paymentMethod: 'loar',
          billing: input.billing,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
          creditsRefreshedAt: now,
          loarPaid: input.loarAmount,
          txHash: input.txHash,
          createdAt: now,
          updatedAt: now,
        });

        // Issue credits
        const creditsRef = db.collection('userCredits').doc(uid);
        const creditsDoc = await tx.get(creditsRef);
        const current = creditsDoc.data();
        const currentBalance = current?.balance ?? 0;

        // For annual, issue all 12 months up front
        const totalCredits = tier.monthlyCredits * periodMonths;

        tx.set(
          creditsRef,
          {
            balance: currentBalance + totalCredits,
            totalPurchased: (current?.totalPurchased ?? 0) + totalCredits,
            updatedAt: now,
            ...(creditsDoc.exists ? {} : { createdAt: now, totalSpent: 0, totalBonusReceived: 0 }),
          },
          { merge: true }
        );

        tx.set(txDocRef, {
          uid,
          type: 'subscription_purchase',
          tierId: input.tierId,
          tierName: tier.name,
          billing: input.billing,
          credits: totalCredits,
          bonusCredits: 0,
          totalCredits,
          paymentMethod: 'loar',
          loarTokensPaid: input.loarAmount,
          pricePaidUsd: priceUsd * (input.billing === 'annual' ? 12 : 1),
          txHash: input.txHash,
          createdAt: now,
        });
      });

      const totalCredits = tier.monthlyCredits * periodMonths;
      return {
        ok: true,
        tierId: input.tierId,
        tierName: tier.name,
        billing: input.billing,
        creditsIssued: totalCredits,
        periodEnd: periodEnd.toISOString(),
        loarPaid: expectedLoarTokens,
      };
    }),
});

// ── Webhook helpers (called from stripe-webhook.ts) ──────────────────

/**
 * Handle a successful subscription checkout — create the subscription record
 * and issue the first month's credits.
 */
export async function handleCheckoutCompleted(session: any) {
  const userId = session.metadata?.userId;
  const tierId = session.metadata?.tierId;
  if (!userId || !tierId) return;

  const tier = PLATFORM_TIERS.find((t) => t.id === tierId);
  if (!tier) return;

  const subscription = await getStripe()?.subscriptions.retrieve(session.subscription);
  if (!subscription) return;

  const now = new Date();
  await subscriptionsCol()
    .doc(userId.toLowerCase())
    .set({
      uid: userId.toLowerCase(),
      tierId,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: subscription.customer,
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      creditsRefreshedAt: now,
      createdAt: now,
      updatedAt: now,
    });

  // Issue first month's credits
  await issueSubscriptionCredits(userId, tier, `checkout-${session.id}`);
}

/**
 * Handle a recurring invoice payment — refresh monthly credits.
 */
export async function handleInvoicePaid(invoice: any) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  // Find the user by subscription ID
  const snap = await subscriptionsCol()
    .where('stripeSubscriptionId', '==', subscriptionId)
    .limit(1)
    .get();
  if (snap.empty) return;

  const subDoc = snap.docs[0];
  const subData = subDoc.data();
  const tier = PLATFORM_TIERS.find((t) => t.id === subData.tierId);
  if (!tier) return;

  // Dedup: don't double-credit for the same invoice
  const dedupKey = `sub-refresh-${invoice.id}`;
  const existingTx = await db.collection('creditTransactions').doc(dedupKey).get();
  if (existingTx.exists) return;

  await issueSubscriptionCredits(subData.uid, tier, dedupKey);

  // Update subscription period
  const subscription = await getStripe()?.subscriptions.retrieve(subscriptionId);
  if (subscription) {
    await subDoc.ref.update({
      status: subscription.status,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      creditsRefreshedAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

/**
 * Handle subscription updates (tier changes, cancellations).
 */
export async function handleSubscriptionUpdated(subscription: any) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;

  const tierId = subscription.metadata?.tierId;
  await subscriptionsCol()
    .doc(userId.toLowerCase())
    .update({
      status: subscription.status,
      tierId: tierId || undefined,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodStart: new Date(subscription.current_period_start * 1000),
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      updatedAt: new Date(),
    });
}

/**
 * Handle subscription deletion (expired/fully canceled).
 */
export async function handleSubscriptionDeleted(subscription: any) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;

  await subscriptionsCol().doc(userId.toLowerCase()).update({
    status: 'canceled',
    updatedAt: new Date(),
  });
}

// ── Internal: issue credits ──────────────────────────────────────────

async function issueSubscriptionCredits(userId: string, tier: SubscriptionTier, dedupKey: string) {
  const uid = userId.toLowerCase();
  const creditsRef = db.collection('userCredits').doc(uid);
  const txRef = db.collection('creditTransactions').doc(dedupKey);

  await db.runTransaction(async (tx) => {
    const txDoc = await tx.get(txRef);
    if (txDoc.exists) return; // Already processed

    const creditsDoc = await tx.get(creditsRef);
    const current = creditsDoc.data();
    const currentBalance = current?.balance ?? 0;

    const now = new Date();
    tx.set(
      creditsRef,
      {
        balance: currentBalance + tier.monthlyCredits,
        totalPurchased: (current?.totalPurchased ?? 0) + tier.monthlyCredits,
        updatedAt: now,
        ...(creditsDoc.exists ? {} : { createdAt: now, totalSpent: 0, totalBonusReceived: 0 }),
      },
      { merge: true }
    );

    tx.set(txRef, {
      uid,
      type: 'subscription_refresh',
      tierId: tier.id,
      tierName: tier.name,
      credits: tier.monthlyCredits,
      bonusCredits: 0,
      totalCredits: tier.monthlyCredits,
      paymentMethod: 'subscription',
      createdAt: now,
    });
  });
}
