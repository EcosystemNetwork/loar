/**
 * Subscriptions Router — Universe subscription management
 * Subscribe, manage tiers, check access, handle renewals
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';

const subscriptionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('subscriptions');
};
const subTiersCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('subscriptionTiers');
};
const subRevenueCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('subscriptionRevenue');
};

const tierEnum = z.enum(['FREE', 'BASIC', 'PREMIUM', 'VIP']);

export const subscriptionsRouter = router({
  // ---- Tier Config ----

  configureTier: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        tier: tierEnum,
        pricePerMonth: z.string(), // wei
        earlyAccess: z.boolean().default(false),
        votingBoost: z.boolean().default(false),
        premiumContent: z.boolean().default(false),
        behindTheScenes: z.boolean().default(false),
        creditBonus: z.number().default(0),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify caller is universe admin
      const universeDoc = await db
        .collection('cinematicUniverses')
        .doc(input.universeId.toLowerCase())
        .get();
      if (!universeDoc.exists) throw new Error('Universe not found');
      const universeData = universeDoc.data()!;
      if (universeData.creator?.toLowerCase() !== ctx.user.uid.toLowerCase()) {
        throw new Error('Only the universe admin can configure subscription tiers');
      }

      const tierId = `${input.universeId}-${input.tier}`;
      const tierData = {
        ...input,
        creatorUid: ctx.user.uid,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await subTiersCol().doc(tierId).set(tierData, { merge: true });
      return { id: tierId, ...tierData };
    }),

  getTiers: publicProcedure.input(z.object({ universeId: z.string() })).query(async ({ input }) => {
    const snapshot = await subTiersCol()
      .where('universeId', '==', input.universeId)
      .where('active', '==', true)
      .get();

    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }),

  // ---- Subscribe ----

  subscribe: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        tier: tierEnum,
        months: z.number().min(1).max(12),
        txHash: z.string(),
        amount: z.string(), // wei paid
      })
    )
    .mutation(async ({ input, ctx }) => {
      const subId = `${ctx.user.uid}-${input.universeId}`;
      const subRef = subscriptionsCol().doc(subId);
      const existing = await subRef.get();

      let startTime = new Date();
      if (existing.exists) {
        const data = existing.data()!;
        const currentExpiry = data.expiresAt?.toDate?.() || new Date(0);
        if (currentExpiry > new Date()) {
          startTime = currentExpiry; // extend from current expiry
        }
      }

      const expiresAt = new Date(startTime.getTime() + input.months * 30 * 24 * 60 * 60 * 1000);

      const subData = {
        uid: ctx.user.uid,
        universeId: input.universeId,
        tier: input.tier,
        startedAt: existing.exists ? existing.data()?.startedAt : new Date(),
        expiresAt,
        autoRenew: true,
        txHash: input.txHash,
        amount: input.amount,
        updatedAt: new Date(),
      };

      await subRef.set(subData, { merge: true });

      // Track revenue
      await subRevenueCol().add({
        universeId: input.universeId,
        subscriberUid: ctx.user.uid,
        tier: input.tier,
        amount: input.amount,
        months: input.months,
        txHash: input.txHash,
        createdAt: new Date(),
      });

      return { id: subId, ...subData };
    }),

  // ---- Cancel ----

  cancel: protectedProcedure
    .input(z.object({ universeId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const subId = `${ctx.user.uid}-${input.universeId}`;
      const ref = subscriptionsCol().doc(subId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('No subscription found');

      await ref.update({ autoRenew: false, updatedAt: new Date() });
      return { ok: true };
    }),

  // ---- Check Access ----

  hasAccess: publicProcedure
    .input(
      z.object({
        uid: z.string(),
        universeId: z.string(),
        minTier: tierEnum.default('BASIC'),
      })
    )
    .query(async ({ input }) => {
      const subId = `${input.uid}-${input.universeId}`;
      const doc = await subscriptionsCol().doc(subId).get();

      if (!doc.exists) return { hasAccess: false, tier: null, expiresAt: null };

      const data = doc.data()!;
      const expiresAt = data.expiresAt?.toDate?.() || new Date(0);
      const tierRanks: Record<string, number> = { FREE: 0, BASIC: 1, PREMIUM: 2, VIP: 3 };
      const active = expiresAt > new Date();
      const tierSufficient = tierRanks[data.tier] >= tierRanks[input.minTier];

      return {
        hasAccess: active && tierSufficient,
        tier: data.tier,
        expiresAt: expiresAt.toISOString(),
        autoRenew: data.autoRenew,
      };
    }),

  // ---- My Subscriptions ----

  mySubscriptions: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await subscriptionsCol().where('uid', '==', ctx.user.uid).get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as {
        uid: string;
        universeId: string;
        tier: string;
        price?: number;
        autoRenew: boolean;
        expiresAt?: { toDate?: () => Date };
        startedAt?: { toDate?: () => Date };
      };
      return {
        id: doc.id,
        ...data,
        active: (data.expiresAt?.toDate?.() ?? new Date(0)) > new Date(),
        expiresAt: data.expiresAt?.toDate?.()?.toISOString?.() || null,
        startedAt: data.startedAt?.toDate?.()?.toISOString?.() || null,
      };
    });
  }),

  // ---- Universe Stats ----

  getUniverseStats: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const [tiers, subs] = await Promise.all([
        subTiersCol().where('universeId', '==', input.universeId).where('active', '==', true).get(),
        subscriptionsCol().where('universeId', '==', input.universeId).get(),
      ]);

      const now = new Date();
      const activeSubs = subs.docs.filter((d) => d.data().expiresAt?.toDate?.() > now);
      const tierCounts: Record<string, number> = {};
      activeSubs.forEach((d) => {
        const tier = d.data().tier;
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;
      });

      return {
        totalSubscribers: activeSubs.length,
        tierCounts,
        availableTiers: tiers.docs.map((d) => ({ id: d.id, ...d.data() })),
      };
    }),
});
