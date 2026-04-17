/**
 * Collaboration Router — Real-time collaborative editing of universe entities.
 *
 * Manages editing sessions, field-level locking, presence tracking,
 * and atomic field updates with audit trail.
 *
 * Capabilities:
 *   collaboration.joinSession    — Register as active editor
 *   collaboration.leaveSession   — Remove presence
 *   collaboration.heartbeat      — Keep session alive
 *   collaboration.updateField    — Atomic field-level update with audit
 *   collaboration.lockField      — Claim a field for editing
 *   collaboration.unlockField    — Release a field lock
 *   collaboration.getSession     — Get current session state (editors, locks)
 *   collaboration.getEditHistory — View field change history
 */
import { router, protectedProcedure, requirePermission } from '../../lib/trpc';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { db } from '../../lib/firebase';
import { getEntity, updateEntity } from '../entities/entities.handlers';
import { FieldValue } from 'firebase-admin/firestore';

// ── Collections ──────────────────────────────────────────────────────

const editSessionsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('editSessions');
};

const fieldLocksCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('fieldLocks');
};

const editHistoryCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('entityEditHistory');
};

// ── Helpers ──────────────────────────────────────────────────────────

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes without heartbeat = stale
const LOCK_TTL_MS = 60 * 1000; // 60 seconds lock expiry

/** Clean up stale sessions and locks for an entity. */
async function cleanupStaleSessions(entityId: string) {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);

  // Remove stale sessions
  const staleSessions = await editSessionsCol()
    .where('entityId', '==', entityId)
    .where('lastActive', '<', cutoff)
    .get();

  const batch = db.batch();
  staleSessions.docs.forEach((doc) => batch.delete(doc.ref));

  // Clean up expired locks
  const lockDoc = await fieldLocksCol().doc(entityId).get();
  if (lockDoc.exists) {
    const locks = lockDoc.data() || {};
    const lockCutoff = Date.now() - LOCK_TTL_MS;
    const updates: Record<string, any> = {};
    let hasExpired = false;

    for (const [field, lock] of Object.entries(locks)) {
      if (field === '_entityId') continue;
      const lockData = lock as { lockedAt: { toMillis?: () => number; getTime?: () => number } };
      const lockedAtMs = lockData.lockedAt?.toMillis?.() || lockData.lockedAt?.getTime?.() || 0;
      if (lockedAtMs < lockCutoff) {
        updates[field] = FieldValue.delete();
        hasExpired = true;
      }
    }

    if (hasExpired) {
      batch.update(fieldLocksCol().doc(entityId), updates);
    }
  }

  await batch.commit();
}

/** Verify user can edit this entity (creator or universe team member). */
async function assertCanEdit(entityId: string, userId: string, userAddress?: string) {
  const entity = await getEntity(entityId);
  if (!entity) throw new Error('Entity not found');

  // Creator can always edit
  if (entity.creator?.toLowerCase() === userAddress?.toLowerCase()) return entity;

  // Check universe team membership
  if (entity.universeAddress) {
    const teamDoc = await db
      .collection('universeTeamMembers')
      .where('universeAddress', '==', entity.universeAddress.toLowerCase())
      .where('memberAddress', '==', (userAddress || '').toLowerCase())
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (!teamDoc.empty) return entity;
  }

  throw new Error('Not authorized to edit this entity');
}

// ── Router ───────────────────────────────────────────────────────────

export const collaborationRouter = router({
  // ── Join session ─────────────────────────────────────────────────────
  joinSession: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        displayName: z.string().max(100).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanEdit(input.entityId, ctx.user.uid, ctx.user.address);
      await cleanupStaleSessions(input.entityId);

      const sessionId = randomUUID();
      const now = new Date();

      await editSessionsCol()
        .doc(sessionId)
        .set({
          sessionId,
          entityId: input.entityId,
          userId: ctx.user.uid,
          walletAddress: ctx.user.address || null,
          displayName: input.displayName || ctx.user.address?.slice(0, 10) || 'Anonymous',
          activeField: null,
          lastActive: now,
          connectedAt: now,
          status: 'active',
        });

      return { sessionId };
    }),

  // ── Leave session ────────────────────────────────────────────────────
  leaveSession: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const doc = await editSessionsCol().doc(input.sessionId).get();
      if (!doc.exists) return { ok: true };
      if (doc.data()?.userId !== ctx.user.uid) throw new Error('Not your session');

      // Release any field locks held by this session
      const entityId = doc.data()?.entityId;
      if (entityId) {
        const lockDoc = await fieldLocksCol().doc(entityId).get();
        if (lockDoc.exists) {
          const locks = lockDoc.data() || {};
          const updates: Record<string, any> = {};
          for (const [field, lock] of Object.entries(locks)) {
            if (field === '_entityId') continue;
            if ((lock as any).sessionId === input.sessionId) {
              updates[field] = FieldValue.delete();
            }
          }
          if (Object.keys(updates).length > 0) {
            await fieldLocksCol().doc(entityId).update(updates);
          }
        }
      }

      await editSessionsCol().doc(input.sessionId).delete();
      return { ok: true };
    }),

  // ── Heartbeat ────────────────────────────────────────────────────────
  heartbeat: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        activeField: z.string().nullish(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const doc = await editSessionsCol().doc(input.sessionId).get();
      if (!doc.exists) throw new Error('Session not found');
      if (doc.data()?.userId !== ctx.user.uid) throw new Error('Not your session');

      await editSessionsCol()
        .doc(input.sessionId)
        .update({
          lastActive: new Date(),
          activeField: input.activeField ?? null,
        });

      return { ok: true };
    }),

  // ── Lock field ───────────────────────────────────────────────────────
  lockField: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        sessionId: z.string(),
        fieldPath: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertCanEdit(input.entityId, ctx.user.uid, ctx.user.address);

      const lockRef = fieldLocksCol().doc(input.entityId);
      const lockDoc = await lockRef.get();
      const locks = lockDoc.exists ? lockDoc.data() || {} : {};

      // Check if field is already locked by someone else
      const existingLock = locks[input.fieldPath];
      if (existingLock) {
        const lockedAtMs =
          existingLock.lockedAt?.toMillis?.() || existingLock.lockedAt?.getTime?.() || 0;
        const isExpired = Date.now() - lockedAtMs > LOCK_TTL_MS;
        if (!isExpired && existingLock.userId !== ctx.user.uid) {
          return {
            ok: false,
            lockedBy: existingLock.displayName || existingLock.walletAddress,
          };
        }
      }

      // Set or update the lock
      const lockData = {
        userId: ctx.user.uid,
        walletAddress: ctx.user.address || null,
        displayName: ctx.user.address?.slice(0, 10) || 'Anonymous',
        sessionId: input.sessionId,
        lockedAt: new Date(),
      };

      if (lockDoc.exists) {
        await lockRef.update({ [input.fieldPath]: lockData, _entityId: input.entityId });
      } else {
        await lockRef.set({ [input.fieldPath]: lockData, _entityId: input.entityId });
      }

      return { ok: true };
    }),

  // ── Unlock field ─────────────────────────────────────────────────────
  unlockField: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        fieldPath: z.string().min(1),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const lockDoc = await fieldLocksCol().doc(input.entityId).get();
      if (!lockDoc.exists) return { ok: true };

      const locks = lockDoc.data() || {};
      const lock = locks[input.fieldPath];
      if (lock && lock.userId === ctx.user.uid) {
        await fieldLocksCol()
          .doc(input.entityId)
          .update({ [input.fieldPath]: FieldValue.delete() });
      }

      return { ok: true };
    }),

  // ── Update field ─────────────────────────────────────────────────────
  updateField: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        sessionId: z.string(),
        fieldPath: z.string().min(1),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const entity = await assertCanEdit(input.entityId, ctx.user.uid, ctx.user.address);

      // Determine if this is a top-level field or metadata field
      const topLevelFields = ['name', 'description', 'imageUrl', 'parentId'];
      const isTopLevel = topLevelFields.includes(input.fieldPath);

      // Record the old value for audit
      let oldValue: any;
      if (isTopLevel) {
        oldValue = (entity as any)[input.fieldPath] ?? null;
      } else {
        oldValue = entity.metadata?.[input.fieldPath] ?? null;
      }

      // Apply update
      if (isTopLevel) {
        await updateEntity(input.entityId, { [input.fieldPath]: input.value });
      } else {
        const existingMetadata = entity.metadata || {};
        await updateEntity(input.entityId, {
          metadata: { ...existingMetadata, [input.fieldPath]: input.value } as Record<
            string,
            string | number | boolean | null
          >,
        });
      }

      // Audit trail
      await editHistoryCol()
        .doc(input.entityId)
        .collection('edits')
        .add({
          userId: ctx.user.uid,
          walletAddress: ctx.user.address || null,
          sessionId: input.sessionId,
          fieldPath: input.fieldPath,
          oldValue,
          newValue: input.value,
          timestamp: new Date(),
        });

      return { ok: true, fieldPath: input.fieldPath };
    }),

  // ── Get session state ────────────────────────────────────────────────
  getSession: protectedProcedure
    .input(z.object({ entityId: z.string().min(1) }))
    .query(async ({ input }) => {
      await cleanupStaleSessions(input.entityId);

      // Active editors
      const sessions = await editSessionsCol()
        .where('entityId', '==', input.entityId)
        .where('status', '==', 'active')
        .get();

      const editors = sessions.docs.map((doc) => ({
        sessionId: doc.data().sessionId,
        userId: doc.data().userId,
        walletAddress: doc.data().walletAddress,
        displayName: doc.data().displayName,
        activeField: doc.data().activeField,
        connectedAt: doc.data().connectedAt?.toDate?.()?.toISOString() || null,
      }));

      // Field locks
      const lockDoc = await fieldLocksCol().doc(input.entityId).get();
      const lockedFields: Record<
        string,
        { userId: string; displayName: string; lockedAt: string }
      > = {};

      if (lockDoc.exists) {
        const locks = lockDoc.data() || {};
        for (const [field, lock] of Object.entries(locks)) {
          if (field === '_entityId') continue;
          const l = lock as any;
          const lockedAtMs = l.lockedAt?.toMillis?.() || l.lockedAt?.getTime?.() || 0;
          if (Date.now() - lockedAtMs < LOCK_TTL_MS) {
            lockedFields[field] = {
              userId: l.userId,
              displayName: l.displayName || l.walletAddress,
              lockedAt: new Date(lockedAtMs).toISOString(),
            };
          }
        }
      }

      return { editors, lockedFields };
    }),

  // ── Edit history ─────────────────────────────────────────────────────
  getEditHistory: protectedProcedure
    .input(
      z.object({
        entityId: z.string().min(1),
        limit: z.number().min(1).max(100).default(30),
      })
    )
    .query(async ({ input }) => {
      const snapshot = await editHistoryCol()
        .doc(input.entityId)
        .collection('edits')
        .orderBy('timestamp', 'desc')
        .limit(input.limit)
        .get();

      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
        timestamp: doc.data().timestamp?.toDate?.()?.toISOString() || null,
      }));
    }),
});
