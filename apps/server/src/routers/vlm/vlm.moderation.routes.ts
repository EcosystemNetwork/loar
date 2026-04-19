/**
 * vlm.moderation — read risk scores, admin requeue + override.
 * Writes flow through the shared moderation service to keep
 * `flags`/`contentAuditLog` as a single source of truth.
 */

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { router, publicProcedure, protectedProcedure, adminProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';
import { getVlmQueue } from '../../lib/queue';

export const vlmModerationRouter = router({
  riskScore: publicProcedure.input(z.object({ contentId: z.string() })).query(async ({ input }) => {
    if (!firebaseAvailable) return null;
    const doc = await db.collection('vlmRiskScores').doc(input.contentId).get();
    if (!doc.exists) return null;
    return doc.data();
  }),

  batchRiskScores: publicProcedure
    .input(z.object({ contentIds: z.array(z.string()).min(1).max(50) }))
    .query(async ({ input }) => {
      if (!firebaseAvailable) return {} as Record<string, any>;
      const refs = input.contentIds.map((id) => db.collection('vlmRiskScores').doc(id));
      const snap = await db.getAll(...refs);
      const out: Record<string, any> = {};
      for (const d of snap) {
        if (d.exists) out[d.id] = d.data();
      }
      return out;
    }),

  requeue: adminProcedure
    .input(
      z.object({
        contentId: z.string(),
        mediaUrl: z.string().url(),
        assetType: z.enum(['video', 'image']).default('video'),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!firebaseAvailable) throw new Error('Storage unavailable');
      const jobId = `vlm_${randomUUID()}`;
      await db
        .collection('vlmJobs')
        .doc(jobId)
        .set({
          jobId,
          kind: 'extract',
          status: 'pending',
          creatorUid: ctx.user.uid.toLowerCase(),
          input: {
            assetType: input.assetType,
            mediaUrl: input.mediaUrl,
            contentId: input.contentId,
            options: { force: true, model: 'gemini-2.5-pro' },
          },
          createdAt: new Date(),
        });
      await getVlmQueue().add(
        'extract',
        {
          jobId,
          kind: 'extract',
          creatorUid: ctx.user.uid.toLowerCase(),
          input: {
            assetType: input.assetType,
            mediaUrl: input.mediaUrl,
            contentId: input.contentId,
            options: { force: true, model: 'gemini-2.5-pro' },
          },
        },
        { jobId }
      );
      return { jobId };
    }),

  overrideAutoAction: adminProcedure
    .input(
      z.object({
        contentId: z.string(),
        autoAction: z.enum(['none', 'flag', 'hide_pending_review']),
        reason: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!firebaseAvailable) throw new Error('Storage unavailable');
      await db
        .collection('vlmRiskScores')
        .doc(input.contentId)
        .set(
          {
            autoAction: input.autoAction,
            overriddenBy: ctx.user.uid.toLowerCase(),
            overriddenAt: new Date(),
            overrideReason: input.reason ?? null,
          },
          { merge: true }
        );
      await db.collection('contentAuditLog').add({
        contentId: input.contentId,
        action: `vlm_override_${input.autoAction}`,
        adminUid: ctx.user.uid.toLowerCase(),
        reason: input.reason ?? null,
        createdAt: new Date().toISOString(),
      });
      return { ok: true };
    }),
});
