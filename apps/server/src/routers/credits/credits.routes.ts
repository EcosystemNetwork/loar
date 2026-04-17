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

/** Allowed chain IDs for on-chain payment verification. */
const ALLOWED_CHAIN_IDS: Set<number> = new Set([sepolia.id, baseSepolia.id]);

// ── RPC response cache (prevents DoS via repeated verification calls) ───
const TX_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TX_CACHE_MAX = 500;
const txCache = new Map<string, { data: any; ts: number }>();

function getCachedOrFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = txCache.get(key);
  if (cached && Date.now() - cached.ts < TX_CACHE_TTL) return cached.data as Promise<T>;
  const promise = fetcher();
  promise
    .then((data) => {
      if (txCache.size >= TX_CACHE_MAX) {
        // Evict oldest entry
        const oldest = txCache.keys().next().value;
        if (oldest) txCache.delete(oldest);
      }
      txCache.set(key, { data, ts: Date.now() });
    })
    .catch((err) => {
      console.error(`[txCache] Fetch failed for ${key}:`, err?.message || err);
    });
  return promise;
}

/** Get the appropriate chain client based on chain ID. */
function getChainClient(chainId?: number) {
  if (chainId !== undefined && !ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new Error(
      `Chain ID ${chainId} is not supported. Use Sepolia (${sepolia.id}) or Base Sepolia (${baseSepolia.id}).`
    );
  }
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
  expectedWei?: string,
  expectedSender?: string
): Promise<void> {
  if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x') {
    throw new Error('TREASURY_ADDRESS is not configured on the server');
  }

  // Note: dedup is enforced atomically inside the Firestore transaction
  // (purchaseWithFiat / purchaseWithLoar). No pre-check here to avoid
  // a TOCTOU race where two concurrent requests both pass the query
  // but the transaction correctly rejects the second one.

  const client = getChainClient(chainId);
  const chainName = getChainName(chainId);

  let tx: any;
  try {
    tx = await getCachedOrFetch(
      `tx-${paymentRef}`,
      () => client.getTransaction({ hash: paymentRef as Hash }) as any
    );
  } catch {
    throw new Error(
      `Transaction not found on ${chainName}. Confirm it has been broadcast and included in a block.`
    );
  }

  const receipt = await getCachedOrFetch(`receipt-${paymentRef}`, () =>
    client.getTransactionReceipt({ hash: paymentRef as Hash })
  );
  if (receipt.status !== 'success') {
    throw new Error('Transaction was reverted on-chain. No credits will be issued.');
  }

  if (tx.to?.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
    throw new Error(
      'Transaction recipient does not match the platform treasury address. Ensure you sent funds to the correct address.'
    );
  }

  // C4 fix: Verify the transaction was sent by the authenticated user
  if (expectedSender && tx.from?.toLowerCase() !== expectedSender.toLowerCase()) {
    throw new Error(
      'Transaction sender does not match your wallet address. You can only claim credits for your own payments.'
    );
  }

  // Enforce minimum payment amount when a price is configured
  if (expectedWei && expectedWei !== '0') {
    const expected = BigInt(expectedWei);
    const minRequired = expected;
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
  chainId?: number,
  expectedSender?: string
): Promise<void> {
  if (!LOAR_TOKEN_ADDRESS || LOAR_TOKEN_ADDRESS === '0x') {
    throw new Error('LOAR_TOKEN_ADDRESS is not configured on the server');
  }
  if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x') {
    throw new Error('TREASURY_ADDRESS is not configured on the server');
  }

  // Note: dedup is enforced atomically inside the Firestore transaction
  // (purchaseWithLoar). No pre-check here to avoid TOCTOU race.

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

  // C4 fix: Verify the transfer was sent by the authenticated user
  if (expectedSender && transferLog.topics[1]) {
    const sender = `0x${transferLog.topics[1].slice(26)}`.toLowerCase();
    if (sender !== expectedSender.toLowerCase()) {
      throw new Error(
        'Token transfer sender does not match your wallet address. You can only claim credits for your own payments.'
      );
    }
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
  baseCreditCostUsd = BASE_CREDIT_COST_USD,
  ethPriceUsd = 3000
): CreditPackage {
  const baseCostUsd = credits * baseCreditCostUsd;
  const fiatPriceUsd = Math.round(baseCostUsd * fiatMargin * 100) / 100;
  const loarPriceUsd = Math.round(baseCostUsd * loarMargin * 100) / 100;
  const loarTokenAmount = Math.ceil(loarPriceUsd / LOAR_TO_USD);
  const loarBonusCredits = Math.floor(credits * loarBonusFraction);

  // Compute expected ETH wei from the fiat price and ETH/USD rate
  const ethPriceWei =
    ethPriceUsd > 0 ? parseUnits((fiatPriceUsd / ethPriceUsd).toFixed(18), 18).toString() : '0';

  return {
    id,
    name,
    credits,
    bonusCredits,
    fiatPriceUsd,
    loarPriceUsd,
    loarTokenAmount,
    ethPriceWei,
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
export async function buildPackagesFromConfig(): Promise<CreditPackage[]> {
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
      cfg.baseCreditCostUsd,
      cfg.ethPriceUsd
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
      const snapshot = await creditPackagesCol().where('active', '==', true).get();

      if (snapshot.docs.length > 0) {
        return (
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) as CreditPackage[]
        ).sort((a, b) => (a.credits ?? 0) - (b.credits ?? 0));
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
      z
        .object({
          packageId: z.string(),
          paymentMethod: z.enum(['card', 'eth', 'crypto']),
          /** For card: Stripe payment intent ID. For ETH/crypto: tx hash */
          paymentRef: z.string(),
          amountPaid: z.string().optional(), // wei for ETH, USD cents for card
          /** Chain ID for on-chain payment verification (required for eth/crypto) */
          chainId: z.number().optional(),
        })
        .refine((data) => data.paymentMethod === 'card' || data.chainId !== undefined, {
          message: 'chainId is required for ETH/crypto payments',
          path: ['chainId'],
        })
    )
    .mutation(async ({ input, ctx }) => {
      // Use live pricing so ETH amounts reflect current ETH/USD rate
      const livePackages = await buildPackagesFromConfig();
      const pkg = livePackages.find((p) => p.id === input.packageId);
      if (!pkg || !pkg.active) throw new Error('Package not found or inactive');

      if (input.paymentMethod === 'eth' || input.paymentMethod === 'crypto') {
        // Verify on-chain: tx exists, confirmed, sent to treasury, correct amount
        if (!pkg.ethPriceWei || pkg.ethPriceWei === '0') {
          throw new Error('ETH pricing is not configured. Cannot verify payment amount.');
        }
        await verifyEthPayment(input.paymentRef, input.chainId, pkg.ethPriceWei, ctx.user.address);
      } else {
        // card: Verify Stripe PaymentIntent succeeded with correct package and amount
        const expectedCents = Math.round(pkg.fiatPriceUsd * 100);
        await verifyStripePayment(input.paymentRef, input.packageId, expectedCents, ctx.user.uid);
        // Dedup is enforced atomically inside the transaction below
      }

      const totalCredits = pkg.credits + pkg.bonusCredits;

      // Atomic: dedup + balance update + tx record in one Firestore transaction
      // Dedup key uses raw paymentRef only — tx hashes are globally unique across chains
      const txDocId = `fiat-${input.paymentRef}`;
      await db.runTransaction(async (tx) => {
        const dedupRef = creditTxCol().doc(txDocId);
        const dedupDoc = await tx.get(dedupRef);
        if (dedupDoc.exists) {
          throw new Error('This payment reference has already been used');
        }

        const userRef = creditsCol().doc(ctx.user.uid);
        const userDoc = await tx.get(userRef);
        const prev = userDoc.data() ?? {};

        const updated: Record<string, any> = {
          uid: ctx.user.uid,
          balance: (prev.balance || 0) + totalCredits,
          totalPurchased: (prev.totalPurchased || 0) + pkg.credits,
          totalBonusReceived: (prev.totalBonusReceived || 0) + pkg.bonusCredits,
          totalFiatPurchases: (prev.totalFiatPurchases || 0) + 1,
          totalSpent: prev.totalSpent || 0,
          totalLoarPurchases: prev.totalLoarPurchases || 0,
          updatedAt: new Date(),
          ...(!userDoc.exists && { createdAt: new Date() }),
        };

        tx.set(userRef, updated, { merge: true });
        tx.set(dedupRef, {
          id: txDocId,
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
        /** Chain ID for on-chain payment verification */
        chainId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const livePackages = await buildPackagesFromConfig();
      const pkg = livePackages.find((p) => p.id === input.packageId);
      if (!pkg || !pkg.active) throw new Error('Package not found or inactive');

      // Verify the on-chain transfer before issuing any credits
      const expectedWei = parseUnits(pkg.loarTokenAmount.toString(), 18);
      await verifyLoarPayment(input.txHash, expectedWei, input.chainId, ctx.user.address);

      // $LOAR buyers get: base credits + package bonus + 10% LOAR bonus
      const totalCredits = pkg.credits + pkg.bonusCredits + pkg.loarBonusCredits;
      const totalBonus = pkg.bonusCredits + pkg.loarBonusCredits;

      // Atomic: dedup + balance update + tx record
      // Include chainId in dedup key for defense-in-depth
      const txDocId = `loar-${input.txHash}-${input.chainId || 0}`;
      await db.runTransaction(async (tx) => {
        const dedupRef = creditTxCol().doc(txDocId);
        const dedupDoc = await tx.get(dedupRef);
        if (dedupDoc.exists) {
          throw new Error('This transaction has already been used to purchase credits');
        }

        const userRef = creditsCol().doc(ctx.user.uid);
        const userDoc = await tx.get(userRef);
        const prev = userDoc.data() ?? {};

        tx.set(
          userRef,
          {
            uid: ctx.user.uid,
            balance: (prev.balance || 0) + totalCredits,
            totalPurchased: (prev.totalPurchased || 0) + pkg.credits,
            totalBonusReceived: (prev.totalBonusReceived || 0) + totalBonus,
            totalLoarPurchases: (prev.totalLoarPurchases || 0) + 1,
            totalSpent: prev.totalSpent || 0,
            totalFiatPurchases: prev.totalFiatPurchases || 0,
            updatedAt: new Date(),
            ...(!userDoc.exists && { createdAt: new Date() }),
          },
          { merge: true }
        );

        tx.set(dedupRef, {
          id: txDocId,
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
        generationType: z.string().max(50),
        creditOverride: z.number().min(1).max(10_000).optional(),
        universeId: z.string().max(200).optional(),
        generationId: z.string().max(200).optional(),
        modelId: z.string().max(100).optional(),
        metadata: z
          .record(
            z
              .string()
              .min(1)
              .max(50)
              .regex(/^[a-zA-Z0-9_-]+$/),
            z.string().max(500)
          )
          .optional()
          .refine((val) => !val || Object.keys(val).length <= 20, 'Max 20 metadata fields'),
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

        // Use isUniverseAdmin which correctly handles Safe multi-sig universes
        const { isUniverseAdmin } = await import('../../lib/safe-admin');
        const isAdmin = await isUniverseAdmin(universeId, callerUid);

        // Atomic: membership + allowance check + pool deduction + tx record
        // Membership is verified INSIDE the transaction to prevent TOCTOU races
        // (e.g. member removed between check and spend).
        const remainingBalance = await db.runTransaction(async (tx) => {
          const poolRef = db.collection('universeCredits').doc(universeId);
          const poolDoc = await tx.get(poolRef);
          const poolBalance = (poolDoc.data()?.balance as number) || 0;
          const poolSpent = (poolDoc.data()?.totalSpent as number) || 0;

          if (poolBalance < cost) {
            throw new Error(
              `Universe credit pool is too low. Need ${cost}, available ${poolBalance}. Ask the universe admin to top up the pool.`
            );
          }

          // Verify membership inside transaction — re-read to prevent TOCTOU
          const memberDocId = `${universeId}-${callerUid}`;
          const memberRef = db.collection('universeTeamMembers').doc(memberDocId);
          const memberSnap = await tx.get(memberRef);
          const memberData = memberSnap.exists ? memberSnap.data()! : null;
          const isMember = !!memberData && memberData.status === 'active';

          if (!isAdmin && !isMember) {
            throw new Error('You are not an active team member of this universe');
          }

          // Enforce monthly allowance and track spending for non-admins (inside transaction).
          // Always track spend even when monthlyAllowance is 0 (unlimited) for audit purposes.
          if (!isAdmin && memberData) {
            const periodStart = memberData.allowancePeriodStart?.toDate?.() ?? new Date(0);
            const now = new Date();
            const sameMonth =
              periodStart.getFullYear() === now.getFullYear() &&
              periodStart.getMonth() === now.getMonth();
            const usedThisMonth = sameMonth ? memberData.creditsUsedThisMonth || 0 : 0;

            // Enforce cap only when a non-zero allowance is set (0 = unlimited)
            if (
              memberData.monthlyAllowance > 0 &&
              usedThisMonth + cost > memberData.monthlyAllowance
            ) {
              throw new Error(
                `Monthly credit allowance exceeded. Allowance: ${memberData.monthlyAllowance}, used: ${usedThisMonth}, need: ${cost}`
              );
            }

            // Always update spend tracking for audit trail
            tx.update(memberRef, {
              creditsUsedThisMonth: usedThisMonth + cost,
              allowancePeriodStart: sameMonth ? memberData.allowancePeriodStart : now,
              updatedAt: now,
            });
          }

          tx.set(
            poolRef,
            {
              balance: poolBalance - cost,
              totalSpent: poolSpent + cost,
              updatedAt: new Date(),
            },
            { merge: true }
          );

          const spendRef = db.collection('universeCreditTransactions').doc();
          tx.set(spendRef, {
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

          return poolBalance - cost;
        });

        return {
          ok: true,
          creditsSpent: cost,
          remainingBalance,
          source: 'universe_pool',
        };
      }

      // ── Personal balance path (default) ──────────────────────────
      const remainingBalance = await db.runTransaction(async (tx) => {
        const userRef = creditsCol().doc(ctx.user.uid);
        const userDoc = await tx.get(userRef);

        if (!userDoc.exists) throw new Error('No credits available. Purchase credits first.');
        const data = userDoc.data()!;
        const balance = data.balance || 0;
        if (balance < cost) {
          throw new Error(
            `Insufficient credits. Need ${cost}, have ${balance}. Purchase more credits to continue.`
          );
        }

        tx.update(userRef, {
          balance: balance - cost,
          totalSpent: (data.totalSpent || 0) + cost,
          updatedAt: new Date(),
        });

        // Use a deterministic ID to prevent duplicate spend records
        const spendDocRef = creditTxCol().doc(
          `spend-${ctx.user.uid}-${Date.now()}-${randomUUID().slice(0, 8)}`
        );
        tx.set(spendDocRef, {
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

        return balance - cost;
      });

      return {
        ok: true,
        creditsSpent: cost,
        remainingBalance,
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

  // ── ETH Price (for frontend conversion) ────────────────────────

  getEthPrice: publicProcedure.query(async () => {
    const cfg = await getPlatformConfig();
    return { ethPriceUsd: cfg.ethPriceUsd, updatedAt: new Date().toISOString() };
  }),
});
