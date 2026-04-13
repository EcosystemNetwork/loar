/**
 * Universe Team Router — manage team membership for a universe
 *
 * The universe admin can add/remove team members. Team members can
 * spend from the universe's shared credit pool (funded from the
 * universe treasury) instead of their personal credit balance.
 *
 * Firestore collections:
 *   universeTeamMembers/{universeId}-{memberUid}
 */
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { z } from 'zod';
import { isUniverseAdmin } from '../../lib/safe-admin';

const teamCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('universeTeamMembers');
};

const roleEnum = z.enum(['admin', 'contributor', 'moderator']);

/** Returns the membership doc for a given universe + uid, or null */
async function getMembership(universeId: string, uid: string) {
  const docId = `${universeId.toLowerCase()}-${uid.toLowerCase()}`;
  const doc = await teamCol().doc(docId).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

// ── Router ────────────────────────────────────────────────────────────────

export const universeTeamRouter = router({
  // ── Add member (admin only) ───────────────────────────────────────

  addMember: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        memberUid: z.string(), // wallet address / uid of the member to add
        role: roleEnum.default('contributor'),
        /** Max credits they can draw from the universe pool per month (0 = unlimited) */
        monthlyAllowance: z.number().min(0).default(0),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!(await isUniverseAdmin(input.universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can manage team members');
      }

      const docId = `${input.universeId.toLowerCase()}-${input.memberUid.toLowerCase()}`;
      const now = new Date();

      await teamCol().doc(docId).set(
        {
          universeId: input.universeId.toLowerCase(),
          memberUid: input.memberUid.toLowerCase(),
          role: input.role,
          monthlyAllowance: input.monthlyAllowance,
          creditsUsedThisMonth: 0,
          allowancePeriodStart: now,
          status: 'active',
          addedBy: ctx.user.uid.toLowerCase(),
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      return { ok: true, docId };
    }),

  // ── Remove member (admin only) ────────────────────────────────────

  removeMember: protectedProcedure
    .input(z.object({ universeId: z.string(), memberUid: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (!(await isUniverseAdmin(input.universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can manage team members');
      }

      const docId = `${input.universeId.toLowerCase()}-${input.memberUid.toLowerCase()}`;
      await teamCol().doc(docId).update({
        status: 'removed',
        updatedAt: new Date(),
        creditsUsedThisMonth: 0,
        allowancePeriodStart: null,
      });

      return { ok: true };
    }),

  // ── Update member role / allowance (admin only) ───────────────────

  updateMember: protectedProcedure
    .input(
      z.object({
        universeId: z.string(),
        memberUid: z.string(),
        role: roleEnum.optional(),
        monthlyAllowance: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      if (!(await isUniverseAdmin(input.universeId, ctx.user.uid))) {
        throw new Error('Only the universe admin can manage team members');
      }

      const docId = `${input.universeId.toLowerCase()}-${input.memberUid.toLowerCase()}`;
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.role !== undefined) updates.role = input.role;
      if (input.monthlyAllowance !== undefined) updates.monthlyAllowance = input.monthlyAllowance;

      await teamCol().doc(docId).update(updates);
      return { ok: true };
    }),

  // ── List team members for a universe ─────────────────────────────

  getMembers: publicProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input }) => {
      const snapshot = await teamCol()
        .where('universeId', '==', input.universeId.toLowerCase())
        .where('status', '==', 'active')
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Record<string, unknown>),
      }));
    }),

  // ── Get universes where the caller is a team member ───────────────

  getMyUniverses: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await teamCol()
      .where('memberUid', '==', ctx.user.uid.toLowerCase())
      .where('status', '==', 'active')
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Record<string, unknown>),
    }));
  }),

  // ── Check if caller is an active member of a universe ────────────

  isMember: protectedProcedure
    .input(z.object({ universeId: z.string() }))
    .query(async ({ input, ctx }) => {
      const membership = await getMembership(input.universeId, ctx.user.uid);
      const active = !!(membership && (membership as any).status === 'active');
      return { isMember: active, membership: active ? membership : null };
    }),
});

export { getMembership };
