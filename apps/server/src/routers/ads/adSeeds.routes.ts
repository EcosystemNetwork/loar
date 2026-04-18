/**
 * Ad Seeds Router — "Seed Dance" flow
 *
 * Advertisers create ad seeds (brand creatives + bounty budget), then filmmakers
 * claim and place those ads in their films to earn the bounty.
 *
 * Flow:
 *   1. Advertiser creates a seed (brand, creative assets, budget per placement)
 *   2. Filmmakers browse open seeds
 *   3. Filmmaker claims a seed → gets the creative assets
 *   4. Filmmaker submits proof-of-placement (link to film/episode with the ad)
 *   5. Advertiser approves → $LOAR released to filmmaker
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, publicProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';

const getSeedsCol = () => (firebaseAvailable ? db.collection('adSeeds') : null);
const getPlacementsCol = () => (firebaseAvailable ? db.collection('adSeedPlacements') : null);

const seedTypeEnum = z.enum(['LOGO', 'PRODUCT', 'CHARACTER', 'AUDIO', 'BILLBOARD', 'NARRATIVE']);

export const adSeedsRouter = router({
  // ── Create a seed ─────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        brandName: z.string().min(1).max(100),
        seedType: seedTypeEnum,
        title: z.string().min(3).max(200),
        description: z.string().min(10).max(5000),
        creativeUrl: z.string().url().optional(),
        guidelines: z.string().max(5000).optional(),
        rewardPerPlacement: z.number().min(10),
        maxPlacements: z.number().min(1).max(1000),
        deadlineDays: z.number().min(1).max(365),
        targetGenres: z.array(z.string()).optional(),
        txHash: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const col = getSeedsCol();
      if (!col)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Seeds not available' });

      const now = new Date();
      const deadline = new Date(now.getTime() + input.deadlineDays * 86400 * 1000);

      const seed = {
        advertiser: ctx.user.address,
        advertiserUid: ctx.user.uid,
        brandName: input.brandName,
        seedType: input.seedType,
        title: input.title,
        description: input.description,
        creativeUrl: input.creativeUrl || null,
        guidelines: input.guidelines || null,
        rewardPerPlacement: input.rewardPerPlacement,
        maxPlacements: input.maxPlacements,
        activePlacements: 0,
        approvedPlacements: 0,
        totalBudget: input.rewardPerPlacement * input.maxPlacements,
        deadline: deadline.toISOString(),
        targetGenres: input.targetGenres || [],
        status: 'open' as const, // open | paused | exhausted | expired
        txHash: input.txHash || null,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      const ref = await col.add(seed);
      return { id: ref.id, ...seed };
    }),

  // ── List seeds (public) ───────────────────────────────────
  list: publicProcedure
    .input(
      z.object({
        status: z.enum(['open', 'paused', 'exhausted', 'expired']).optional(),
        seedType: seedTypeEnum.optional(),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const col = getSeedsCol();
      if (!col) return [];

      let query = col.orderBy('createdAt', 'desc').limit(input.limit);
      if (input.status) query = query.where('status', '==', input.status);
      if (input.seedType) query = query.where('seedType', '==', input.seedType);

      const snap = await query.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  // ── Get single seed ───────────────────────────────────────
  get: publicProcedure.input(z.object({ seedId: z.string() })).query(async ({ input }) => {
    const col = getSeedsCol();
    if (!col) return null;
    const doc = await col.doc(input.seedId).get();
    return doc.exists ? ({ id: doc.id, ...doc.data() } as Record<string, any>) : null;
  }),

  // ── Submit placement (filmmaker claims + shows proof) ─────
  submitPlacement: protectedProcedure
    .input(
      z.object({
        seedId: z.string(),
        contentUrl: z.string().url(),
        contentHash: z.string().optional(),
        episodeTitle: z.string().max(200).optional(),
        universeId: z.string().optional(),
        description: z.string().max(2000),
        timestamp: z.string().optional(), // where in the film the ad appears
      })
    )
    .mutation(async ({ ctx, input }) => {
      const seedsCol = getSeedsCol();
      const placementsCol = getPlacementsCol();
      if (!seedsCol || !placementsCol)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      const seedDoc = await seedsCol.doc(input.seedId).get();
      if (!seedDoc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Seed not found' });
      const seed = seedDoc.data()!;

      if (seed.status !== 'open')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Seed is not accepting placements' });
      if (new Date(seed.deadline) < new Date())
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Seed has expired' });
      if (seed.advertiserUid === ctx.user.uid)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot place your own ad seed' });

      // Check if filmmaker already has a pending/approved placement for this seed
      const existing = await placementsCol
        .where('seedId', '==', input.seedId)
        .where('filmmakerUid', '==', ctx.user.uid)
        .where('status', 'in', ['pending', 'approved'])
        .limit(1)
        .get();
      if (!existing.empty)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You already have an active placement for this seed',
        });

      const now = new Date();
      const placement = {
        seedId: input.seedId,
        filmmaker: ctx.user.address,
        filmmakerUid: ctx.user.uid,
        contentUrl: input.contentUrl,
        contentHash: input.contentHash || null,
        episodeTitle: input.episodeTitle || null,
        universeId: input.universeId || null,
        description: input.description,
        timestamp: input.timestamp || null,
        reward: seed.rewardPerPlacement,
        status: 'pending' as const, // pending | approved | rejected
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      const ref = await placementsCol.add(placement);

      // Increment active placements count
      await seedsCol.doc(input.seedId).update({
        activePlacements: (seed.activePlacements || 0) + 1,
        updatedAt: now.toISOString(),
      });

      return { id: ref.id, ...placement };
    }),

  // ── List placements for a seed ────────────────────────────
  placements: publicProcedure.input(z.object({ seedId: z.string() })).query(async ({ input }) => {
    const col = getPlacementsCol();
    if (!col) return [];
    const snap = await col.where('seedId', '==', input.seedId).orderBy('createdAt', 'desc').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),

  // ── Approve placement (advertiser only) ───────────────────
  approvePlacement: protectedProcedure
    .input(
      z.object({
        placementId: z.string(),
        txHash: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const seedsCol = getSeedsCol();
      const placementsCol = getPlacementsCol();
      if (!seedsCol || !placementsCol)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      const placementDoc = await placementsCol.doc(input.placementId).get();
      if (!placementDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Placement not found' });
      const placement = placementDoc.data()!;

      if (placement.status !== 'pending')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Placement is not pending' });

      // Verify caller is the seed advertiser
      const seedDoc = await seedsCol.doc(placement.seedId).get();
      if (!seedDoc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Seed not found' });
      const seed = seedDoc.data()!;

      if (seed.advertiserUid !== ctx.user.uid)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the advertiser can approve' });

      const now = new Date();
      await placementsCol.doc(input.placementId).update({
        status: 'approved',
        awardTxHash: input.txHash || null,
        updatedAt: now.toISOString(),
      });

      const newApproved = (seed.approvedPlacements || 0) + 1;
      const exhausted = newApproved >= seed.maxPlacements;

      await seedsCol.doc(placement.seedId).update({
        approvedPlacements: newApproved,
        status: exhausted ? 'exhausted' : seed.status,
        updatedAt: now.toISOString(),
      });

      return { success: true, exhausted };
    }),

  // ── Reject placement (advertiser only) ────────────────────
  rejectPlacement: protectedProcedure
    .input(
      z.object({
        placementId: z.string(),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const seedsCol = getSeedsCol();
      const placementsCol = getPlacementsCol();
      if (!seedsCol || !placementsCol)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Service not available' });

      const placementDoc = await placementsCol.doc(input.placementId).get();
      if (!placementDoc.exists)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Placement not found' });
      const placement = placementDoc.data()!;

      if (placement.status !== 'pending')
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Placement is not pending' });

      const seedDoc = await seedsCol.doc(placement.seedId).get();
      if (!seedDoc.exists) throw new TRPCError({ code: 'NOT_FOUND', message: 'Seed not found' });
      const seed = seedDoc.data()!;

      if (seed.advertiserUid !== ctx.user.uid)
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the advertiser can reject' });

      const now = new Date();
      await placementsCol.doc(input.placementId).update({
        status: 'rejected',
        rejectionReason: input.reason || null,
        updatedAt: now.toISOString(),
      });

      // Decrement active count since rejected
      await seedsCol.doc(placement.seedId).update({
        activePlacements: Math.max(0, (seed.activePlacements || 0) - 1),
        updatedAt: now.toISOString(),
      });

      return { success: true };
    }),

  // ── My seeds (advertiser dashboard) ───────────────────────
  mySeeds: protectedProcedure.query(async ({ ctx }) => {
    const col = getSeedsCol();
    if (!col) return [];
    const snap = await col
      .where('advertiserUid', '==', ctx.user.uid)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),

  // ── My placements (filmmaker dashboard) ───────────────────
  myPlacements: protectedProcedure.query(async ({ ctx }) => {
    const col = getPlacementsCol();
    if (!col) return [];
    const snap = await col
      .where('filmmakerUid', '==', ctx.user.uid)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }),

  // ── Stats ─────────────────────────────────────────────────
  stats: publicProcedure.query(async () => {
    const col = getSeedsCol();
    if (!col) return { total: 0, open: 0, totalBudget: 0, totalPlacements: 0 };

    const snap = await col.get();
    let open = 0;
    let totalBudget = 0;
    let totalPlacements = 0;

    snap.docs.forEach((d) => {
      const data = d.data();
      totalBudget += data.totalBudget || 0;
      totalPlacements += data.approvedPlacements || 0;
      if (data.status === 'open') open++;
    });

    return { total: snap.size, open, totalBudget, totalPlacements };
  }),
});
