/**
 * Ads Router — Programmatic product placement and sponsorship management
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { TRPCError } from '@trpc/server';
import { db } from '../../lib/firebase';
import { isUniverseAdmin } from '../../lib/safe-admin';
import { resolveActingUid } from '../../services/agentAuth';
import { assertContentHashOperable } from '../../lib/content-status';
import { z } from 'zod';

const adSlotsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('adSlots');
};
const sponsorshipsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('sponsorships');
};
const adBidsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('adBids');
};

const placementTypeEnum = z.enum(['BILLBOARD', 'PRODUCT', 'SPONSORED_CHARACTER', 'AUDIO_MENTION']);

export const adsRouter = router({
  // ---- Slot Management ----

  createSlot: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        placementType: placementTypeEnum,
        minBid: z.string(), // wei
        episodes: z.number().min(1),
        description: z.string(),
        constraints: z.string().optional(),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { onBehalfOfUid, ...slotInput } = input;
      const { actingUid } = await resolveActingUid(ctx.user.uid, onBehalfOfUid, 'ads');

      // Verify caller owns or administers the universe
      const callerAddress = ctx.user.address || ctx.user.uid;
      const isAdmin = await isUniverseAdmin(slotInput.universeId, callerAddress);
      if (!isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe admin can create ad slots',
        });
      }

      const slot = {
        ...slotInput,
        creatorUid: actingUid,
        currentBid: '0',
        currentBidder: null as string | null,
        active: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ref = await adSlotsCol().add(slot);
      return { id: ref.id, ...slot };
    }),

  // ---- Bidding ----

  placeBid: protectedProcedure
    .input(
      z.object({
        slotId: z.string(),
        amount: z.string(), // wei
        txHash: z.string(),
        brandName: z.string(),
        creativeUrl: z.string().optional(),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throw new Error('Firebase is not configured');

      const { actingUid } = await resolveActingUid(ctx.user.uid, input.onBehalfOfUid, 'ads');

      return db.runTransaction(async (tx) => {
        const slotRef = adSlotsCol().doc(input.slotId);
        const slotDoc = await tx.get(slotRef);
        if (!slotDoc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Slot not found' });
        const slot = slotDoc.data()!;
        if (!slot.active)
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Slot is not active' });

        // Prevent creator from bidding on their own slot
        if (slot.creatorUid === actingUid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Cannot bid on your own slot',
          });
        }

        if (BigInt(input.amount) <= BigInt(slot.currentBid || '0')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Bid too low' });
        }
        if (BigInt(input.amount) < BigInt(slot.minBid)) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Below minimum bid' });
        }

        // Record bid
        const bidRef = adBidsCol().doc();
        tx.set(bidRef, {
          slotId: input.slotId,
          bidderUid: actingUid,
          bidderAddress: ctx.user.address || null,
          amount: input.amount,
          brandName: input.brandName,
          creativeUrl: input.creativeUrl || null,
          creativeStatus: input.creativeUrl ? 'pending' : null,
          txHash: input.txHash,
          createdAt: new Date(),
        });

        tx.update(slotRef, {
          currentBid: input.amount,
          currentBidder: actingUid,
          updatedAt: new Date(),
        });

        return { ok: true };
      });
    }),

  acceptBid: protectedProcedure
    .input(
      z.object({
        slotId: z.string(),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!db) throw new Error('Firebase is not configured');

      const { actingUid } = await resolveActingUid(ctx.user.uid, input.onBehalfOfUid, 'ads');

      return db.runTransaction(async (tx) => {
        const slotRef = adSlotsCol().doc(input.slotId);
        const slotDoc = await tx.get(slotRef);
        if (!slotDoc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Slot not found' });
        const slot = slotDoc.data()!;
        if (slot.creatorUid !== actingUid)
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Not authorized' });
        if (!slot.currentBidder) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No bids' });

        const sponsorship = {
          slotId: input.slotId,
          universeId: slot.universeId,
          sponsorUid: slot.currentBidder,
          placementType: slot.placementType,
          totalPaid: slot.currentBid,
          impressions: 0,
          episodesRemaining: slot.episodes,
          active: true,
          startedAt: new Date(),
          createdAt: new Date(),
        };

        const sponsorRef = sponsorshipsCol().doc();
        tx.set(sponsorRef, sponsorship);

        // Deactivate the slot — it's been filled
        tx.update(slotRef, {
          active: false,
          currentBid: '0',
          currentBidder: null,
          updatedAt: new Date(),
        });

        return { id: sponsorRef.id, ...sponsorship };
      });
    }),

  // ---- Creative moderation ----

  /** Sponsor uploads or updates the creative asset for an active sponsorship.
   *  Resets `creativeStatus` to `pending` and requires the content hash to be
   *  operable (not flagged/removed) before it can be served. */
  submitCreative: protectedProcedure
    .input(
      z.object({
        sponsorshipId: z.string(),
        creativeUrl: z.string().url(),
        creativeContentHash: z.string(),
        rightsDeclaration: z.enum(['original', 'licensed', 'fan']),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { actingUid } = await resolveActingUid(ctx.user.uid, input.onBehalfOfUid, 'ads');

      if (input.rightsDeclaration === 'fan') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Brand creative must be original or licensed — fan classification is not eligible for paid placement',
        });
      }

      // Gate against existing moderation state for the content hash
      await assertContentHashOperable(input.creativeContentHash);

      const ref = sponsorshipsCol().doc(input.sponsorshipId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sponsorship not found' });
      const sponsorship = doc.data()!;
      if (sponsorship.sponsorUid !== actingUid) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the sponsor can submit creative',
        });
      }

      await ref.update({
        creativeUrl: input.creativeUrl,
        creativeContentHash: input.creativeContentHash,
        rightsDeclaration: input.rightsDeclaration,
        creativeStatus: 'pending',
        creativeSubmittedAt: new Date(),
        updatedAt: new Date(),
      });

      return { ok: true, creativeStatus: 'pending' as const };
    }),

  /** Universe owner flags creative on a live sponsorship — pauses serving until admin review. */
  flagCreative: protectedProcedure
    .input(
      z.object({
        sponsorshipId: z.string(),
        reason: z.string().min(5).max(500),
        onBehalfOfUid: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { actingUid } = await resolveActingUid(ctx.user.uid, input.onBehalfOfUid, 'ads');

      const ref = sponsorshipsCol().doc(input.sponsorshipId);
      const doc = await ref.get();
      if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Sponsorship not found' });
      const sponsorship = doc.data()!;

      // Universe owner / admin only
      const callerAddress = ctx.user.address || ctx.user.uid;
      const isAdmin = await isUniverseAdmin(sponsorship.universeId, callerAddress);
      if (!isAdmin) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the universe admin can flag creative',
        });
      }

      await ref.update({
        creativeStatus: 'flagged',
        flaggedAt: new Date(),
        flaggedBy: actingUid,
        flaggedReason: input.reason,
        active: false,
        updatedAt: new Date(),
      });

      return { ok: true };
    }),

  // ---- Impressions ----

  recordImpression: protectedProcedure
    .input(z.object({ sponsorshipId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (!db) throw new Error('Firebase is not configured');

      return db.runTransaction(async (tx) => {
        const ref = sponsorshipsCol().doc(input.sponsorshipId);
        const doc = await tx.get(ref);
        if (!doc.exists)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Sponsorship not found' });

        const data = doc.data()!;

        // Only the sponsor or the universe slot creator can record impressions
        const slotRef = adSlotsCol().doc(data.slotId);
        const slotDoc = await tx.get(slotRef);
        const slotCreator = slotDoc.data()?.creatorUid;
        if (data.sponsorUid !== ctx.user.uid && slotCreator !== ctx.user.uid) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Not authorized to record impressions for this sponsorship',
          });
        }

        const newImpressions = (data.impressions || 0) + 1;
        const newRemaining = (data.episodesRemaining || 0) - 1;

        tx.update(ref, {
          impressions: newImpressions,
          episodesRemaining: Math.max(0, newRemaining),
          active: newRemaining > 0, // fixed: was > 1 (off-by-one)
        });

        return { ok: true, impressions: newImpressions };
      });
    }),

  // ---- Queries ----

  getSlot: publicProcedure.input(z.object({ slotId: z.string() })).query(async ({ input }) => {
    const doc = await adSlotsCol().doc(input.slotId).get();
    if (!doc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Slot not found' });
    return { id: doc.id, ...doc.data() } as Record<string, any>;
  }),

  getSlotsByUniverse: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await adSlotsCol()
        .where('universeId', '==', input.universeId)
        .where('active', '==', true)
        .get();

      return snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>)
        .sort(
          (a, b) =>
            (b.createdAt?.toMillis?.() ?? new Date(b.createdAt).getTime()) -
            (a.createdAt?.toMillis?.() ?? new Date(a.createdAt).getTime())
        );
    }),

  getSponsorships: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await sponsorshipsCol()
        .where('universeId', '==', input.universeId)
        .where('active', '==', true)
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  mySponsorships: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await sponsorshipsCol()
      .where('sponsorUid', '==', ctx.user.uid)
      .limit(100)
      .get();
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),

  getBids: publicProcedure.input(z.object({ slotId: z.string() })).query(async ({ input }) => {
    const snapshot = await adBidsCol().where('slotId', '==', input.slotId).get();

    return snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }) as any)
      .sort((a: any, b: any) => {
        const at = a.createdAt?.toMillis?.() ?? new Date(a.createdAt).getTime();
        const bt = b.createdAt?.toMillis?.() ?? new Date(b.createdAt).getTime();
        return bt - at;
      })
      .slice(0, 100);
  }),
});
