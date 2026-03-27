/**
 * Credits Router — AI generation credit management
 * Purchase credits, spend on generation, check balances
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';

const creditsCol = db.collection('userCredits');
const creditTiersCol = db.collection('creditTiers');
const creditTxCol = db.collection('creditTransactions');

// Generation costs
const GENERATION_COSTS: Record<string, number> = {
  image: 1,
  video: 5,
  story: 2,
  spinoff: 10,
  character: 3,
  scene: 8,
};

export const creditsRouter = router({
  // ---- Balance ----

  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const doc = await creditsCol.doc(ctx.user.uid).get();
    if (!doc.exists) {
      return { balance: 0, totalPurchased: 0, totalSpent: 0 };
    }
    const data = doc.data()!;
    return {
      balance: data.balance || 0,
      totalPurchased: data.totalPurchased || 0,
      totalSpent: data.totalSpent || 0,
    };
  }),

  // ---- Tiers ----

  getTiers: publicProcedure.query(async () => {
    const snapshot = await creditTiersCol
      .where('active', '==', true)
      .orderBy('credits', 'asc')
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }),

  // ---- Purchase ----

  purchase: protectedProcedure
    .input(
      z.object({
        tierId: z.string(),
        txHash: z.string(),
        amount: z.string(), // wei paid
      })
    )
    .mutation(async ({ input, ctx }) => {
      const tierDoc = await creditTiersCol.doc(input.tierId).get();
      if (!tierDoc.exists) throw new Error('Tier not found');
      const tier = tierDoc.data()!;
      if (!tier.active) throw new Error('Tier not active');

      const credits = tier.credits as number;

      // Update user balance
      const userRef = creditsCol.doc(ctx.user.uid);
      const userDoc = await userRef.get();

      if (userDoc.exists) {
        const data = userDoc.data()!;
        await userRef.update({
          balance: (data.balance || 0) + credits,
          totalPurchased: (data.totalPurchased || 0) + credits,
          updatedAt: new Date(),
        });
      } else {
        await userRef.set({
          uid: ctx.user.uid,
          balance: credits,
          totalPurchased: credits,
          totalSpent: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Record transaction
      await creditTxCol.add({
        uid: ctx.user.uid,
        type: 'purchase',
        tierId: input.tierId,
        credits,
        txHash: input.txHash,
        amount: input.amount,
        createdAt: new Date(),
      });

      return { ok: true, creditsAdded: credits };
    }),

  // ---- Spend ----

  spend: protectedProcedure
    .input(
      z.object({
        generationType: z.enum(['image', 'video', 'story', 'spinoff', 'character', 'scene']),
        universeId: z.string().optional(),
        metadata: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const cost = GENERATION_COSTS[input.generationType] || 1;

      const userRef = creditsCol.doc(ctx.user.uid);
      const userDoc = await userRef.get();

      if (!userDoc.exists) throw new Error('No credits available');
      const data = userDoc.data()!;
      if ((data.balance || 0) < cost)
        throw new Error(`Insufficient credits. Need ${cost}, have ${data.balance || 0}`);

      await userRef.update({
        balance: data.balance - cost,
        totalSpent: (data.totalSpent || 0) + cost,
        updatedAt: new Date(),
      });

      // Record transaction
      await creditTxCol.add({
        uid: ctx.user.uid,
        type: 'spend',
        generationType: input.generationType,
        credits: -cost,
        universeId: input.universeId || null,
        metadata: input.metadata || null,
        createdAt: new Date(),
      });

      return { ok: true, creditsSpent: cost, remainingBalance: data.balance - cost };
    }),

  // ---- Grant (platform-side) ----

  grant: protectedProcedure
    .input(
      z.object({
        targetUid: z.string(),
        credits: z.number().min(1),
        reason: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const userRef = creditsCol.doc(input.targetUid);
      const userDoc = await userRef.get();

      if (userDoc.exists) {
        const data = userDoc.data()!;
        await userRef.update({
          balance: (data.balance || 0) + input.credits,
          totalPurchased: (data.totalPurchased || 0) + input.credits,
          updatedAt: new Date(),
        });
      } else {
        await userRef.set({
          uid: input.targetUid,
          balance: input.credits,
          totalPurchased: input.credits,
          totalSpent: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      await creditTxCol.add({
        uid: input.targetUid,
        type: 'grant',
        credits: input.credits,
        reason: input.reason,
        createdAt: new Date(),
      });

      return { ok: true };
    }),

  // ---- History ----

  getHistory: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(20) }))
    .query(async ({ input, ctx }) => {
      const snapshot = await creditTxCol
        .where('uid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    }),

  // ---- Costs ----

  getCosts: publicProcedure.query(() => GENERATION_COSTS),
});
