/**
 * Watch Sessions Router — silent collector for episode playback telemetry.
 *
 * Three endpoints power a stream-of-playback model:
 *
 *   start       Create a new `watchSessions/{id}` row when playback starts on a
 *               (user, episode) pair. Returns the session id.
 *
 *   heartbeat   Periodic update from the player (~every 10s while playing) with
 *               the latest `positionSec` + total `secondsWatched`. Idempotent
 *               — the same session id keeps getting updated.
 *
 *   end         Final update when the player unmounts or playback completes.
 *               Marks `endedAt` and `completed` for analytics.
 *
 * No UI surfaces are exposed in Phase 1 of this collector — it just accumulates
 * data so future "Continue watching" / recommendation surfaces have signal.
 *
 * Data is per-user; nothing here is admin-only. Read access is restricted to
 * the row owner via the protectedProcedure wrapper.
 */
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { TRPCError } from '@trpc/server';
import { FieldValue } from 'firebase-admin/firestore';
import { protectedProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';

const watchSessionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('watchSessions');
};

export const watchSessionsRouter = router({
  start: protectedProcedure
    .input(
      z.object({
        episodeId: z.string().min(1).max(200),
        /** Optional client-supplied device id so a single user's sessions on
         *  different devices can be distinguished without us issuing IDs. */
        deviceId: z.string().max(64).optional(),
        /** Where the user was when they started this session. */
        sourceRoute: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const id = randomUUID();
      await watchSessionsCol()
        .doc(id)
        .set({
          id,
          userId: ctx.user.uid,
          episodeId: input.episodeId,
          deviceId: input.deviceId ?? null,
          sourceRoute: input.sourceRoute ?? null,
          startedAt: FieldValue.serverTimestamp(),
          lastTickAt: FieldValue.serverTimestamp(),
          endedAt: null,
          positionSec: 0,
          secondsWatched: 0,
          completed: false,
        });
      return { sessionId: id };
    }),

  heartbeat: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        positionSec: z
          .number()
          .min(0)
          .max(24 * 60 * 60),
        secondsWatched: z
          .number()
          .min(0)
          .max(24 * 60 * 60),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ref = watchSessionsCol().doc(input.sessionId);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      if ((snap.data() as { userId?: string }).userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await ref.update({
        positionSec: input.positionSec,
        secondsWatched: input.secondsWatched,
        lastTickAt: FieldValue.serverTimestamp(),
      });
      return { ok: true as const };
    }),

  end: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().uuid(),
        positionSec: z
          .number()
          .min(0)
          .max(24 * 60 * 60),
        secondsWatched: z
          .number()
          .min(0)
          .max(24 * 60 * 60),
        completed: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const ref = watchSessionsCol().doc(input.sessionId);
      const snap = await ref.get();
      if (!snap.exists) throw new TRPCError({ code: 'NOT_FOUND' });
      if ((snap.data() as { userId?: string }).userId !== ctx.user.uid) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      await ref.update({
        positionSec: input.positionSec,
        secondsWatched: input.secondsWatched,
        completed: input.completed,
        endedAt: FieldValue.serverTimestamp(),
        lastTickAt: FieldValue.serverTimestamp(),
      });
      return { ok: true as const };
    }),

  /**
   * Latest session per episode for the current user. Used later by a
   * "Continue watching" surface — Phase 1 leaves the UI off so this query
   * is unreferenced for now but typesafe-callable.
   */
  myRecent: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(20) }).optional())
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 20;
      const snap = await watchSessionsCol()
        .where('userId', '==', ctx.user.uid)
        .orderBy('lastTickAt', 'desc')
        .limit(limit)
        .get();
      return snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          episodeId: data.episodeId as string,
          positionSec: (data.positionSec as number) ?? 0,
          secondsWatched: (data.secondsWatched as number) ?? 0,
          completed: !!data.completed,
          startedAt: (data.startedAt as { toDate(): Date } | null)?.toDate?.() ?? null,
          lastTickAt: (data.lastTickAt as { toDate(): Date } | null)?.toDate?.() ?? null,
        };
      });
    }),
});
