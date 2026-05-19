/**
 * Series Arc Router — multi-episode generation orchestrator.
 *
 * One prompt + N episodes → N continuity-locked clips with shared cast,
 * style, and visual handoff. The flagship "long-form" feature that
 * Higgsfield's shot-by-shot pipeline cannot replicate.
 *
 * Endpoints:
 *   create      — kick off an arc (returns immediately, dispatches background)
 *   status      — poll an arc's episodes
 *   list        — user's arcs, newest first
 *
 * The orchestrator lives in `services/series-arc/orchestrator.ts` and is
 * called fire-and-forget so the HTTP request doesn't hang while N
 * generations stream in over the next few minutes.
 */

import { router, protectedProcedure } from '../../lib/trpc';
import { z } from 'zod';
import { db } from '../../lib/firebase';
import { TRPCError } from '@trpc/server';
import {
  createArcRecord,
  runArc,
  type SeriesArcRecord,
} from '../../services/series-arc/orchestrator';

const arcsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('seriesArcs');
};

const createInputSchema = z.object({
  premise: z.string().min(10).max(2000),
  episodeCount: z.number().int().min(2).max(5),
  title: z.string().max(200).optional(),
  stylePreset: z.string().nullable().optional(),
  castMemberIds: z.array(z.string()).max(5).optional(),
  universeId: z.string().optional(),
});

export const seriesArcRouter = router({
  /**
   * Kick off a new series arc. Returns immediately with the arc id;
   * episodes generate in the background. Poll with `status`.
   */
  create: protectedProcedure.input(createInputSchema).mutation(async ({ input, ctx }) => {
    const arcId = await createArcRecord(ctx.user.uid, input);

    // Lazy import avoids a circular dep:
    //   appRouter → seriesArcRouter → orchestrator → appRouter.createCaller
    // The lazy import breaks the cycle at module-init time.
    const dispatch = async () => {
      try {
        const { appRouter } = await import('../index');
        await runArc(
          arcId,
          ctx.user,
          (user) => appRouter.createCaller({ user, clientIp: ctx.clientIp }) as any
        );
      } catch (err) {
        console.error(`[seriesArc] runArc ${arcId} threw:`, err);
        await arcsCol()
          .doc(arcId)
          .update({
            status: 'failed',
            error: err instanceof Error ? err.message : 'Orchestrator crashed',
            updatedAt: new Date(),
            completedAt: new Date(),
          })
          .catch(() => {});
      }
    };
    // Fire-and-forget — the runner can outlive this HTTP request.
    void dispatch();

    return { arcId, status: 'queued' as const };
  }),

  /**
   * Poll an arc's current state. Returns null if the arc doesn't exist
   * or belongs to a different user.
   */
  status: protectedProcedure
    .input(z.object({ arcId: z.string() }))
    .query(async ({ input, ctx }) => {
      const snap = await arcsCol().doc(input.arcId).get();
      if (!snap.exists) return null;
      const arc = snap.data() as SeriesArcRecord;
      if (arc.userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your arc' });
      }
      return arc;
    }),

  /**
   * List the user's series arcs, newest first.
   */
  list: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional())
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 20;
      const snap = await arcsCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => d.data() as SeriesArcRecord);
    }),
});
