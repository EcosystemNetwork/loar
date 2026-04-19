/**
 * Licensing Router — IP licensing and merchandise management
 * License universes to external platforms, manage merch.
 *
 * Revenue auto-recording: activateLicense, recordRoyalty, and purchaseMerch
 * all feed the revenue dashboard automatically via recordRevenueEvent.
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { resolveActingUid } from '../../services/agentAuth';
import { recordRevenueEvent } from '../../services/revenue-recorder';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { verifyAndClaimTx } from '../../services/tx-verify';

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
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { onBehalfOfUid, ...licenseInput } = input;
      const { actingUid } = await resolveActingUid(ctx.user.uid, onBehalfOfUid, 'licensing');

      // Verify caller is the universe admin
      const callerAddress = ctx.user.address || actingUid;
      if (!(await isUniverseAdmin(input.universeId, callerAddress))) {
        throw new Error('Only the universe admin can create licenses');
      }

      const license = {
        ...licenseInput,
        licensorUid: actingUid,
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
    .mutation(async ({ input, ctx }) => {
      const ref = licensesCol().doc(input.licenseId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('License not found');
      const data = doc.data()!;
      if (data.status !== 'PROPOSED') throw new Error('Not in proposed status');

      // Only the licensor (universe admin) can activate licenses
      if (data.licensorUid !== ctx.user.uid) {
        throw new Error('Only the licensor can activate this license');
      }

      // Verify the on-chain upfront-fee payment: must be directed to the
      // licensor and meet the recorded fee. Prevents reuse of unrelated txs.
      if (!data.licensorAddress) {
        throw new Error('License is missing licensor address; re-create the license');
      }
      await verifyAndClaimTx(input.txHash, `license-activate:${input.licenseId}`, ctx.user.uid, {
        expectedTo: data.licensorAddress,
        minValueWei: data.upfrontFee || '0',
      });

      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + data.durationDays * 24 * 60 * 60 * 1000);

      await ref.update({
        status: 'ACTIVE',
        startTime,
        endTime,
        activationTxHash: input.txHash,
        updatedAt: new Date(),
      });

      // Auto-record upfront fee as licensing revenue
      if (data.upfrontFee && data.upfrontFee !== '0') {
        recordRevenueEvent({
          creatorUid: data.licensorUid,
          creatorAddress: data.licensorAddress,
          source: 'licensing',
          amountWei: data.upfrontFee,
          universeId: data.universeId,
          metadata: { licenseId: input.licenseId, type: 'upfront_fee' },
        }).catch((err) => console.error('[licensing] revenue recording failed:', err));
      }

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
    .mutation(async ({ input, ctx }) => {
      const ref = licensesCol().doc(input.licenseId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('License not found');

      const data = doc.data()!;

      // Only the licensor or licensee can record royalties
      if (data.licensorUid !== ctx.user.uid && data.licensee !== ctx.user.uid) {
        throw new Error('Only the licensor or licensee can record royalties');
      }

      // Royalty payment goes to the licensor. Bind recipient + minimum amount.
      if (!data.licensorAddress) {
        throw new Error('License is missing licensor address; re-create the license');
      }
      await verifyAndClaimTx(input.txHash, `license-royalty:${input.licenseId}`, ctx.user.uid, {
        expectedTo: data.licensorAddress,
        minValueWei: input.amount,
      });

      await ref.update({
        totalRoyalties: (BigInt(data.totalRoyalties || '0') + BigInt(input.amount)).toString(),
        lastRoyaltyAt: new Date(),
        updatedAt: new Date(),
      });

      // Auto-record royalty as licensing revenue
      recordRevenueEvent({
        creatorUid: data.licensorUid,
        creatorAddress: data.licensorAddress,
        source: 'licensing',
        amountWei: input.amount,
        universeId: data.universeId,
        metadata: { licenseId: input.licenseId, type: 'royalty', period: input.period ?? '' },
      }).catch((err) => console.error('[licensing] revenue recording failed:', err));

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
        .limit(200)
        .get();
      const now = new Date();

      const licenses = snapshot.docs.map((d) => {
        const data = { id: d.id, ...d.data() } as Record<string, any>;

        // Auto-expire ACTIVE licenses past their endTime
        if (data.status === 'ACTIVE' && data.endTime) {
          const endTime = data.endTime.toDate ? data.endTime.toDate() : new Date(data.endTime);
          if (endTime < now) {
            data.status = 'EXPIRED';
            // Fire-and-forget update in Firestore
            licensesCol()
              .doc(d.id)
              .update({ status: 'EXPIRED', updatedAt: now })
              .catch((err) => console.error('[licensing] auto-expire failed:', err));
          }
        }
        return data;
      });

      return licenses.sort(
        (a, b) =>
          (b.createdAt?.toMillis?.() ?? new Date(b.createdAt).getTime()) -
          (a.createdAt?.toMillis?.() ?? new Date(a.createdAt).getTime())
      );
    }),

  /** Get all licenses where the current user is the licensor */
  myLicenses: protectedProcedure
    .input(z.object({ limit: z.number().default(50) }))
    .query(async ({ input, ctx }) => {
      const snapshot = await licensesCol()
        .where('licensorUid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();

      const now = new Date();
      return snapshot.docs.map((d) => {
        const data = { id: d.id, ...d.data() } as Record<string, any>;
        // Auto-expire
        if (data.status === 'ACTIVE' && data.endTime) {
          const endTime = data.endTime.toDate ? data.endTime.toDate() : new Date(data.endTime);
          if (endTime < now) {
            data.status = 'EXPIRED';
            licensesCol()
              .doc(d.id)
              .update({ status: 'EXPIRED', updatedAt: now })
              .catch((err) => console.error('[licensing] auto-expire failed:', err));
          }
        }
        return data;
      });
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
      // Verify caller is the universe admin
      const callerAddress = ctx.user.address || ctx.user.uid;
      if (!(await isUniverseAdmin(input.universeId, callerAddress))) {
        throw new Error('Only the universe admin can create merchandise');
      }

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

      const totalPrice = (BigInt(data.price) * BigInt(input.quantity)).toString();

      // Bind tx to buyer → seller transfer at least matching the listed price.
      const sellerAddress = data.creatorAddress || data.universeAdminAddress;
      if (!sellerAddress) {
        throw new Error('Merch is missing seller address; contact support');
      }
      if (!ctx.user.address) {
        throw new Error('Connected wallet required to purchase merch');
      }
      await verifyAndClaimTx(input.txHash, `merch-purchase:${input.merchId}`, ctx.user.uid, {
        expectedFrom: ctx.user.address,
        expectedTo: sellerAddress,
        minValueWei: totalPrice,
      });

      await merchRef.update({
        sold: (data.sold || 0) + input.quantity,
        updatedAt: new Date(),
      });
      const order = {
        merchId: input.merchId,
        buyerUid: ctx.user.uid,
        buyerAddress: ctx.user.address || null,
        quantity: input.quantity,
        totalPrice,
        shippingAddress: input.shippingAddress || null,
        txHash: input.txHash,
        fulfillmentStatus: 'PENDING' as const,
        status: 'CONFIRMED' as const,
        createdAt: new Date(),
      };

      const orderRef = await merchOrdersCol().add(order);

      // Auto-record merch revenue for creator
      recordRevenueEvent({
        creatorUid: data.creatorUid,
        source: 'merch',
        amountWei: totalPrice,
        universeId: data.universeId,
        metadata: { merchId: input.merchId, orderId: orderRef.id },
      }).catch((err) => console.error('[licensing] revenue recording failed:', err));

      return { id: orderRef.id, ...order };
    }),

  getMerch: publicProcedure.input(z.object({ universeId: z.string() })).query(async ({ input }) => {
    const snapshot = await merchCol()
      .where('universeId', '==', input.universeId)
      .where('active', '==', true)
      .get();

    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }) as any)
      .sort((a: any, b: any) => {
        const at = a.createdAt?.toMillis?.() ?? new Date(a.createdAt).getTime();
        const bt = b.createdAt?.toMillis?.() ?? new Date(b.createdAt).getTime();
        return bt - at;
      })
      .slice(0, 200);
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

  // ---- Merch Fulfillment Tracking ----

  /** Seller updates the fulfillment status of a merch order */
  updateFulfillment: protectedProcedure
    .input(
      z.object({
        orderId: z.string(),
        fulfillmentStatus: z.enum(['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED']),
        trackingNumber: z.string().optional(),
        trackingUrl: z.string().url().optional(),
        carrier: z.string().optional(),
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const orderRef = merchOrdersCol().doc(input.orderId);
      const orderDoc = await orderRef.get();
      if (!orderDoc.exists) throw new Error('Order not found');

      // Verify the seller owns the merch item
      const orderData = orderDoc.data()!;
      const merchDoc = await merchCol().doc(orderData.merchId).get();
      if (!merchDoc.exists) throw new Error('Merch item not found');
      if (merchDoc.data()?.creatorUid !== ctx.user.uid) throw new Error('Not authorized');

      const updates: Record<string, unknown> = {
        fulfillmentStatus: input.fulfillmentStatus,
        updatedAt: new Date(),
      };
      if (input.trackingNumber) updates.trackingNumber = input.trackingNumber;
      if (input.trackingUrl) updates.trackingUrl = input.trackingUrl;
      if (input.carrier) updates.carrier = input.carrier;
      if (input.notes) updates.fulfillmentNotes = input.notes;
      if (input.fulfillmentStatus === 'SHIPPED') updates.shippedAt = new Date();
      if (input.fulfillmentStatus === 'DELIVERED') updates.deliveredAt = new Date();

      await orderRef.update(updates);
      return { ok: true, fulfillmentStatus: input.fulfillmentStatus };
    }),

  /** Get orders for a specific merch item (seller view) */
  getMerchOrders: protectedProcedure
    .input(
      z.object({
        merchId: z.string(),
        fulfillmentStatus: z
          .enum(['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'ALL'])
          .default('ALL'),
        limit: z.number().default(50),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify the seller owns the merch
      const merchDoc = await merchCol().doc(input.merchId).get();
      if (!merchDoc.exists) throw new Error('Merch not found');
      if (merchDoc.data()?.creatorUid !== ctx.user.uid) throw new Error('Not authorized');

      let query: FirebaseFirestore.Query = merchOrdersCol()
        .where('merchId', '==', input.merchId)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.fulfillmentStatus !== 'ALL') {
        query = merchOrdersCol()
          .where('merchId', '==', input.merchId)
          .where('fulfillmentStatus', '==', input.fulfillmentStatus)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      }

      const snap = await query.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  /** Buyer: track my merch order fulfillment */
  getOrderTracking: protectedProcedure
    .input(z.object({ orderId: z.string() }))
    .query(async ({ input, ctx }) => {
      const doc = await merchOrdersCol().doc(input.orderId).get();
      if (!doc.exists) throw new Error('Order not found');
      const data = doc.data()!;
      if (data.buyerUid !== ctx.user.uid) throw new Error('Not authorized');

      return {
        id: doc.id,
        fulfillmentStatus: data.fulfillmentStatus || 'PENDING',
        trackingNumber: data.trackingNumber || null,
        trackingUrl: data.trackingUrl || null,
        carrier: data.carrier || null,
        shippedAt: data.shippedAt || null,
        deliveredAt: data.deliveredAt || null,
      };
    }),
});
