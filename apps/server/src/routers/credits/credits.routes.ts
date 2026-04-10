/**
 * Credits Router — $LOAR-powered generation credit system
 *
 * Dual-margin pricing:
 *   Credit card / ETH / other crypto → 35% margin
 *   $LOAR token payments → 25% margin + 10% bonus credits
 *
 * Credits are the internal unit consumed by all generation actions.
 * Users buy credit packages, then spend credits on generations.
 */
import { adminProcedure, protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { FIAT_MARGIN, LOAR_MARGIN, LOAR_TO_USD } from '../../services/video-models';
import { getPlatformConfig } from '../../services/platformConfig';
import { verifyStripePayment } from './stripe.routes';
import { createPublicClient, http, parseUnits, type Hash } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';

// ── Chain clients for on-chain tx verification ───────────────────────
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});

const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
});

/** Get the appropriate chain client based on chain ID. */
function getChainClient(chainId?: number) {
  if (chainId === baseSepolia.id) return baseSepoliaClient;
  return sepoliaClient; // default
}

/** Chain name for error messages. */
function getChainName(chainId?: number) {
  if (chainId === baseSepolia.id) return 'Base Sepolia';
  return 'Sepolia';
}

const LOAR_TOKEN_ADDRESS = (process.env.LOAR_TOKEN_ADDRESS ?? '') as `0x${string}`;
const TREASURY_ADDRESS = (process.env.TREASURY_ADDRESS ?? '') as `0x${string}`;

// ERC20 Transfer event topic
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const;

/**
 * Verify an ETH or native-crypto payment by checking that the tx:
 * 1. Has not already been used (deduplication against creditTransactions)
 * 2. Exists on-chain and was not reverted
 * 3. Was sent to TREASURY_ADDRESS
 * 4. Transferred at least the expected amount (when expectedWei is set and non-zero)
 */
async function verifyEthPayment(
  paymentRef: string,
  chainId?: number,
  expectedWei?: string
): Promise<void> {
  if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x') {
    throw new Error('TREASURY_ADDRESS is not configured on the server');
  }

  const existing = await db
    .collection('creditTransactions')
    .where('paymentRef', '==', paymentRef)
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new Error('This transaction has already been used to purchase credits');
  }

  const client = getChainClient(chainId);
  const chainName = getChainName(chainId);

  let tx: Awaited<ReturnType<typeof client.getTransaction>>;
  try {
    tx = await client.getTransaction({ hash: paymentRef as Hash });
  } catch {
    throw new Error(
      `Transaction not found on ${chainName}. Confirm it has been broadcast and included in a block.`
    );
  }

  const receipt = await client.getTransactionReceipt({ hash: paymentRef as Hash });
  if (receipt.status !== 'success') {
    throw new Error('Transaction was reverted on-chain. No credits will be issued.');
  }

  if (tx.to?.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
    throw new Error(
      'Transaction recipient does not match the platform treasury address. Ensure you sent funds to the correct address.'
    );
  }

  // Enforce minimum payment amount when a price is configured
  if (expectedWei && expectedWei !== '0') {
    const expected = BigInt(expectedWei);
    // Allow up to 1% underpayment to tolerate gas estimation variance
    const minRequired = (expected * 99n) / 100n;
    if (tx.value < minRequired) {
      throw new Error(
        `Insufficient ETH transferred. Expected ~${expectedWei} wei, got ${tx.value.toString()} wei.`
      );
    }
  }
}

async function verifyLoarPayment(
  txHash: string,
  expectedLoarWei: bigint,
  chainId?: number
): Promise<void> {
  if (!LOAR_TOKEN_ADDRESS || LOAR_TOKEN_ADDRESS === '0x') {
    throw new Error('LOAR_TOKEN_ADDRESS is not configured on the server');
  }
  if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x') {
    throw new Error('TREASURY_ADDRESS is not configured on the server');
  }

  // Deduplicate: reject if this tx hash was already used
  const existing = await db
    .collection('creditTransactions')
    .where('txHash', '==', txHash)
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new Error('This transaction has already been used to purchase credits');
  }

  const client = getChainClient(chainId);
  const chainName = getChainName(chainId);

  let receipt: Awaited<ReturnType<typeof client.getTransactionReceipt>>;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash as Hash });
  } catch {
    throw new Error(
      `Transaction not found on ${chainName}. Confirm it has been broadcast and wait for it to be included in a block.`
    );
  }

  if (receipt.status !== 'success') {
    throw new Error('Transaction was reverted on-chain. No credits will be issued.');
  }

  // Find a Transfer(from, to, amount) log from the $LOAR contract to the treasury
  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === LOAR_TOKEN_ADDRESS.toLowerCase() &&
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics[2] &&
      `0x${log.topics[2].slice(26)}`.toLowerCase() === TREASURY_ADDRESS.toLowerCase()
  );

  if (!transferLog) {
    throw new Error(
      'Transaction does not contain a $LOAR Transfer to the platform treasury. Ensure you sent $LOAR to the correct address.'
    );
  }

  // Decode the transfer amount from the log data
  const transferredWei = BigInt(transferLog.data);
  // Allow up to 1% underpayment to tolerate minor price drift
  const minRequired = (expectedLoarWei * 99n) / 100n;
  if (transferredWei < minRequired) {
    throw new Error(
      `Insufficient $LOAR transferred. Expected ~${expectedLoarWei.toString()} wei, got ${transferredWei.toString()} wei.`
    );
  }
}

const creditsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('userCredits');
};
const creditTxCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('creditTransactions');
};
const creditPackagesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('creditPackages');
};

// ── Payment Methods ───────────────────────────────────────────────────

type PaymentMethod = 'card' | 'eth' | 'crypto' | 'loar';

function getMarginForMethod(method: PaymentMethod): number {
  return method === 'loar' ? LOAR_MARGIN : FIAT_MARGIN;
}

function getMarginLabel(method: PaymentMethod): string {
  return method === 'loar' ? '25%' : '35%';
}

// ── Credit Packages (hardcoded defaults, overridable via Firestore) ───

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  /** USD price at 35% margin (card/ETH/crypto) */
  fiatPriceUsd: number;
  /** USD price at 25% margin ($LOAR) */
  loarPriceUsd: number;
  /** $LOAR token amount needed */
  loarTokenAmount: number;
  /** ETH price in wei (approximate, updated by admin) */
  ethPriceWei: string;
  popular: boolean;
  active: boolean;
  /** Extra bonus credits for $LOAR purchases (10% of base) */
  loarBonusCredits: number;
}

/** Base cost per credit in USD (what we pay providers on average) */
const BASE_CREDIT_COST_USD = 0.008;

// Static package *definitions* — credits and bonuses never change.
// Prices (fiatPriceUsd, loarPriceUsd, etc.) are computed dynamically
// from platformConfig so the admin can adjust margins without redeployment.
const PACKAGE_DEFINITIONS = [
  { id: 'starter', name: 'Starter', credits: 100, bonusCredits: 0, popular: false },
  { id: 'creator', name: 'Creator', credits: 500, bonusCredits: 50, popular: true },
  { id: 'pro', name: 'Pro', credits: 1500, bonusCredits: 200, popular: false },
  { id: 'studio', name: 'Studio', credits: 5000, bonusCredits: 1000, popular: false },
  { id: 'enterprise', name: 'Enterprise', credits: 20000, bonusCredits: 5000, popular: false },
] as const;

function buildPackage(
  id: string,
  name: string,
  credits: number,
  bonusCredits: number,
  popular: boolean,
  fiatMargin = FIAT_MARGIN,
  loarMargin = LOAR_MARGIN,
  loarBonusFraction = 0.1,
  baseCreditCostUsd = BASE_CREDIT_COST_USD
): CreditPackage {
  const baseCostUsd = credits * baseCreditCostUsd;
  const fiatPriceUsd = Math.round(baseCostUsd * fiatMargin * 100) / 100;
  const loarPriceUsd = Math.round(baseCostUsd * loarMargin * 100) / 100;
  const loarTokenAmount = Math.ceil(loarPriceUsd / LOAR_TO_USD);
  const loarBonusCredits = Math.floor(credits * loarBonusFraction);

  return {
    id,
    name,
    credits,
    bonusCredits,
    fiatPriceUsd,
    loarPriceUsd,
    loarTokenAmount,
    ethPriceWei: '0',
    popular,
    active: true,
    loarBonusCredits,
  };
}

/** Static defaults — used by other routers (e.g. universeTreasury) that don't need live pricing */
export const DEFAULT_PACKAGES: CreditPackage[] = PACKAGE_DEFINITIONS.map((p) =>
  buildPackage(p.id, p.name, p.credits, p.bonusCredits, p.popular)
);

/** Build packages with live margins from platformConfig */
async function buildPackagesFromConfig(): Promise<CreditPackage[]> {
  const cfg = await getPlatformConfig();
  return PACKAGE_DEFINITIONS.map((p) =>
    buildPackage(
      p.id,
      p.name,
      p.credits,
      p.bonusCredits,
      p.popular,
      cfg.fiatMargin,
      cfg.loarMargin,
      cfg.loarCreditBonusFraction,
      cfg.baseCreditCostUsd
    )
  );
}

// ── Generation Costs (credits per action) ─────────────────────────────

const GENERATION_COSTS: Record<string, number> = {
  image: 3,
  video_draft: 5,
  video_standard: 13,
  video_premium: 35,
  story: 5,
  spinoff: 20,
  character: 8,
  scene: 15,
  voiceover: 10,
  caption: 2,
  // Legacy mappings
  video: 13,
};

// ── Router ────────────────────────────────────────────────────────────

export const creditsRouter = router({
  // ── Balance ─────────────────────────────────────────────────────

  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const doc = await creditsCol().doc(ctx.user.uid).get();
    if (!doc.exists) {
      return {
        balance: 0,
        totalPurchased: 0,
        totalSpent: 0,
        totalBonusReceived: 0,
        totalLoarPurchases: 0,
        totalFiatPurchases: 0,
      };
    }
    const data = doc.data()!;
    return {
      balance: data.balance || 0,
      totalPurchased: data.totalPurchased || 0,
      totalSpent: data.totalSpent || 0,
      totalBonusReceived: data.totalBonusReceived || 0,
      totalLoarPurchases: data.totalLoarPurchases || 0,
      totalFiatPurchases: data.totalFiatPurchases || 0,
    };
  }),

  // ── Packages ────────────────────────────────────────────────────

  getPackages: publicProcedure.query(async () => {
    // Admin-configured overrides in Firestore take priority
    try {
      const snapshot = await creditPackagesCol()
        .where('active', '==', true)
        .orderBy('credits', 'asc')
        .get();

      if (snapshot.docs.length > 0) {
        return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as CreditPackage[];
      }
    } catch {
      // fall through to dynamic defaults
    }

    // Build with live margins from platformConfig
    return (await buildPackagesFromConfig()).filter((p) => p.active);
  }),

  // ── Purchase with Fiat / ETH / Crypto (35% margin) ─────────────

  purchaseWithFiat: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        paymentMethod: z.enum(['card', 'eth', 'crypto']),
        /** For card: Stripe payment intent ID. For ETH/crypto: tx hash */
        paymentRef: z.string(),
        amountPaid: z.string().optional(), // wei for ETH, USD cents for card
      })
    )
    .mutation(async ({ input, ctx }) => {
      const pkg = DEFAULT_PACKAGES.find((p) => p.id === input.packageId);
      if (!pkg || !pkg.active) throw new Error('Package not found or inactive');

      if (input.paymentMethod === 'eth' || input.paymentMethod === 'crypto') {
        // Verify on-chain: tx exists, confirmed, sent to treasury, correct amount
        await verifyEthPayment(input.paymentRef, undefined, pkg.ethPriceWei);
      } else {
        // card: Verify Stripe PaymentIntent succeeded with correct package and amount
        const expectedCents = Math.round(pkg.fiatPriceUsd * 100);
        await verifyStripePayment(input.paymentRef, input.packageId, expectedCents);

        // Deduplicate: reject if this PaymentIntent was already used
        const existing = await db
          .collection('creditTransactions')
          .where('paymentRef', '==', input.paymentRef)
          .limit(1)
          .get();
        if (!existing.empty) {
          throw new Error('This payment reference has already been used');
        }
      }

      const totalCredits = pkg.credits + pkg.bonusCredits;

      // Update user balance
      const userRef = creditsCol().doc(ctx.user.uid);
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
          uid: ctx.user.uid,
          ...updateData,
          totalSpent: 0,
          totalLoarPurchases: 0,
          createdAt: new Date(),
        });
      }

      // Record transaction
      await creditTxCol().add({
        id: randomUUID(),
        uid: ctx.user.uid,
        type: 'purchase',
        paymentMethod: input.paymentMethod,
        packageId: input.packageId,
        packageName: pkg.name,
        credits: pkg.credits,
        bonusCredits: pkg.bonusCredits,
        totalCredits,
        pricePaidUsd: pkg.fiatPriceUsd,
        marginPercent: 35,
        paymentRef: input.paymentRef,
        amountPaid: input.amountPaid || null,
        createdAt: new Date(),
      });

      return {
        ok: true,
        creditsAdded: totalCredits,
        baseCredits: pkg.credits,
        bonusCredits: pkg.bonusCredits,
        pricePaid: pkg.fiatPriceUsd,
        paymentMethod: input.paymentMethod,
        margin: '35%',
      };
    }),

  // ── Purchase with $LOAR (25% margin + 10% bonus) ───────────────

  purchaseWithLoar: protectedProcedure
    .input(
      z.object({
        packageId: z.string(),
        txHash: z.string(),
        loarAmount: z.string(), // $LOAR tokens transferred (wei units)
      })
    )
    .mutation(async ({ input, ctx }) => {
      const pkg = DEFAULT_PACKAGES.find((p) => p.id === input.packageId);
      if (!pkg || !pkg.active) throw new Error('Package not found or inactive');

      // Verify the on-chain transfer before issuing any credits
      const expectedWei = parseUnits(pkg.loarTokenAmount.toString(), 18);
      await verifyLoarPayment(input.txHash, expectedWei);

      // $LOAR buyers get: base credits + package bonus + 10% LOAR bonus
      const totalCredits = pkg.credits + pkg.bonusCredits + pkg.loarBonusCredits;

      // Update user balance
      const userRef = creditsCol().doc(ctx.user.uid);
      const userDoc = await userRef.get();

      const totalBonus = pkg.bonusCredits + pkg.loarBonusCredits;
      const updateData: Record<string, any> = {
        balance: (userDoc.data()?.balance || 0) + totalCredits,
        totalPurchased: (userDoc.data()?.totalPurchased || 0) + pkg.credits,
        totalBonusReceived: (userDoc.data()?.totalBonusReceived || 0) + totalBonus,
        totalLoarPurchases: (userDoc.data()?.totalLoarPurchases || 0) + 1,
        updatedAt: new Date(),
      };

      if (userDoc.exists) {
        await userRef.update(updateData);
      } else {
        await userRef.set({
          uid: ctx.user.uid,
          ...updateData,
          totalSpent: 0,
          totalFiatPurchases: 0,
          createdAt: new Date(),
        });
      }

      // Record transaction
      await creditTxCol().add({
        id: randomUUID(),
        uid: ctx.user.uid,
        type: 'purchase',
        paymentMethod: 'loar',
        packageId: input.packageId,
        packageName: pkg.name,
        credits: pkg.credits,
        bonusCredits: totalBonus,
        totalCredits,
        pricePaidUsd: pkg.loarPriceUsd,
        loarTokensPaid: input.loarAmount,
        marginPercent: 25,
        txHash: input.txHash,
        createdAt: new Date(),
      });

      return {
        ok: true,
        creditsAdded: totalCredits,
        baseCredits: pkg.credits,
        bonusCredits: pkg.bonusCredits,
        loarBonusCredits: pkg.loarBonusCredits,
        pricePaid: pkg.loarPriceUsd,
        loarTokensPaid: input.loarAmount,
        paymentMethod: 'loar' as const,
        margin: '25%',
        savings: `You saved $${(pkg.fiatPriceUsd - pkg.loarPriceUsd).toFixed(2)} and got ${pkg.loarBonusCredits} extra credits!`,
      };
    }),

  // ── Spend Credits ───────────────────────────────────────────────

  spend: protectedProcedure
    .input(
      z.object({
        generationType: z.string(),
        creditOverride: z.number().optional(), // for model-specific costs
        universeId: z.string().optional(),
        generationId: z.string().optional(),
        modelId: z.string().optional(),
        metadata: z.record(z.string(), z.string()).optional(),
        /**
         * When true and universeId is set, deduct from the universe's shared
         * credit pool (funded from the universe treasury) instead of the
         * caller's personal balance. The caller must be an active team member
         * or the universe admin.
         */
        useUniversePool: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cost = input.creditOverride || GENERATION_COSTS[input.generationType] || 1;

      // ── Universe pool path ────────────────────────────────────────
      if (input.useUniversePool && input.universeId) {
        const universeId = input.universeId.toLowerCase();
        const callerUid = ctx.user.uid.toLowerCase();

        // Verify the caller is the admin or an active team member
        const [universeDoc, memberDoc] = await Promise.all([
          db.collection('cinematicUniverses').doc(universeId).get(),
          db.collection('universeTeamMembers').doc(`${universeId}-${callerUid}`).get(),
        ]);

        const adminUid = (universeDoc.data()?.creator as string | undefined)?.toLowerCase();
        const isAdmin = adminUid === callerUid;
        const membership = memberDoc.exists ? memberDoc.data()! : null;
        const isMember = !!membership && membership.status === 'active';

        if (!isAdmin && !isMember) {
          throw new Error('You are not an active team member of this universe');
        }

        // Enforce monthly allowance for non-admins
        if (!isAdmin && membership!.monthlyAllowance > 0) {
          const periodStart = membership!.allowancePeriodStart?.toDate?.() ?? new Date(0);
          const now = new Date();
          const sameMonth =
            periodStart.getFullYear() === now.getFullYear() &&
            periodStart.getMonth() === now.getMonth();
          const usedThisMonth = sameMonth ? membership!.creditsUsedThisMonth || 0 : 0;

          if (usedThisMonth + cost > membership!.monthlyAllowance) {
            throw new Error(
              `Monthly credit allowance exceeded. Allowance: ${membership!.monthlyAllowance}, used: ${usedThisMonth}, need: ${cost}`
            );
          }

          await db
            .collection('universeTeamMembers')
            .doc(`${universeId}-${callerUid}`)
            .update({
              creditsUsedThisMonth: usedThisMonth + cost,
              allowancePeriodStart: sameMonth ? membership!.allowancePeriodStart : now,
              updatedAt: now,
            });
        }

        // Deduct from the universe pool
        const poolRef = db.collection('universeCredits').doc(universeId);
        const poolDoc = await poolRef.get();
        const poolBalance = (poolDoc.data()?.balance as number) || 0;
        const poolSpent = (poolDoc.data()?.totalSpent as number) || 0;

        if (poolBalance < cost) {
          throw new Error(
            `Universe credit pool is too low. Need ${cost}, available ${poolBalance}. Ask the universe admin to top up the pool.`
          );
        }

        await poolRef.set(
          { balance: poolBalance - cost, totalSpent: poolSpent + cost, updatedAt: new Date() },
          { merge: true }
        );

        await db.collection('universeCreditTransactions').add({
          universeId,
          type: 'spend',
          spentByUid: callerUid,
          generationType: input.generationType,
          credits: -cost,
          generationId: input.generationId ?? null,
          modelId: input.modelId ?? null,
          metadata: input.metadata ?? null,
          createdAt: new Date(),
        });

        return {
          ok: true,
          creditsSpent: cost,
          remainingBalance: poolBalance - cost,
          source: 'universe_pool',
        };
      }

      // ── Personal balance path (default) ──────────────────────────
      const userRef = creditsCol().doc(ctx.user.uid);
      const userDoc = await userRef.get();

      if (!userDoc.exists) throw new Error('No credits available. Purchase credits first.');
      const data = userDoc.data()!;
      if ((data.balance || 0) < cost) {
        throw new Error(
          `Insufficient credits. Need ${cost}, have ${data.balance || 0}. Purchase more credits to continue.`
        );
      }

      await userRef.update({
        balance: data.balance - cost,
        totalSpent: (data.totalSpent || 0) + cost,
        updatedAt: new Date(),
      });

      // Record transaction
      await creditTxCol().add({
        uid: ctx.user.uid,
        type: 'spend',
        generationType: input.generationType,
        credits: -cost,
        universeId: input.universeId || null,
        generationId: input.generationId || null,
        modelId: input.modelId || null,
        metadata: input.metadata || null,
        createdAt: new Date(),
      });

      return {
        ok: true,
        creditsSpent: cost,
        remainingBalance: data.balance - cost,
        source: 'personal',
      };
    }),

  // ── Grant (platform/admin/quests) ───────────────────────────────

  grant: adminProcedure
    .input(
      z.object({
        targetUid: z.string(),
        credits: z.number().min(1),
        reason: z.string(),
        source: z.enum(['admin', 'quest', 'affiliate', 'promo']).default('admin'),
      })
    )
    .mutation(async ({ input }) => {
      const userRef = creditsCol().doc(input.targetUid);
      const userDoc = await userRef.get();

      if (userDoc.exists) {
        const data = userDoc.data()!;
        await userRef.update({
          balance: (data.balance || 0) + input.credits,
          totalBonusReceived: (data.totalBonusReceived || 0) + input.credits,
          updatedAt: new Date(),
        });
      } else {
        await userRef.set({
          uid: input.targetUid,
          balance: input.credits,
          totalPurchased: 0,
          totalSpent: 0,
          totalBonusReceived: input.credits,
          totalLoarPurchases: 0,
          totalFiatPurchases: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      await creditTxCol().add({
        uid: input.targetUid,
        type: 'grant',
        source: input.source,
        credits: input.credits,
        reason: input.reason,
        createdAt: new Date(),
      });

      return { ok: true };
    }),

  // ── History ─────────────────────────────────────────────────────

  getHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input, ctx }) => {
      const snapshot = await creditTxCol()
        .where('uid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  // ── Costs ───────────────────────────────────────────────────────

  getCosts: publicProcedure.query(() => GENERATION_COSTS),

  // ── Price Comparison ────────────────────────────────────────────

  comparePricing: publicProcedure
    .input(z.object({ packageId: z.string() }))
    .query(async ({ input }) => {
      const packages = await buildPackagesFromConfig();
      const pkg = packages.find((p) => p.id === input.packageId);
      if (!pkg) return null;

      const cfg = await getPlatformConfig();
      const fiatMarginPct = Math.round((cfg.fiatMargin - 1) * 100);
      const loarMarginPct = Math.round((cfg.loarMargin - 1) * 100);

      return {
        packageName: pkg.name,
        baseCredits: pkg.credits,
        fiat: {
          priceUsd: pkg.fiatPriceUsd,
          bonusCredits: pkg.bonusCredits,
          totalCredits: pkg.credits + pkg.bonusCredits,
          margin: `${fiatMarginPct}%`,
          perCreditUsd:
            Math.round((pkg.fiatPriceUsd / (pkg.credits + pkg.bonusCredits)) * 1000) / 1000,
        },
        loar: {
          priceUsd: pkg.loarPriceUsd,
          loarTokens: pkg.loarTokenAmount,
          bonusCredits: pkg.bonusCredits + pkg.loarBonusCredits,
          totalCredits: pkg.credits + pkg.bonusCredits + pkg.loarBonusCredits,
          margin: `${loarMarginPct}%`,
          perCreditUsd:
            Math.round(
              (pkg.loarPriceUsd / (pkg.credits + pkg.bonusCredits + pkg.loarBonusCredits)) * 1000
            ) / 1000,
          savingsUsd: Math.round((pkg.fiatPriceUsd - pkg.loarPriceUsd) * 100) / 100,
          extraCredits: pkg.loarBonusCredits,
        },
      };
    }),
});
