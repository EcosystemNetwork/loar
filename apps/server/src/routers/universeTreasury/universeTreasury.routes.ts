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
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { DEFAULT_PACKAGES } from '../credits/credits.routes';
import { getMembership } from '../universeTeam/universeTeam.routes';

const universeCreditCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('universeCredits');
};
const universeCreditTxCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('universeCreditTransactions');
};

// ── Helpers ───────────────────────────────────────────────────────────────

async function getUniverseAdminUid(universeId: string): Promise<string | null> {
  const doc = await db.collection('cinematicUniverses').doc(universeId.toLowerCase()).get();
  if (!doc.exists) return null;
  return (doc.data()?.creator as string | undefined)?.toLowerCase() ?? null;
}

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
      })
    )
    .mutation(async ({ input, ctx }) => {
      const adminUid = await getUniverseAdminUid(input.universeId);
      if (!adminUid || adminUid !== ctx.user.uid.toLowerCase()) {
        throw new Error('Only the universe admin can fund the universe credit pool');
      }

      const pkg = DEFAULT_PACKAGES.find((p) => p.id === input.packageId);
      if (!pkg || !pkg.active) throw new Error('Package not found or inactive');

      const isLoar = input.paymentMethod === 'loar';
      const totalCredits = isLoar
        ? pkg.credits + pkg.bonusCredits + pkg.loarBonusCredits
        : pkg.credits + pkg.bonusCredits;

      const universeId = input.universeId.toLowerCase();
      const poolRef = universeCreditCol().doc(universeId);
      const poolData = await getPoolData(universeId);

      await poolRef.set(
        {
          universeId,
          balance: poolData.balance + totalCredits,
          totalPurchased: poolData.totalPurchased + totalCredits,
          totalSpent: poolData.totalSpent,
          lastFundedAt: new Date(),
          updatedAt: new Date(),
        },
        { merge: true }
      );

      await universeCreditTxCol().add({
        id: randomUUID(),
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

      return {
        ok: true,
        creditsAdded: totalCredits,
        newBalance: poolData.balance + totalCredits,
      };
    }),

  // ── Spend from universe pool (team members only) ──────────────────
  //
  // Called server-side by credits.spend when useUniversePool=true.
  // Exposed here so it can also be called directly by generation routes.

  spendFromPool: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        generationType: z.string(),
        cost: z.number().min(1),
        generationId: z.string().optional(),
        modelId: z.string().optional(),
        metadata: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const universeId = input.universeId.toLowerCase();
      const callerUid = ctx.user.uid.toLowerCase();

      // Verify membership
      const membership = (await getMembership(universeId, callerUid)) as any;
      const isAdmin = (await getUniverseAdminUid(universeId)) === callerUid;
      if (!isAdmin && (!membership || membership.status !== 'active')) {
        throw new Error('You are not an active team member of this universe');
      }

      // Enforce monthly allowance if set (skip for admin)
      if (!isAdmin && membership.monthlyAllowance > 0) {
        // Reset counter if we're in a new calendar month
        const periodStart = membership.allowancePeriodStart?.toDate?.() ?? new Date(0);
        const now = new Date();
        const sameMonth =
          periodStart.getFullYear() === now.getFullYear() &&
          periodStart.getMonth() === now.getMonth();

        const usedThisMonth = sameMonth ? membership.creditsUsedThisMonth || 0 : 0;

        if (usedThisMonth + input.cost > membership.monthlyAllowance) {
          throw new Error(
            `Monthly credit allowance exceeded. Allowance: ${membership.monthlyAllowance}, used: ${usedThisMonth}, requested: ${input.cost}`
          );
        }

        // Update usage counter
        const docId = `${universeId}-${callerUid}`;
        await db
          .collection('universeTeamMembers')
          .doc(docId)
          .update({
            creditsUsedThisMonth: usedThisMonth + input.cost,
            allowancePeriodStart: sameMonth ? membership.allowancePeriodStart : now,
            updatedAt: now,
          });
      }

      // Deduct from pool
      const poolRef = universeCreditCol().doc(universeId);
      const poolData = await getPoolData(universeId);

      if (poolData.balance < input.cost) {
        throw new Error(
          `Universe credit pool is too low. Need ${input.cost}, available ${poolData.balance}. Ask the universe admin to top up the pool.`
        );
      }

      await poolRef.update({
        balance: poolData.balance - input.cost,
        totalSpent: poolData.totalSpent + input.cost,
        updatedAt: new Date(),
      });

      await universeCreditTxCol().add({
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

      return {
        ok: true,
        creditsSpent: input.cost,
        remainingPoolBalance: poolData.balance - input.cost,
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
      const adminUid = await getUniverseAdminUid(universeId);
      if (!adminUid || adminUid !== ctx.user.uid.toLowerCase()) {
        throw new Error('Only the universe admin can allocate credits to members');
      }

      const poolData = await getPoolData(universeId);
      if (poolData.balance < input.credits) {
        throw new Error(
          `Universe credit pool has insufficient balance. Available: ${poolData.balance}, requested: ${input.credits}`
        );
      }

      const memberUid = input.memberUid.toLowerCase();

      // Deduct from pool
      await universeCreditCol()
        .doc(universeId)
        .update({
          balance: poolData.balance - input.credits,
          totalSpent: poolData.totalSpent + input.credits,
          updatedAt: new Date(),
        });

      // Credit the member's personal balance
      const memberRef = db.collection('userCredits').doc(memberUid);
      const memberDoc = await memberRef.get();

      if (memberDoc.exists) {
        const d = memberDoc.data()!;
        await memberRef.update({
          balance: (d.balance || 0) + input.credits,
          totalBonusReceived: (d.totalBonusReceived || 0) + input.credits,
          updatedAt: new Date(),
        });
      } else {
        await memberRef.set({
          uid: memberUid,
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

      // Audit log on the universe side
      await universeCreditTxCol().add({
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
      await db.collection('creditTransactions').add({
        uid: memberUid,
        type: 'grant',
        source: 'universe_treasury',
        credits: input.credits,
        reason: input.reason ?? `Universe treasury allocation from ${universeId}`,
        universeId,
        allocatedByUid: ctx.user.uid.toLowerCase(),
        createdAt: new Date(),
      });

      return {
        ok: true,
        creditsAllocated: input.credits,
        newPoolBalance: poolData.balance - input.credits,
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
      const adminUid = await getUniverseAdminUid(universeId);
      const callerUid = ctx.user.uid.toLowerCase();
      const membership = (await getMembership(universeId, callerUid)) as any;

      if (adminUid !== callerUid && (!membership || membership.status !== 'active')) {
        throw new Error('Only universe admins and team members can view pool history');
      }

      const snapshot = await universeCreditTxCol
        .where('universeId', '==', universeId)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),
});
