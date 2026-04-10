/**
 * Content Licensing Router — Firestore mirror of on-chain ContentLicensing.sol
 *
 * Manages content registrations (list for buy/rent/license) and deal records.
 * The actual payment routing happens on-chain through SplitRouter + PaymentRouter.
 * This router provides discoverability, search, and off-chain metadata.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { computeEntityHash } from '../../services/split-orchestrator';

const registrationsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('contentRegistrations');
};
const dealsCol = () => {
  if (!db)
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase not configured' });
  return db.collection('contentDeals');
};

const dealTypeEnum = z.enum(['BUY', 'RENT', 'LICENSE']);

export const contentLicensingRouter = router({
  /** Register content for sale/rent/license */
  register: protectedProcedure
    .input(
      z.object({
        contentHash: z.string(),
        contentId: z.string(),
        universeId: z.string(),
        buyPrice: z.string().default('0'),
        rentPricePerDay: z.string().default('0'),
        licenseFee: z.string().default('0'),
        licenseRoyaltyBps: z.number().int().min(0).max(5000).default(0),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).default(''),
        thumbnailUrl: z.string().optional(),
        mediaType: z.string().optional(),
        txHash: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify content is not fan-classified (non-commercial content cannot be licensed)
      const contentDoc = await db.collection('content').doc(input.contentId).get();
      if (contentDoc.exists && contentDoc.data()?.classification === 'fan') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Non-commercial (fan) content cannot be registered for licensing. Change content classification to "original" or "licensed" first.',
        });
      }

      const entityHash = computeEntityHash(input.contentId);

      const registration = {
        ...input,
        creatorUid: ctx.user.uid,
        creatorAddress: ctx.user.address || null,
        splitEntityHash: entityHash,
        active: true,
        totalSales: 0,
        totalRevenue: '0',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ref = await registrationsCol().add(registration);
      return { id: ref.id, ...registration };
    }),

  /** Update pricing for registered content */
  updatePricing: protectedProcedure
    .input(
      z.object({
        registrationId: z.string(),
        buyPrice: z.string().optional(),
        rentPricePerDay: z.string().optional(),
        licenseFee: z.string().optional(),
        licenseRoyaltyBps: z.number().int().min(0).max(5000).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ref = registrationsCol().doc(input.registrationId);
      const doc = await ref.get();
      if (!doc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Registration not found' });
      if (doc.data()?.creatorUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the content creator' });
      }

      const { registrationId, ...updates } = input;
      await ref.update({ ...updates, updatedAt: new Date() });
      return { ok: true };
    }),

  /** Deactivate content from the marketplace */
  deactivate: protectedProcedure
    .input(z.object({ registrationId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = registrationsCol().doc(input.registrationId);
      const doc = await ref.get();
      if (!doc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Registration not found' });
      if (doc.data()?.creatorUid !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not the content creator' });
      }

      await ref.update({ active: false, updatedAt: new Date() });
      return { ok: true };
    }),

  /** Record a deal after on-chain TX confirmation */
  recordDeal: protectedProcedure
    .input(
      z.object({
        contentHash: z.string(),
        registrationId: z.string(),
        dealType: dealTypeEnum,
        pricePaid: z.string(),
        durationDays: z.number().int().optional(),
        txHash: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const regDoc = await registrationsCol().doc(input.registrationId).get();
      if (!regDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Registration not found' });

      const now = new Date();
      const deal = {
        ...input,
        buyerUid: ctx.user.uid,
        buyerAddress: ctx.user.address || null,
        sellerUid: regDoc.data()?.creatorUid || null,
        universeId: regDoc.data()?.universeId || null,
        startTime: now,
        endTime: input.durationDays
          ? new Date(now.getTime() + input.durationDays * 24 * 60 * 60 * 1000)
          : null,
        status: 'ACTIVE' as const,
        createdAt: now,
      };

      const ref = await dealsCol().add(deal);

      // Update registration stats
      const regData = regDoc.data()!;
      await registrationsCol()
        .doc(input.registrationId)
        .update({
          totalSales: (regData.totalSales || 0) + 1,
          totalRevenue: (BigInt(regData.totalRevenue || '0') + BigInt(input.pricePaid)).toString(),
          updatedAt: now,
        });

      return { id: ref.id, ...deal };
    }),

  /** Get registration + deals for a specific content piece */
  getByContent: publicProcedure
    .input(z.object({ contentHash: z.string() }))
    .query(async ({ input }) => {
      const regSnapshot = await registrationsCol()
        .where('contentHash', '==', input.contentHash)
        .where('active', '==', true)
        .limit(1)
        .get();

      if (regSnapshot.empty) return null;

      const registration = { id: regSnapshot.docs[0].id, ...regSnapshot.docs[0].data() };

      const dealsSnapshot = await dealsCol()
        .where('contentHash', '==', input.contentHash)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();

      const deals = dealsSnapshot.docs.map((d) => ({ id: d.id, ...d.data() }));

      return { registration, deals };
    }),

  /** List all licensable content in a universe */
  getByUniverse: publicProcedure
    .input(
      z.object({
        universeId: z.string(),
        dealType: dealTypeEnum.optional(),
        sortBy: z.enum(['newest', 'price_asc', 'price_desc', 'popular']).default('newest'),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query: FirebaseFirestore.Query = registrationsCol()
        .where('universeId', '==', input.universeId)
        .where('active', '==', true);

      // Filter by deal type availability
      if (input.dealType === 'BUY') {
        query = query.where('buyPrice', '!=', '0');
      } else if (input.dealType === 'RENT') {
        query = query.where('rentPricePerDay', '!=', '0');
      } else if (input.dealType === 'LICENSE') {
        query = query.where('licenseFee', '!=', '0');
      }

      if (input.sortBy === 'popular') {
        query = query.orderBy('totalSales', 'desc');
      } else {
        query = query.orderBy('createdAt', 'desc');
      }

      const snapshot = await query.limit(input.limit).get();
      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /** Get all content registered by the current user */
  getByCreator: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input, ctx }) => {
      const snapshot = await registrationsCol()
        .where('creatorUid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /** Get deals where the current user is the buyer */
  myDeals: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }))
    .query(async ({ input, ctx }) => {
      const snapshot = await dealsCol()
        .where('buyerUid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),
});
