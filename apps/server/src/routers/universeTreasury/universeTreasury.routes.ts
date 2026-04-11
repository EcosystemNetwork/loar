/**
 * Universe Treasury Router — community-funded credit pool per universe
 *
 * Flow:
 *   1. Community funds a universe via subscriptions / token purchases.
 *   2. The universe admin calls `fundPool` to convert treasury funds into
 *      shared credits (uses the same packages as personal credit purchase).
 *   3. Active team members call `credits.spend` with `useUniversePool: true`
 *      to draw from the pool instead of their personal balance.
 *   4. The admin can view the pool balance and full transaction log.
 *
 * Firestore collections:
 *   universeCredits/{universeId}          — shared credit balance
 *   universeCreditTransactions/{autoId}   — full audit trail
 */
import { TRPCError } from '@trpc/server';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createPublicClient, http, parseUnits, type Hash } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { DEFAULT_PACKAGES, buildPackagesFromConfig } from '../credits/credits.routes';
import { verifyStripePayment } from '../credits/stripe.routes';
import { getMembership } from '../universeTeam/universeTeam.routes';
import { isUniverseAdmin } from '../../lib/safe-admin';

const TREASURY_ADDRESS = (process.env.TREASURY_ADDRESS ?? '') as `0x${string}`;
const LOAR_TOKEN_ADDRESS = (process.env.LOAR_TOKEN_ADDRESS ?? '') as `0x${string}`;
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const;

/** Allowed chain IDs for treasury payment verification. */
const ALLOWED_CHAIN_IDS = new Set([sepolia.id, baseSepolia.id]);

function getTreasuryChainClient(chainId?: number) {
  if (chainId !== undefined && !ALLOWED_CHAIN_IDS.has(chainId)) {
    throw new Error(`Chain ID ${chainId} is not supported for treasury operations.`);
  }
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

/** Verify an ETH tx was sent to treasury and meets minimum amount */
async function verifyTreasuryEthPayment(
  txHash: string,
  expectedWei?: string,
  chainId?: number
): Promise<void> {
  if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x') {
    throw new Error('TREASURY_ADDRESS is not configured');
  }

  // Dedup against universe credit transactions
  const existing = await db
    .collection('universeCreditTransactions')
    .where('paymentRef', '==', txHash)
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new Error('This transaction has already been used to fund a universe pool');
  }

  const client = getTreasuryChainClient(chainId);
  const tx = await client.getTransaction({ hash: txHash as Hash }).catch(() => {
    throw new Error(
      'Transaction not found on-chain. Confirm it has been broadcast and included in a block.'
    );
  });

  const receipt = await client.getTransactionReceipt({ hash: txHash as Hash });
  if (receipt.status !== 'success') {
    throw new Error('Transaction was reverted on-chain.');
  }

  if (tx.to?.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
    throw new Error('Transaction recipient does not match the platform treasury address.');
  }

  if (expectedWei && expectedWei !== '0') {
    const minRequired = BigInt(expectedWei);
    if (tx.value < minRequired) {
      throw new Error(
        `Insufficient ETH. Expected ~${expectedWei} wei, got ${tx.value.toString()} wei.`
      );
    }
  }
}

/** Verify a $LOAR ERC20 transfer to treasury */
async function verifyTreasuryLoarPayment(
  txHash: string,
  expectedLoarWei: bigint,
  chainId?: number
): Promise<void> {
  if (!LOAR_TOKEN_ADDRESS || LOAR_TOKEN_ADDRESS === '0x') {
    throw new Error('LOAR_TOKEN_ADDRESS is not configured');
  }
  if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x') {
    throw new Error('TREASURY_ADDRESS is not configured');
  }

  const existing = await db
    .collection('universeCreditTransactions')
    .where('paymentRef', '==', txHash)
    .limit(1)
    .get();
  if (!existing.empty) {
    throw new Error('This transaction has already been used to fund a universe pool');
  }

  const client = getTreasuryChainClient(chainId);
  const receipt = await client.getTransactionReceipt({ hash: txHash as Hash }).catch(() => {
    throw new Error('Transaction not found on-chain.');
  });

  if (receipt.status !== 'success') {
    throw new Error('Transaction was reverted on-chain.');
  }

  const transferLog = receipt.logs.find(
    (log) =>
      log.address.toLowerCase() === LOAR_TOKEN_ADDRESS.toLowerCase() &&
      log.topics[0] === TRANSFER_TOPIC &&
      log.topics[2] &&
      `0x${log.topics[2].slice(26)}`.toLowerCase() === TREASURY_ADDRESS.toLowerCase()
  );

  if (!transferLog) {
    throw new Error('Transaction does not contain a $LOAR Transfer to the platform treasury.');
  }

  const transferredWei = BigInt(transferLog.data);
  const minRequired = expectedLoarWei;
  if (transferredWei < minRequired) {
    throw new Error(
      `Insufficient $LOAR transferred. Expected ~${expectedLoarWei.toString()} wei, got ${transferredWei.toString()} wei.`
    );
  }
}

const universeCreditCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('universeCredits');
};
const universeCreditTxCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('universeCreditTransactions');
};

/** Read or initialise the universe credit pool document */
async function getPoolData(universeId: string) {
  const doc = await universeCreditCol().doc(universeId.toLowerCase()).get();
  if (!doc.exists) {
    return { balance: 0, totalPurchased: 0, totalSpent: 0 };
  }
  const d = doc.data()!;
  return {
    balance: (d.balance as number) || 0,
    totalPurchased: (d.totalPurchased as number) || 0,
    totalSpent: (d.totalSpent as number) || 0,
  };
}

// ── Router ────────────────────────────────────────────────────────────────

export const universeTreasuryRouter = router({
  // ── Pool balance (public) ─────────────────────────────────────────

  getPoolBalance: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      return getPoolData(input.universeId);
    }),

  // ── Fund pool from treasury (admin only) ──────────────────────────
  //
  // The admin submits proof of payment (txHash for on-chain, or a
  // payment ref for fiat). The server records the credits in the
  // universe's shared pool — not in any individual user balance.

  fundPool: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        packageId: z.string(),
        paymentMethod: z.enum(['card', 'eth', 'crypto', 'loar']),
        /** On-chain tx hash or Stripe payment intent ID */
        paymentRef: z.string(),
        /** $LOAR token amount in wei (only for paymentMethod=loar) */
        loarAmount: z.string().optional(),
        /** Chain ID for on-chain payment verification (eth/crypto/loar) */
        chainId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!(await isUniverseAdmin(input.universeId, ctx.user.uid, input.chainId))) {
        throw new Error('Only the universe admin can fund the universe credit pool');
      }

      // Use live pricing so ETH amounts reflect current ETH/USD rate
      const livePackages = await buildPackagesFromConfig();
      const pkg = livePackages.find((p) => p.id === input.packageId);
      if (!pkg || !pkg.active) throw new Error('Package not found or inactive');

      // ── Verify payment before issuing any credits ──────────────────
      if (input.paymentMethod === 'eth' || input.paymentMethod === 'crypto') {
        if (!pkg.ethPriceWei || pkg.ethPriceWei === '0') {
          throw new Error('ETH pricing is not configured. Cannot verify payment amount.');
        }
        await verifyTreasuryEthPayment(input.paymentRef, pkg.ethPriceWei, input.chainId);
      } else if (input.paymentMethod === 'loar') {
        if (!input.loarAmount) throw new Error('loarAmount is required for $LOAR payments');
        const expectedWei = parseUnits(pkg.loarTokenAmount.toString(), 18);
        await verifyTreasuryLoarPayment(input.paymentRef, expectedWei, input.chainId);
      } else {
        // card: verify Stripe PaymentIntent
        const expectedCents = Math.round(pkg.fiatPriceUsd * 100);
        await verifyStripePayment(input.paymentRef, input.packageId, expectedCents);
        // Dedup is enforced atomically inside the transaction below
      }

      const isLoar = input.paymentMethod === 'loar';
      const totalCredits = isLoar
        ? pkg.credits + pkg.bonusCredits + pkg.loarBonusCredits
        : pkg.credits + pkg.bonusCredits;

      const universeId = input.universeId.toLowerCase();

      // Atomic: dedup + pool credit + tx record
      const txDocId = `fund-${universeId}-${input.paymentRef}`;
      const newBalance = await db.runTransaction(async (tx) => {
        const dedupRef = universeCreditTxCol().doc(txDocId);
        const dedupDoc = await tx.get(dedupRef);
        if (dedupDoc.exists) {
          throw new Error('This payment reference has already been used to fund a universe pool');
        }

        const poolRef = universeCreditCol().doc(universeId);
        const poolDoc = await tx.get(poolRef);
        const poolBalance = (poolDoc.data()?.balance as number) || 0;
        const poolPurchased = (poolDoc.data()?.totalPurchased as number) || 0;

        tx.set(
          poolRef,
          {
            universeId,
            balance: poolBalance + totalCredits,
            totalPurchased: poolPurchased + totalCredits,
            lastFundedAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );

        tx.set(dedupRef, {
          id: txDocId,
          universeId,
          type: 'fund',
          fundedByUid: ctx.user.uid.toLowerCase(),
          packageId: input.packageId,
          packageName: pkg.name,
          paymentMethod: input.paymentMethod,
          paymentRef: input.paymentRef,
          loarAmount: input.loarAmount ?? null,
          credits: totalCredits,
          pricePaidUsd: isLoar ? pkg.loarPriceUsd : pkg.fiatPriceUsd,
          marginPercent: isLoar ? 25 : 35,
          createdAt: new Date(),
        });

        return poolBalance + totalCredits;
      });

      return {
        ok: true,
        creditsAdded: totalCredits,
        newBalance,
      };
    }),

  // ── Spend from universe pool (team members only) ──────────────────
  //
  // Called server-side by credits.spend when useUniversePool=true.
  // Exposed here so it can also be called directly by generation routes.

  spendFromPool: protectedProcedure
    .input(
      z.object({
        universeId: z.string().max(200),
        generationType: z.string().max(50),
        cost: z.number().min(1).max(100_000),
        generationId: z.string().max(200).optional(),
        modelId: z.string().max(100).optional(),
        metadata: z.record(z.string().max(100), z.string().max(500)).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();
      const callerUid = ctx.user.uid.toLowerCase();

      // Verify membership
      const membership = (await getMembership(universeId, callerUid)) as any;
      const isAdmin = await isUniverseAdmin(universeId, callerUid);
      if (!isAdmin && (!membership || membership.status !== 'active')) {
        throw new Error('You are not an active team member of this universe');
      }

      // Atomic: allowance check + pool deduction + tx record
      const remainingPoolBalance = await db.runTransaction(async (tx) => {
        const poolRef = universeCreditCol().doc(universeId);
        const poolDoc = await tx.get(poolRef);
        const poolBalance = (poolDoc.data()?.balance as number) || 0;
        const poolSpent = (poolDoc.data()?.totalSpent as number) || 0;

        if (poolBalance < input.cost) {
          throw new Error(
            `Universe credit pool is too low. Need ${input.cost}, available ${poolBalance}. Ask the universe admin to top up the pool.`
          );
        }

        // Enforce monthly allowance inside transaction (skip for admin)
        if (!isAdmin && membership.monthlyAllowance > 0) {
          const memberDocId = `${universeId}-${callerUid}`;
          const memberRef = db.collection('universeTeamMembers').doc(memberDocId);
          const memberSnap = await tx.get(memberRef);
          const memberData = memberSnap.data()!;
          const periodStart = memberData.allowancePeriodStart?.toDate?.() ?? new Date(0);
          const now = new Date();
          const sameMonth =
            periodStart.getFullYear() === now.getFullYear() &&
            periodStart.getMonth() === now.getMonth();
          const usedThisMonth = sameMonth ? memberData.creditsUsedThisMonth || 0 : 0;

          if (usedThisMonth + input.cost > memberData.monthlyAllowance) {
            throw new Error(
              `Monthly credit allowance exceeded. Allowance: ${memberData.monthlyAllowance}, used: ${usedThisMonth}, requested: ${input.cost}`
            );
          }

          tx.update(memberRef, {
            creditsUsedThisMonth: usedThisMonth + input.cost,
            allowancePeriodStart: sameMonth ? memberData.allowancePeriodStart : now,
            updatedAt: now,
          });
        }

        tx.set(
          poolRef,
          {
            balance: poolBalance - input.cost,
            totalSpent: poolSpent + input.cost,
            updatedAt: new Date(),
          },
          { merge: true }
        );

        const spendRef = universeCreditTxCol().doc();
        tx.set(spendRef, {
          id: randomUUID(),
          universeId,
          type: 'spend',
          spentByUid: callerUid,
          generationType: input.generationType,
          credits: -input.cost,
          generationId: input.generationId ?? null,
          modelId: input.modelId ?? null,
          metadata: input.metadata ?? null,
          createdAt: new Date(),
        });

        return poolBalance - input.cost;
      });

      return {
        ok: true,
        creditsSpent: input.cost,
        remainingPoolBalance,
      };
    }),

  // ── Allocate credits from pool directly to a member's personal balance ──
  //
  // Alternative to pool-spending: admin can "pay out" credits to individual
  // team member accounts so they show up in the member's personal credit balance.

  allocateToMember: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        memberUid: z.string(),
        credits: z.number().min(1),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();
      if (!(await isUniverseAdmin(universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can allocate credits to members');
      }

      const memberUid = input.memberUid.toLowerCase();

      // Atomic: pool deduction + member credit + audit records
      const newPoolBalance = await db.runTransaction(async (tx) => {
        const poolRef = universeCreditCol().doc(universeId);
        const poolDoc = await tx.get(poolRef);
        const poolBalance = (poolDoc.data()?.balance as number) || 0;
        const poolSpent = (poolDoc.data()?.totalSpent as number) || 0;

        if (poolBalance < input.credits) {
          throw new Error(
            `Universe credit pool has insufficient balance. Available: ${poolBalance}, requested: ${input.credits}`
          );
        }

        const memberRef = db.collection('userCredits').doc(memberUid);
        const memberDoc = await tx.get(memberRef);
        const prev = memberDoc.data() ?? {};

        // Deduct from pool
        tx.set(
          poolRef,
          {
            balance: poolBalance - input.credits,
            totalSpent: poolSpent + input.credits,
            updatedAt: new Date(),
          },
          { merge: true }
        );

        // Credit the member's personal balance
        tx.set(
          memberRef,
          {
            uid: memberUid,
            balance: (prev.balance || 0) + input.credits,
            totalBonusReceived: (prev.totalBonusReceived || 0) + input.credits,
            totalPurchased: prev.totalPurchased || 0,
            totalSpent: prev.totalSpent || 0,
            totalLoarPurchases: prev.totalLoarPurchases || 0,
            totalFiatPurchases: prev.totalFiatPurchases || 0,
            updatedAt: new Date(),
            ...(!memberDoc.exists && { createdAt: new Date() }),
          },
          { merge: true }
        );

        // Audit log on the universe side
        const auditRef = universeCreditTxCol().doc();
        tx.set(auditRef, {
          id: randomUUID(),
          universeId,
          type: 'allocate',
          allocatedByUid: ctx.user.uid.toLowerCase(),
          allocatedToUid: memberUid,
          credits: -input.credits,
          reason: input.reason ?? null,
          createdAt: new Date(),
        });

        // Personal credit transaction for the member
        const personalTxRef = db.collection('creditTransactions').doc();
        tx.set(personalTxRef, {
          uid: memberUid,
          type: 'grant',
          source: 'universe_treasury',
          credits: input.credits,
          reason: input.reason ?? `Universe treasury allocation from ${universeId}`,
          universeId,
          allocatedByUid: ctx.user.uid.toLowerCase(),
          createdAt: new Date(),
        });

        return poolBalance - input.credits;
      });

      return {
        ok: true,
        creditsAllocated: input.credits,
        newPoolBalance,
      };
    }),

  // ── Deposit on-chain revenue into credits ────────────────────────
  //
  // Bridge: creator claims ETH from PaymentRouter → converts to credits.
  // This is how NFT sales, marketplace fees, and subscriptions flow
  // from on-chain revenue into the universe's AI generation budget.
  //
  // Also triggers reward distribution to universe stakers.

  depositRevenue: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        amountEth: z.string(), // ETH amount deposited (as string for precision)
        txHash: z.string(), // PaymentRouter claim tx or direct deposit tx
        source: z.enum([
          'nft_sales',
          'marketplace',
          'subscriptions',
          'licensing',
          'merch',
          'ads',
          'collabs',
          'canon_royalties',
          'remix_fees',
          'other',
        ]),
        /** What % goes to credits vs staker rewards. Default 70% credits, 30% stakers */
        creditSharePct: z.number().min(0).max(100).default(70),
        /** Chain ID for on-chain deposit verification */
        chainId: z.number().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();
      if (!(await isUniverseAdmin(universeId, ctx.user.uid, input.chainId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe admin can deposit revenue',
        });
      }

      // Dedup check
      const existing = await universeCreditTxCol()
        .where('txHash', '==', input.txHash)
        .limit(1)
        .get();
      if (!existing.empty) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This transaction has already been deposited',
        });
      }

      const amountEth = parseFloat(input.amountEth);
      if (isNaN(amountEth) || amountEth <= 0)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid amount' });

      // Verify the deposit tx on-chain before issuing credits
      if (!TREASURY_ADDRESS || TREASURY_ADDRESS === '0x') {
        throw new Error('TREASURY_ADDRESS is not configured');
      }
      const client = getTreasuryChainClient(input.chainId);
      const tx = await client.getTransaction({ hash: input.txHash as Hash }).catch(() => {
        throw new Error(
          'Deposit transaction not found on-chain. Confirm it has been broadcast and included in a block.'
        );
      });
      const receipt = await client.getTransactionReceipt({ hash: input.txHash as Hash });
      if (receipt.status !== 'success') {
        throw new Error('Deposit transaction was reverted on-chain.');
      }
      if (tx.to?.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) {
        throw new Error(
          'Deposit transaction recipient does not match the platform treasury address.'
        );
      }
      // Verify the deposited amount matches the claimed amount (1% tolerance)
      const claimedWei = parseUnits(input.amountEth, 18);
      const minRequired = (claimedWei * 99n) / 100n;
      if (tx.value < minRequired) {
        throw new Error(
          `Deposited ETH (${tx.value.toString()} wei) is less than the claimed amount (${claimedWei.toString()} wei).`
        );
      }

      // Convert ETH to credits using a rate
      // Base: 1 ETH ≈ 100,000 credits at current pricing ($0.008/credit, ~$3200/ETH)
      const CREDITS_PER_ETH = 100_000;
      const totalCredits = Math.floor(amountEth * CREDITS_PER_ETH);

      // Split: credits for universe pool vs staker rewards
      const creditsPortion = Math.floor(totalCredits * (input.creditSharePct / 100));
      const stakerPortion = totalCredits - creditsPortion;

      // Fund the universe credit pool
      if (creditsPortion > 0) {
        const poolRef = universeCreditCol().doc(universeId);
        const poolData = await getPoolData(universeId);

        await poolRef.set(
          {
            universeId,
            balance: poolData.balance + creditsPortion,
            totalPurchased: poolData.totalPurchased + creditsPortion,
            lastFundedAt: new Date(),
            updatedAt: new Date(),
          },
          { merge: true }
        );
      }

      // Record the deposit
      await universeCreditTxCol().add({
        id: randomUUID(),
        universeId,
        type: 'revenue_deposit',
        depositedByUid: ctx.user.uid.toLowerCase(),
        txHash: input.txHash,
        source: input.source,
        amountEth: input.amountEth,
        totalCredits,
        creditsPortion,
        stakerPortion,
        creditSharePct: input.creditSharePct,
        createdAt: new Date(),
      });

      return {
        ok: true,
        totalCredits,
        creditsPortion,
        stakerPortion,
        source: input.source,
        note:
          stakerPortion > 0
            ? `${stakerPortion} credits worth of $LOAR rewards pending for universe stakers`
            : undefined,
      };
    }),

  // ── Transaction history for the universe pool ────────────────────

  getPoolHistory: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();

      // Must be admin or active team member
      const callerUid = ctx.user.uid.toLowerCase();
      const callerIsAdmin = await isUniverseAdmin(universeId, callerUid);
      const membership = (await getMembership(universeId, callerUid)) as any;

      if (!callerIsAdmin && (!membership || membership.status !== 'active')) {
        throw new Error('Only universe admins and team members can view pool history');
      }

      const snapshot = await universeCreditTxCol()
        .where('universeId', '==', universeId)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),
});
