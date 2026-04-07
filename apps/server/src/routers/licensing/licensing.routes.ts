/**
 * Licensing Router — IP licensing and merchandise management
 * License universes to external platforms, manage merch
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';

const licensesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('licenses');
};
const merchCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('merchandise');
};
const merchOrdersCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('merchOrders');
};

const licenseTypeEnum = z.enum(['STREAMING', 'MERCH', 'GAMING', 'COMIC', 'AUDIO', 'OTHER']);

export const licensingRouter = router({
  // ---- Licensing ----

  createLicense: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        licenseType: licenseTypeEnum,
        licensee: z.string(),
        licenseeContact: z.string().optional(),
        upfrontFee: z.string(), // wei
        royaltyBps: z.number().min(0).max(10000),
        durationDays: z.number().min(1),
        terms: z.string(),
        termsURI: z.string().optional(),
        txHash: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const license = {
        ...input,
        licensorUid: ctx.user.uid,
        licensorAddress: ctx.user.address || null,
        status: 'PROPOSED' as const,
        totalRoyalties: '0',
        startTime: null as Date | null,
        endTime: null as Date | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ref = await licensesCol().add(license);
      return { id: ref.id, ...license };
    }),

  activateLicense: protectedProcedure
    .input(
      z.object({
        licenseId: z.string(),
        txHash: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const ref = licensesCol().doc(input.licenseId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('License not found');
      const data = doc.data()!;
      if (data.status !== 'PROPOSED') throw new Error('Not in proposed status');

      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + data.durationDays * 24 * 60 * 60 * 1000);

      await ref.update({
        status: 'ACTIVE',
        startTime,
        endTime,
        activationTxHash: input.txHash,
        updatedAt: new Date(),
      });

      return { ok: true, startTime, endTime };
    }),

  recordRoyalty: protectedProcedure
    .input(
      z.object({
        licenseId: z.string(),
        amount: z.string(),
        txHash: z.string(),
        period: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const ref = licensesCol().doc(input.licenseId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('License not found');

      const data = doc.data()!;
      await ref.update({
        totalRoyalties: (BigInt(data.totalRoyalties || '0') + BigInt(input.amount)).toString(),
        updatedAt: new Date(),
      });

      return { ok: true };
    }),

  revokeLicense: protectedProcedure
    .input(z.object({ licenseId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = licensesCol().doc(input.licenseId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('License not found');
      if (doc.data()?.licensorUid !== ctx.user.uid) throw new Error('Not authorized');

      await ref.update({ status: 'REVOKED', updatedAt: new Date() });
      return { ok: true };
    }),

  getLicenses: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await licensesCol()
        .where('universeId', '==', input.universeId)
        .orderBy('createdAt', 'desc')
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  // ---- Merchandise ----

  createMerch: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        name: z.string(),
        description: z.string(),
        price: z.string(), // wei
        imageUrl: z.string(),
        category: z.enum(['SHIRT', 'POSTER', 'FIGURINE', 'COMIC', 'DIGITAL', 'OTHER']),
        stock: z.number().default(0), // 0 = unlimited
        metadataURI: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const merch = {
        ...input,
        creatorUid: ctx.user.uid,
        sold: 0,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ref = await merchCol().add(merch);
      return { id: ref.id, ...merch };
    }),

  purchaseMerch: protectedProcedure
    .input(
      z.object({
        merchId: z.string(),
        quantity: z.number().min(1).default(1),
        shippingAddress: z.string().optional(),
        txHash: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const merchRef = merchCol().doc(input.merchId);
      const merchDoc = await merchRef.get();
      if (!merchDoc.exists) throw new Error('Merch not found');

      const data = merchDoc.data()!;
      if (!data.active) throw new Error('Merch not available');
      if (data.stock > 0 && data.sold + input.quantity > data.stock) {
        throw new Error('Insufficient stock');
      }

      await merchRef.update({
        sold: (data.sold || 0) + input.quantity,
        updatedAt: new Date(),
      });

      const order = {
        merchId: input.merchId,
        buyerUid: ctx.user.uid,
        buyerAddress: ctx.user.address || null,
        quantity: input.quantity,
        totalPrice: (BigInt(data.price) * BigInt(input.quantity)).toString(),
        shippingAddress: input.shippingAddress || null,
        txHash: input.txHash,
        status: 'CONFIRMED' as const,
        createdAt: new Date(),
      };

      const ref = await merchOrdersCol().add(order);
      return { id: ref.id, ...order };
    }),

  getMerch: publicProcedure.input(z.object({ universeId: z.string() })).query(async ({ input }) => {
    const snapshot = await merchCol()
      .where('universeId', '==', input.universeId)
      .where('active', '==', true)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),

  getOrders: protectedProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input, ctx }) => {
      const snapshot = await merchOrdersCol()
        .where('buyerUid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  myMerch: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await merchCol()
      .where('creatorUid', '==', ctx.user.uid)
      .orderBy('createdAt', 'desc')
      .get();

    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),
});
