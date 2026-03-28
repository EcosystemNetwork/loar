/**
 * Collabs Router — Cross-universe collaboration management
 * Propose, accept, activate collabs and track joint episodes
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';

const collabsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('collabs');
};
const collabEpisodesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('collabEpisodes');
};

export const collabsRouter = router({
  propose: protectedProcedure
    .input(
      z.object({
        universeA: z.string(),
        universeB: z.string(),
        revenueShareBps: z.number().min(0).max(10000),
        durationDays: z.number().min(1).max(365),
        title: z.string(),
        description: z.string(),
        metadataURI: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const collab = {
        ...input,
        proposerUid: ctx.user.uid,
        proposerAddress: ctx.user.address || null,
        acceptorUid: null as string | null,
        acceptorAddress: null as string | null,
        status: 'PROPOSED' as const,
        totalRevenue: '0',
        episodeCount: 0,
        startTime: null as Date | null,
        endTime: null as Date | null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const ref = await collabsCol().add(collab);
      return { id: ref.id, ...collab };
    }),

  accept: protectedProcedure
    .input(z.object({ collabId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = collabsCol().doc(input.collabId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Collab not found');
      if (doc.data()?.status !== 'PROPOSED') throw new Error('Not in proposed status');

      await ref.update({
        acceptorUid: ctx.user.uid,
        acceptorAddress: ctx.user.address || null,
        status: 'ACCEPTED',
        updatedAt: new Date(),
      });

      return { ok: true };
    }),

  activate: protectedProcedure
    .input(z.object({ collabId: z.string(), txHash: z.string().optional() }))
    .mutation(async ({ input }) => {
      const ref = collabsCol().doc(input.collabId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Collab not found');
      if (doc.data()?.status !== 'ACCEPTED') throw new Error('Not accepted');

      const data = doc.data()!;
      const startTime = new Date();
      const endTime = new Date(startTime.getTime() + data.durationDays * 24 * 60 * 60 * 1000);

      await ref.update({
        status: 'ACTIVE',
        startTime,
        endTime,
        updatedAt: new Date(),
      });

      return { ok: true, startTime, endTime };
    }),

  recordEpisode: protectedProcedure
    .input(
      z.object({
        collabId: z.string(),
        episodeTitle: z.string(),
        contentHash: z.string(),
        mediaUrl: z.string().optional(),
        revenue: z.string(), // wei
      })
    )
    .mutation(async ({ input, ctx }) => {
      const collabRef = collabsCol().doc(input.collabId);
      const collabDoc = await collabRef.get();
      if (!collabDoc.exists) throw new Error('Collab not found');
      if (collabDoc.data()?.status !== 'ACTIVE') throw new Error('Collab not active');

      const episode = {
        collabId: input.collabId,
        title: input.episodeTitle,
        contentHash: input.contentHash,
        mediaUrl: input.mediaUrl || null,
        revenue: input.revenue,
        creatorUid: ctx.user.uid,
        createdAt: new Date(),
      };

      await collabEpisodesCol().add(episode);

      const data = collabDoc.data()!;
      await collabRef.update({
        episodeCount: (data.episodeCount || 0) + 1,
        totalRevenue: (BigInt(data.totalRevenue || '0') + BigInt(input.revenue)).toString(),
        updatedAt: new Date(),
      });

      return { ok: true, episode };
    }),

  complete: protectedProcedure
    .input(z.object({ collabId: z.string() }))
    .mutation(async ({ input }) => {
      const ref = collabsCol().doc(input.collabId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Collab not found');
      if (doc.data()?.status !== 'ACTIVE') throw new Error('Not active');

      await ref.update({ status: 'COMPLETED', updatedAt: new Date() });
      return { ok: true };
    }),

  cancel: protectedProcedure
    .input(z.object({ collabId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const ref = collabsCol().doc(input.collabId);
      const doc = await ref.get();
      if (!doc.exists) throw new Error('Collab not found');
      if (doc.data()?.proposerUid !== ctx.user.uid) throw new Error('Not authorized');

      const status = doc.data()?.status;
      if (status !== 'PROPOSED' && status !== 'ACCEPTED') throw new Error('Cannot cancel');

      await ref.update({ status: 'CANCELLED', updatedAt: new Date() });
      return { ok: true };
    }),

  // ---- Queries ----

  getByUniverse: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const [asA, asB] = await Promise.all([
        collabsCol().where('universeA', '==', input.universeId).get(),
        collabsCol().where('universeB', '==', input.universeId).get(),
      ]);

      const all = [...asA.docs, ...asB.docs].map((d) => ({ id: d.id, ...d.data() }));
      return all.sort(
        (a: any, b: any) => (b.createdAt?.toDate?.() || 0) - (a.createdAt?.toDate?.() || 0)
      );
    }),

  getCollab: publicProcedure.input(z.object({ collabId: z.string() })).query(async ({ input }) => {
    const doc = await collabsCol().doc(input.collabId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  }),

  getEpisodes: publicProcedure
    .input(z.object({ collabId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await collabEpisodesCol
        .where('collabId', '==', input.collabId)
        .orderBy('createdAt', 'desc')
        .get();

      return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),

  myCollabs: protectedProcedure.query(async ({ ctx }) => {
    const [asProposer, asAcceptor] = await Promise.all([
      collabsCol().where('proposerUid', '==', ctx.user.uid).get(),
      collabsCol().where('acceptorUid', '==', ctx.user.uid).get(),
    ]);

    const all = [...asProposer.docs, ...asAcceptor.docs].map((d) => ({ id: d.id, ...d.data() }));
    return all;
  }),
});
