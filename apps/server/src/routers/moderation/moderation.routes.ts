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
import { consumeRateLimit } from '../../middleware/rate-limit';

// Max 3 takedown requests per email per hour. Backed by Redis in prod so the
// limit survives process restarts and applies across replicas (Railway can
// scale the server horizontally).
async function checkTakedownRateLimit(email: string): Promise<void> {
  const { blocked } = await consumeRateLimit(`takedown:email:${email}`, 60 * 60 * 1000, 3);
  if (blocked) {
    throw new Error('Rate limit exceeded: max 3 takedown requests per hour');
  }
}

const flagsCol = () => (firebaseAvailable ? db.collection('flags') : null);
const takedownCol = () => (firebaseAvailable ? db.collection('takedownRequests') : null);
const auditCol = () => (firebaseAvailable ? db.collection('contentAuditLog') : null);
const contentCol = () => (firebaseAvailable ? db.collection('content') : null);

type ContentPreview = {
  id: string;
  title: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  mediaType: string | null;
  contentStatus: string;
  creatorUid: string | null;
};

/**
 * Batch-fetch content previews for the moderation review queue.
 * Admins must see hidden/removed content to verify flags, so this bypasses
 * the public status filter used by `content.get`.
 */
async function fetchContentPreviews(contentIds: string[]): Promise<Record<string, ContentPreview>> {
  const col = contentCol();
  if (!col || contentIds.length === 0) return {};
  const unique = Array.from(new Set(contentIds));
  const refs = unique.map((id) => col.doc(id));
  const snaps = await db.getAll(...refs);
  const out: Record<string, ContentPreview> = {};
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const data = snap.data()!;
    out[snap.id] = {
      id: snap.id,
      title: data.title ?? null,
      mediaUrl: data.mediaUrl ?? null,
      thumbnailUrl: data.thumbnailUrl ?? null,
      mediaType: data.mediaType ?? null,
      contentStatus: data.contentStatus ?? 'active',
      creatorUid: data.creatorUid ?? null,
    };
  }
  return out;
}

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

      // Count flags for informational purposes only.
      // Status escalation is admin-triggered only to prevent abuse.
      const allFlags = await col.where('contentId', '==', input.contentId).get();

      return { id: ref.id, flagCount: allFlags.size };
    }),

  // ── Submit DMCA takedown (public, no auth required) ───────────
  // Schema enforces 17 U.S.C. § 512(c)(3)(A) statutory elements:
  //   (i)   electronic signature          → signature
  //   (ii)  identification of work        → copyrightWork
  //   (iii) identification of material    → contentId
  //   (iv)  contact info                  → claimantName/Email/Address/Phone
  //   (v)   good-faith belief             → goodFaith
  //   (vi)  accuracy under perjury +      → swornStatement
  //         authority to act
  submitTakedown: publicProcedure
    .input(
      z.object({
        contentId: z.string(),
        claimantName: z.string().min(1),
        claimantEmail: z.string().email(),
        claimantAddress: z.string().min(10).max(500), // § 512(c)(3)(A)(iv)
        claimantPhone: z.string().min(7).max(30), // § 512(c)(3)(A)(iv)
        copyrightWork: z.string().min(10),
        explanation: z.string().min(20),
        goodFaith: z.literal(true), // § 512(c)(3)(A)(v)
        swornStatement: z.literal(true), // § 512(c)(3)(A)(vi) — perjury + authority
        signature: z.string().min(2).max(200), // § 512(c)(3)(A)(i) — typed name as e-signature
      })
    )
    .mutation(async ({ input }) => {
      const col = takedownCol();
      if (!col) throw new Error('Not available');

      // Rate limit: max 3 takedown requests per email per hour
      await checkTakedownRateLimit(input.claimantEmail.toLowerCase());

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
        claimantAddress: input.claimantAddress,
        claimantPhone: input.claimantPhone,
        copyrightWork: input.copyrightWork,
        explanation: input.explanation,
        signature: input.signature,
        goodFaithAttested: true,
        swornAttested: true,
        status: 'pending', // pending | actioned | rejected
        createdAt: now.toISOString(),
      };

      const ref = await col.add(request);

      // Do NOT auto-flag content on takedown submission.
      // Content status changes are admin-triggered only after review,
      // to prevent abuse of the DMCA process for censorship.

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
        const takedowns = snap.docs.map((d) => ({ id: d.id, type: 'takedown', ...d.data() }));
        const previews = await fetchContentPreviews(
          takedowns.map((t: any) => t.contentId).filter(Boolean)
        );
        return takedowns.map((t: any) => ({
          ...t,
          contentPreview: t.contentId ? (previews[t.contentId] ?? null) : null,
        }));
      }

      const col = flagsCol();
      if (!col) return [];
      const snap = await col
        .where('status', '==', input.status)
        .orderBy('createdAt', 'desc')
        .limit(input.limit)
        .get();
      const flags = snap.docs.map((d) => ({ id: d.id, type: 'flag', ...d.data() }));
      const previews = await fetchContentPreviews(
        flags.map((f: any) => f.contentId).filter(Boolean)
      );
      return flags.map((f: any) => ({
        ...f,
        contentPreview: f.contentId ? (previews[f.contentId] ?? null) : null,
      }));
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

      // PostHog: admin moderation audit trail.
      void import('../../lib/analytics').then(({ captureServerEvent }) =>
        captureServerEvent('moderation:content_status_changed', {
          distinctId: ctx.user.uid,
          contentId: input.contentId,
          newStatus: input.newStatus,
          hasReason: Boolean(input.reason),
        })
      );

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

      void import('../../lib/analytics').then(({ captureServerEvent }) =>
        captureServerEvent('moderation:takedown_resolved', {
          distinctId: ctx.user.uid,
          takedownId: input.takedownId,
          action: input.action,
        })
      );

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
