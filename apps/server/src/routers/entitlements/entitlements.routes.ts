/**
 * BYOK Fee-Waiver Entitlement Routes
 *
 * Once unlocked, generations made with a user-supplied provider key
 * (`provider-keys` BYOK) skip the platform credit charge. Three acquisition
 * paths, all gated by SIWE auth:
 *
 *   - `unlockWithStripe`     — confirms a Stripe PaymentIntent ($25 USD by
 *                              default; auto_payment_methods enables card,
 *                              Apple Pay, Google Pay, Link, bank debits…
 *                              everything Stripe Checkout supports server-
 *                              side).
 *   - `createStripeIntent`   — server-priced PaymentIntent creation; the
 *                              client never gets to set the amount.
 *   - `unlockWithEthTx`      — verifies an on-chain native ETH transfer to
 *                              the platform treasury for ≥ ($25 / ethUsd).
 *                              Sepolia + Base Sepolia supported.
 *   - `createSolanaPayIntent`/ `unlockWithSolanaPay` — Solana Pay flow,
 *                              accepts USDC-SPL at $25.
 *   - `redeemCode`           — admin-minted code, single- or multi-use.
 *
 * Admin sub-router exposes `mintCode`, `listCodes`, `revokeCode`.
 *
 * Unlock is account-wide, non-transferable, non-refundable. The UI shows
 * a confirm dialog stating that before payment.
 */
import { z } from 'zod';
import { createPublicClient, http, type Hash } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { adminProcedure, protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { firebaseAvailable } from '../../lib/firebase';
import { getStripe } from '../credits/stripe.routes';
import { getPlatformConfig } from '../../services/platformConfig';
import {
  createPaymentIntent as createSolanaIntent,
  claimPaymentForUnlock as claimSolanaPayForUnlock,
  IntentAlreadyConsumedError,
  IntentNotOwnedError,
} from '../../lib/solana-pay';
import {
  EntitlementAlreadyActiveError,
  getEntitlement,
  grantFeeWaiver,
  isByokFeeWaived,
  listCodes,
  mintCode,
  redeemCode,
  revokeCode,
} from '../../services/entitlements';

// ── Pricing ────────────────────────────────────────────────────────────

/** Unlock price in USD cents. Server-controlled; never trusted from client. */
function getUnlockPriceCents(): number {
  const raw = process.env.BYOK_UNLOCK_USD_PRICE_CENTS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 50) return Math.floor(n);
  }
  return 2500; // $25 default
}

// ── EVM verification (native ETH) ─────────────────────────────────────

const ALLOWED_EVM_CHAINS = new Set<number>([sepolia.id, baseSepolia.id]);

function getEvmClient(chainId: number) {
  if (chainId === baseSepolia.id) {
    return createPublicClient({
      chain: baseSepolia,
      transport: http(process.env.RPC_URL_BASE_SEPOLIA || undefined),
    });
  }
  return createPublicClient({
    chain: sepolia,
    transport: http(process.env.RPC_URL || process.env.PONDER_RPC_URL_2 || undefined),
  });
}

const TREASURY_ADDRESS = (process.env.TREASURY_ADDRESS ?? '').toLowerCase();
const MAX_TX_AGE_SECONDS = 24 * 60 * 60;
/** Minimum block confirmations before an unlock tx can be claimed. Roughly
 *  60s on Sepolia / Base Sepolia — well outside the typical reorg depth. */
const MIN_CONFIRMATIONS = 6n;

async function verifyEvmNativePayment(args: {
  txHash: string;
  chainId: number;
  expectedSender: string;
  expectedMinWei: bigint;
}): Promise<void> {
  if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x') {
    throw new Error('TREASURY_ADDRESS is not configured on the server.');
  }
  if (!ALLOWED_EVM_CHAINS.has(args.chainId)) {
    throw new Error(
      `Chain ${args.chainId} is not supported. Use Sepolia (${sepolia.id}) or Base Sepolia (${baseSepolia.id}).`
    );
  }
  const client = getEvmClient(args.chainId);
  const tx = await client.getTransaction({ hash: args.txHash as Hash }).catch(() => {
    throw new Error('Transaction not found on the specified chain.');
  });
  const receipt = await client.getTransactionReceipt({ hash: args.txHash as Hash });
  if (receipt.status !== 'success') {
    throw new Error('Transaction reverted on-chain.');
  }
  if (tx.to?.toLowerCase() !== TREASURY_ADDRESS) {
    throw new Error('Transaction recipient is not the platform treasury address.');
  }
  if (tx.from?.toLowerCase() !== args.expectedSender.toLowerCase()) {
    throw new Error('Transaction sender does not match your wallet address.');
  }
  if (tx.value < args.expectedMinWei) {
    throw new Error(
      `Insufficient amount. Expected ≥ ${args.expectedMinWei.toString()} wei, got ${tx.value.toString()}.`
    );
  }
  // Confirmations + age: reject txs that are too fresh (reorg risk) or too
  // stale (reuse of an ancient payment). Both checks share the block lookup.
  try {
    const [block, latest] = await Promise.all([
      client.getBlock({ blockNumber: receipt.blockNumber }),
      client.getBlockNumber(),
    ]);
    const confirmations = latest - receipt.blockNumber;
    if (confirmations < MIN_CONFIRMATIONS) {
      throw new Error(
        `Transaction has only ${confirmations} confirmation(s); need ≥ ${MIN_CONFIRMATIONS}. Retry shortly.`
      );
    }
    const age = Math.floor(Date.now() / 1000) - Number(block.timestamp);
    if (age > MAX_TX_AGE_SECONDS) {
      throw new Error(`Transaction too old (${age}s). Claim within 24h of confirmation.`);
    }
  } catch (err: any) {
    if (
      err?.message?.startsWith('Transaction too old') ||
      err?.message?.startsWith('Transaction has only')
    )
      throw err;
    // Block / latest-block lookup failure is not fatal — sender + recipient +
    // amount checks remain. Don't punish legitimate payers for an RPC hiccup.
  }
}

// ── Router ─────────────────────────────────────────────────────────────

export const entitlementsRouter = router({
  /** Public price + acceptance config — UI uses this to render the unlock card. */
  config: publicProcedure.query(async () => {
    const cents = getUnlockPriceCents();
    const cfg = await getPlatformConfig().catch(() => ({ ethPriceUsd: 3000 }));
    const ethPriceUsd = cfg.ethPriceUsd || 3000;
    const usd = cents / 100;
    const expectedEth = ethPriceUsd > 0 ? usd / ethPriceUsd : 0;
    return {
      priceUsd: usd,
      priceCents: cents,
      paymentMethods: {
        stripe: Boolean(process.env.STRIPE_SECRET_KEY),
        eth: Boolean(process.env.TREASURY_ADDRESS),
        solana: Boolean(process.env.SOLANA_PAY_RECIPIENT),
        code: true,
      },
      ethPriceUsd,
      /** Approximate ETH amount user must transfer (display only — server enforces wei). */
      expectedEth,
      treasuryAddress: process.env.TREASURY_ADDRESS ?? null,
      solanaRecipient: process.env.SOLANA_PAY_RECIPIENT ?? null,
      solanaUsdcMint: process.env.SOLANA_USDC_MINT ?? null,
      acceptedChainIds: [sepolia.id, baseSepolia.id],
    };
  }),

  /** Auth-only status — caller's current entitlement state. */
  status: protectedProcedure.query(async ({ ctx }) => {
    const entitlement = firebaseAvailable ? await getEntitlement(ctx.user.uid) : null;
    return {
      byokFeeWaived: Boolean(entitlement?.byokFeeWaived),
      unlockedAt: entitlement?.unlockedAt?.toISOString() ?? null,
      unlockedVia: entitlement?.unlockedVia ?? null,
    };
  }),

  // ── Stripe ────────────────────────────────────────────────────────

  /** Create a Stripe PaymentIntent for the unlock. amount is server-derived. */
  createStripeIntent: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripe();
    if (!stripe) throw new Error('Card payments are not configured on this server.');

    // Reject the request early if already unlocked — saves the user a charge.
    if (await isByokFeeWaived(ctx.user.uid)) {
      throw new EntitlementAlreadyActiveError(ctx.user.uid);
    }

    const amount = getUnlockPriceCents();
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      metadata: {
        kind: 'byok_unlock',
        userId: ctx.user.uid,
        userAddress: ctx.user.address ?? '',
        expectedAmountCents: String(amount),
      },
      automatic_payment_methods: { enabled: true },
      description: 'LOAR — BYOK fee waiver (one-time)',
    });

    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      amountCents: amount,
    };
  }),

  /**
   * Confirm a Stripe PaymentIntent and grant the waiver. Idempotent —
   * re-submitting the same `pi_xxx` for an already-unlocked account
   * returns `{ alreadyActive: true }`.
   *
   * Webhook (`/api/stripe/webhook`) is the primary settlement path; this
   * tRPC call is the fast-path for the browser to flip UI state without
   * waiting on Stripe's webhook RTT.
   */
  unlockWithStripe: protectedProcedure
    .input(z.object({ paymentIntentId: z.string().startsWith('pi_') }))
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      if (!stripe) throw new Error('Card payments are not configured on this server.');

      // Expand `latest_charge` so we can verify the charge wasn't refunded or
      // disputed after the PI moved to `succeeded`. Without this, an attacker
      // could pay → refund → still pass the `status === 'succeeded'` check.
      const intent = await stripe.paymentIntents.retrieve(input.paymentIntentId, {
        expand: ['latest_charge'],
      });
      if (intent.status !== 'succeeded') {
        throw new Error(`Payment status is ${intent.status}, not 'succeeded'.`);
      }
      if (intent.currency !== 'usd') {
        // createStripeIntent always uses USD; reject any other currency so an
        // off-currency PI cannot satisfy the cents-denominated price check.
        throw new Error(`PaymentIntent currency is ${intent.currency}, not 'usd'.`);
      }
      if (intent.metadata?.kind !== 'byok_unlock') {
        throw new Error('PaymentIntent is not a BYOK unlock payment.');
      }
      if (intent.metadata?.userId !== ctx.user.uid) {
        throw new Error('PaymentIntent was not created by your account.');
      }
      const expectedCents = getUnlockPriceCents();
      if ((intent.amount ?? 0) < expectedCents) {
        throw new Error(
          `Payment amount ($${((intent.amount ?? 0) / 100).toFixed(2)}) is below the unlock price ($${(
            expectedCents / 100
          ).toFixed(2)}).`
        );
      }
      // Refund / dispute defense — a succeeded PI whose underlying charge has
      // been refunded (full or partial) or disputed must not grant the waiver.
      const latestCharge =
        intent.latest_charge && typeof intent.latest_charge === 'object'
          ? intent.latest_charge
          : null;
      if (latestCharge) {
        if (latestCharge.refunded || (latestCharge.amount_refunded ?? 0) > 0) {
          throw new Error('PaymentIntent has been refunded.');
        }
        if (latestCharge.disputed) {
          throw new Error('PaymentIntent has an open dispute.');
        }
      }

      try {
        await grantFeeWaiver({
          uid: ctx.user.uid,
          unlockedVia: 'stripe',
          sourceRef: input.paymentIntentId,
          amountPaid: String(intent.amount ?? expectedCents),
        });
      } catch (err) {
        if (err instanceof EntitlementAlreadyActiveError) {
          return { ok: true, alreadyActive: true as const };
        }
        throw err;
      }
      return { ok: true, alreadyActive: false as const };
    }),

  // ── Native ETH ────────────────────────────────────────────────────

  /** Verify an on-chain native ETH transfer + grant the waiver. */
  unlockWithEthTx: protectedProcedure
    .input(
      z.object({
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Invalid tx hash'),
        chainId: z.number().int(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user.address) {
        throw new Error('Your account does not have a wallet address bound.');
      }
      const cfg = await getPlatformConfig();
      const ethPriceUsd = cfg.ethPriceUsd || 3000;
      // Exact BigInt math — `Number * 1e18` loses precision past 2^53 wei
      // (~$0.009 at $3000/ETH but blows up at low ETH prices), and would
      // either over- or under-charge by tens of wei. Compute in cents:
      //   minWei = (priceCents * 1e18) / ethPriceCents
      const usdCents = BigInt(getUnlockPriceCents());
      const ethPriceCents = BigInt(Math.round(ethPriceUsd * 100));
      if (ethPriceCents <= 0n) {
        throw new Error('Platform ETH price is not configured.');
      }
      const expectedMinWei = (usdCents * 10n ** 18n) / ethPriceCents;

      await verifyEvmNativePayment({
        txHash: input.txHash,
        chainId: input.chainId,
        expectedSender: ctx.user.address,
        expectedMinWei,
      });

      try {
        await grantFeeWaiver({
          uid: ctx.user.uid,
          unlockedVia: 'eth',
          sourceRef: `${input.chainId}:${input.txHash}`,
          amountPaid: expectedMinWei.toString(),
        });
      } catch (err) {
        if (err instanceof EntitlementAlreadyActiveError) {
          return { ok: true, alreadyActive: true as const };
        }
        throw err;
      }
      return { ok: true, alreadyActive: false as const };
    }),

  // ── Solana Pay (USDC-SPL) ─────────────────────────────────────────

  /** Create a Solana Pay intent for $25 USDC-SPL. */
  createSolanaPayIntent: protectedProcedure.mutation(async ({ ctx }) => {
    if (await isByokFeeWaived(ctx.user.uid)) {
      throw new EntitlementAlreadyActiveError(ctx.user.uid);
    }
    const splToken = process.env.SOLANA_USDC_MINT;
    if (!splToken) {
      throw new Error('Solana USDC mint is not configured on this server.');
    }
    const amountUsd = (getUnlockPriceCents() / 100).toFixed(2);
    const intent = await createSolanaIntent({
      userId: ctx.user.uid,
      amount: amountUsd,
      splToken,
      label: 'LOAR BYOK Unlock',
      memo: `byok-unlock:${ctx.user.uid}`,
      ttlMs: 30 * 60 * 1000,
    });
    return intent;
  }),

  /**
   * Poll a Solana Pay reference; when `status === 'paid'` AND the intent was
   * created by the caller, atomically marks the reference as consumed and
   * grants the waiver. A leaked reference cannot be replayed against a
   * different account, and the same reference cannot grant the waiver twice.
   * Frontend polls this until the card flips. Idempotent for the original payer.
   */
  unlockWithSolanaPay: protectedProcedure
    .input(
      z.object({
        reference: z
          .string()
          .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Invalid Solana Pay reference'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let result;
      try {
        result = await claimSolanaPayForUnlock({
          reference: input.reference,
          userId: ctx.user.uid,
        });
      } catch (err) {
        if (err instanceof IntentNotOwnedError || err instanceof IntentAlreadyConsumedError) {
          throw new Error(err.message);
        }
        throw err;
      }
      if (result.status === 'pending') {
        return { ok: false as const, status: 'pending' as const };
      }
      if (result.status !== 'paid') {
        return { ok: false as const, status: result.status };
      }
      try {
        await grantFeeWaiver({
          uid: ctx.user.uid,
          unlockedVia: 'usdc-sol',
          sourceRef: input.reference,
          amountPaid: result.amount,
        });
      } catch (err) {
        if (err instanceof EntitlementAlreadyActiveError) {
          return { ok: true as const, status: 'paid' as const, alreadyActive: true as const };
        }
        throw err;
      }
      return { ok: true as const, status: 'paid' as const, alreadyActive: false as const };
    }),

  // ── Redeem code ───────────────────────────────────────────────────

  redeemCode: protectedProcedure
    .input(z.object({ code: z.string().min(4).max(40) }))
    .mutation(async ({ ctx, input }) => {
      await redeemCode({ uid: ctx.user.uid, code: input.code });
      return { ok: true };
    }),

  // ── Admin ─────────────────────────────────────────────────────────

  admin: router({
    mintCode: adminProcedure
      .input(
        z.object({
          code: z.string().min(4).max(40).optional(),
          note: z.string().max(280).optional(),
          maxRedemptions: z.number().int().min(1).max(10_000).optional(),
          expiresAt: z
            .string()
            .datetime()
            .optional()
            .transform((v) => (v ? new Date(v) : null)),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return mintCode({
          code: input.code,
          note: input.note,
          maxRedemptions: input.maxRedemptions ?? 1,
          expiresAt: input.expiresAt ?? null,
          createdBy: ctx.user.uid,
        });
      }),

    listCodes: adminProcedure
      .input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional())
      .query(async ({ input }) => listCodes(input?.limit ?? 100)),

    revokeCode: adminProcedure.input(z.object({ code: z.string() })).mutation(async ({ input }) => {
      await revokeCode(input.code);
      return { ok: true };
    }),

    /** Admin override — grant the waiver without payment (giveaways, comp). */
    grant: adminProcedure
      .input(z.object({ uid: z.string().min(1), note: z.string().max(280).optional() }))
      .mutation(async ({ ctx, input }) => {
        try {
          await grantFeeWaiver({
            uid: input.uid,
            unlockedVia: 'code',
            sourceRef: `admin:${ctx.user.uid}:${input.note ?? ''}`.slice(0, 200),
          });
        } catch (err) {
          if (err instanceof EntitlementAlreadyActiveError) {
            return { ok: true, alreadyActive: true as const };
          }
          throw err;
        }
        return { ok: true, alreadyActive: false as const };
      }),
  }),
});
