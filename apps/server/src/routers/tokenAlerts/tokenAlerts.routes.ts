/**
 * Token Alerts — user-defined price alerts on launchpad tokens.
 *
 * Collection: `tokenAlerts`
 *   { uid, tokenAddress, tokenSymbol, kind: 'above'|'below', targetPrice (ETH),
 *     active, chainId, createdAt, lastTriggeredAt, triggerCount }
 *
 * Evaluation runs in `apps/server/src/jobs/token-alerts.ts` (opt-in via
 * TOKEN_ALERT_ENABLED) and pushes via the existing FCM service.
 */
import { z } from 'zod';
import { protectedProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { TRPCError } from '@trpc/server';

const MAX_PER_USER = 50;

const alertsCol = () => {
  if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Firebase unavailable' });
  return db.collection('tokenAlerts');
};

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid token address');

export const tokenAlertsRouter = router({
  /** The caller's alerts, newest first. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const snap = await alertsCol()
      .where('uid', '==', ctx.user.uid)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    return snap.docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        tokenAddress: x.tokenAddress as string,
        tokenSymbol: (x.tokenSymbol ?? '') as string,
        kind: x.kind as 'above' | 'below',
        targetPrice: x.targetPrice as number,
        active: (x.active ?? true) as boolean,
        triggerCount: (x.triggerCount ?? 0) as number,
        lastTriggeredAt:
          x.lastTriggeredAt?.toDate?.()?.toISOString?.() ?? x.lastTriggeredAt ?? null,
        createdAt: x.createdAt?.toDate?.()?.toISOString?.() ?? null,
      };
    });
  }),

  create: protectedProcedure
    .input(
      z.object({
        tokenAddress: addressSchema,
        tokenSymbol: z.string().max(32).optional(),
        kind: z.enum(['above', 'below']),
        targetPrice: z.number().positive().finite(),
        chainId: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const countSnap = await alertsCol().where('uid', '==', ctx.user.uid).count().get();
      if (countSnap.data().count >= MAX_PER_USER) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Alert limit reached (${MAX_PER_USER}). Delete some first.`,
        });
      }
      const ref = alertsCol().doc();
      await ref.set({
        uid: ctx.user.uid,
        tokenAddress: input.tokenAddress.toLowerCase(),
        tokenSymbol: input.tokenSymbol ?? '',
        kind: input.kind,
        targetPrice: input.targetPrice,
        chainId: input.chainId ?? 11155111,
        active: true,
        triggerCount: 0,
        lastTriggeredAt: null,
        createdAt: new Date(),
      });
      return { id: ref.id };
    }),

  setActive: protectedProcedure
    .input(z.object({ id: z.string().min(1), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await alertsCol().doc(input.id).get();
      if (!doc.exists || doc.data()?.uid !== ctx.user.uid) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await doc.ref.update({ active: input.active });
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const doc = await alertsCol().doc(input.id).get();
      if (!doc.exists || doc.data()?.uid !== ctx.user.uid) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      await doc.ref.delete();
      return { ok: true };
    }),
});
