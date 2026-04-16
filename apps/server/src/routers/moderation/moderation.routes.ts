/**
 * Moderation Router — content flagging, review queue, and DMCA takedowns.
 *
 * Public: flag content, submit takedown request, check content status.
 * Admin: review queue, update content status, view audit log.
 *
 * Firestore collections:
 *   flags/{autoId}           — user-submitted content flags
 *   takedownRequests/{autoId} — DMCA/legal takedown requests
 *   contentAuditLog/{autoId}  — immutable audit trail (no updates/deletes)
 */
import { z } from 'zod';
import { router, protectedProcedure, publicProcedure, adminProcedure } from '../../lib/trpc';
import { db, firebaseAvailable } from '../../lib/firebase';

const flagsCol = () => (firebaseAvailable ? db.collection('flags') : null);
const takedownCol = () => (firebaseAvailable ? db.collection('takedownRequests') : null);
const auditCol = () => (firebaseAvailable ? db.collection('contentAuditLog') : null);
const contentCol = () => (firebaseAvailable ? db.collection('content') : null);

// ── Router ────────────────────────────────────────────────────────────────

export const moderationRouter = router({
  // ── Flag content (any authenticated user) ─────────────────────
  flag: protectedProcedure
    .input(
      z.object({
        contentId: z.string(),
        reason: z.enum(['spam', 'copyright', 'offensive', 'impersonation', 'other']),
        description: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const col = flagsCol();
      if (!col) throw new Error('Not available');

      // Dedup: one flag per user per content
      const existing = await col
        .where('contentId', '==', input.contentId)
        .where('flaggerUid', '==', ctx.user.uid.toLowerCase())
        .limit(1)
        .get();
      if (!existing.empty) throw new Error('You already flagged this content');

      const now = new Date();
      const flag = {
        contentId: input.contentId,
        flaggerUid: ctx.user.uid.toLowerCase(),
        flaggerAddress: ctx.user.address,
        reason: input.reason,
        description: input.description || null,
        status: 'pending', // pending | reviewed | dismissed
        createdAt: now.toISOString(),
      };

      const ref = await col.add(flag);

      // Auto-escalate: if 3+ unique flags, set content status to under_review
      const allFlags = await col.where('contentId', '==', input.contentId).get();
      if (allFlags.size >= 3) {
        const cCol = contentCol();
        if (cCol) {
          await cCol
            .doc(input.contentId)
            .update({
              contentStatus: 'under_review',
              contentStatusUpdatedAt: now.toISOString(),
              contentStatusUpdatedBy: 'auto_escalation',
            })
            .catch(() => {
              /* Content doc may not exist */
            });
        }
      }

      return { id: ref.id, flagCount: allFlags.size };
    }),

  // ── Submit DMCA takedown (public, no auth required) ───────────
  submitTakedown: publicProcedure
    .input(
      z.object({
        contentId: z.string(),
        claimantName: z.string().min(1),
        claimantEmail: z.string().email(),
        copyrightWork: z.string().min(10), // Description of the original work
        explanation: z.string().min(20), // Why this is infringing
        goodFaith: z.boolean(), // Checkbox: sworn statement
      })
    )
    .mutation(async ({ input }) => {
      const col = takedownCol();
      if (!col) throw new Error('Not available');
      if (!input.goodFaith) throw new Error('Good faith declaration required');

      // Dedup: prevent same email from filing multiple takedowns for same content
      const existing = await col
        .where('contentId', '==', input.contentId)
        .where('claimantEmail', '==', input.claimantEmail)
        .limit(1)
        .get();
      if (!existing.empty) {
        throw new Error('A takedown request for this content from this email already exists');
      }

      const now = new Date();
      const request = {
        contentId: input.contentId,
        claimantName: input.claimantName,
        claimantEmail: input.claimantEmail,
        copyrightWork: input.copyrightWork,
        explanation: input.explanation,
        status: 'pending', // pending | actioned | rejected
        createdAt: now.toISOString(),
      };

      const ref = await col.add(request);

      // Auto-flag the content
      const cCol = contentCol();
      if (cCol) {
        await cCol
          .doc(input.contentId)
          .update({
            contentStatus: 'flagged',
            contentStatusUpdatedAt: now.toISOString(),
            contentStatusUpdatedBy: 'dmca_takedown',
          })
          .catch(() => {});
      }

      return { id: ref.id };
    }),

  // ── Check content status (public) ─────────────────────────────
  getContentStatus: publicProcedure
    .input(z.object({ contentId: z.string() }))
    .query(async ({ input }) => {
      const col = contentCol();
      if (!col) return { contentStatus: 'active' };
      const doc = await col.doc(input.contentId).get();
      if (!doc.exists) return { contentStatus: 'active' };
      const data = doc.data()!;
      return {
        contentStatus: data.contentStatus || 'active',
        updatedAt: data.contentStatusUpdatedAt || null,
      };
    }),

  // ── Admin: review queue ───────────────────────────────────────
  reviewQueue: adminProcedure
    .input(
      z.object({
        type: z.enum(['flags', 'takedowns']).default('flags'),
        status: z.string().default('pending'),
        limit: z.number().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      if (input.type === 'takedowns') {
        const col = takedownCol();
        if (!col) return [];
        const snap = await col
          .where('status', '==', input.status)
          .orderBy('createdAt', 'desc')
          .limit(input.limit)
          .get();
        return snap.docs.map((d) => ({ id: d.id, type: 'takedown', ...d.data() }));
      }

      const col = flagsCol();
      if (!col) return [];
      const snap = await col
        .where('status', '==', input.status)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      return snap.docs.map((d) => ({ id: d.id, type: 'flag', ...d.data() }));
    }),

  // ── Admin: update content status ──────────────────────────────
  updateContentStatus: adminProcedure
    .input(
      z.object({
        contentId: z.string(),
        newStatus: z.enum(['active', 'flagged', 'under_review', 'hidden', 'removed', 'reinstated']),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const cCol = contentCol();
      if (cCol) {
        await cCol.doc(input.contentId).update({
          contentStatus: input.newStatus,
          contentStatusUpdatedAt: now.toISOString(),
          contentStatusUpdatedBy: ctx.user.uid.toLowerCase(),
        });
      }

      // Immutable audit log
      const aCol = auditCol();
      if (aCol) {
        await aCol.add({
          contentId: input.contentId,
          action: `status_change_to_${input.newStatus}`,
          adminUid: ctx.user.uid.toLowerCase(),
          reason: input.reason || null,
          createdAt: now.toISOString(),
        });
      }

      // Mark related flags as reviewed
      const fCol = flagsCol();
      if (fCol) {
        const flags = await fCol
          .where('contentId', '==', input.contentId)
          .where('status', '==', 'pending')
          .get();
        const batch = db.batch();
        flags.docs.forEach((doc) => batch.update(doc.ref, { status: 'reviewed' }));
        await batch.commit();
      }

      return { ok: true, newStatus: input.newStatus };
    }),

  // ── Admin: resolve takedown ───────────────────────────────────
  resolveTakedown: adminProcedure
    .input(
      z.object({
        takedownId: z.string(),
        action: z.enum(['actioned', 'rejected']),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const col = takedownCol();
      if (!col) throw new Error('Not available');

      await col.doc(input.takedownId).update({
        status: input.action,
        resolvedBy: ctx.user.uid.toLowerCase(),
        resolvedAt: new Date().toISOString(),
        resolveReason: input.reason || null,
      });

      // Audit log
      const aCol = auditCol();
      if (aCol) {
        await aCol.add({
          takedownId: input.takedownId,
          action: `takedown_${input.action}`,
          adminUid: ctx.user.uid.toLowerCase(),
          reason: input.reason || null,
          createdAt: new Date().toISOString(),
        });
      }

      return { ok: true };
    }),

  // ── Admin: audit log ──────────────────────────────────────────
  auditLog: adminProcedure
    .input(
      z.object({
        contentId: z.string().optional(),
        limit: z.number().min(1).max(200).default(100),
      })
    )
    .query(async ({ input }) => {
      const col = auditCol();
      if (!col) return [];

      let query = col.orderBy('createdAt', 'desc').limit(input.limit);
      if (input.contentId) query = query.where('contentId', '==', input.contentId);

      const snap = await query.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }),
});
