/**
 * Social Router
 *
 * Follows, activity feed, and notifications. The social layer that
 * connects creators and audiences on the platform.
 */
import { z } from 'zod';
import { protectedProcedure, publicProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { FieldValue } from 'firebase-admin/firestore';
import { emitActivity, sendNotification } from '../../services/activity';

const followsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('follows');
};

const activityCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('activityEvents');
};

const notificationsCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('notifications');
};

const profilesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('profiles');
};

export const socialRouter = router({
  // ── Follows ──────────────────────────────────────────────────────────

  /** Follow a user */
  follow: protectedProcedure
    .input(z.object({ targetUid: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const followerUid = ctx.user.uid;
      const { targetUid } = input;
      if (followerUid === targetUid) return { ok: false, error: 'Cannot follow yourself' };

      const docId = `${followerUid}_${targetUid}`;

      // Use transaction to prevent race conditions on follow counts
      const alreadyFollowing = await db!.runTransaction(async (tx) => {
        const followDoc = await tx.get(followsCol().doc(docId));
        if (followDoc.exists) return true;

        tx.set(followsCol().doc(docId), {
          followerUid,
          followedUid: targetUid,
          followerAddress: ctx.user.address?.toLowerCase(),
          createdAt: new Date(),
        });
        tx.update(profilesCol().doc(followerUid), {
          following: FieldValue.increment(1),
        });
        tx.update(profilesCol().doc(targetUid), {
          followers: FieldValue.increment(1),
        });
        return false;
      });

      if (alreadyFollowing) return { ok: true, alreadyFollowing: true };

      // Emit activity + notification (fire-and-forget)
      const profile = await profilesCol().doc(followerUid).get();
      const displayName = profile.data()?.displayName || followerUid;

      emitActivity({
        actorUid: followerUid,
        actorAddress: ctx.user.address,
        actorDisplayName: displayName,
        eventType: 'followed_user',
        targetType: 'user',
        targetId: targetUid,
      });

      sendNotification({
        recipientUid: targetUid,
        type: 'new_follower',
        actorUid: followerUid,
        actorDisplayName: displayName,
        actorAvatarUrl: profile.data()?.avatarUrl,
        message: `${displayName} started following you`,
        targetType: 'user',
        targetId: followerUid,
      });

      return { ok: true };
    }),

  /** Unfollow a user */
  unfollow: protectedProcedure
    .input(z.object({ targetUid: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const docId = `${ctx.user.uid}_${input.targetUid}`;

      // Use transaction to prevent race conditions
      await db!.runTransaction(async (tx) => {
        const followDoc = await tx.get(followsCol().doc(docId));
        if (!followDoc.exists) return;

        tx.delete(followsCol().doc(docId));
        tx.update(profilesCol().doc(ctx.user.uid), {
          following: FieldValue.increment(-1),
        });
        tx.update(profilesCol().doc(input.targetUid), {
          followers: FieldValue.increment(-1),
        });
      });

      return { ok: true };
    }),

  /** Check if current user follows a target */
  isFollowing: protectedProcedure
    .input(z.object({ targetUid: z.string() }))
    .query(async ({ ctx, input }) => {
      const docId = `${ctx.user.uid}_${input.targetUid}`;
      const doc = await followsCol().doc(docId).get();
      return { following: doc.exists };
    }),

  /** Get paginated followers list */
  getFollowers: publicProcedure
    .input(
      z.object({
        uid: z.string(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = followsCol()
        .where('followedUid', '==', input.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.cursor) {
        const cursorDoc = await followsCol().doc(input.cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      return {
        followers: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  /** Get paginated following list */
  getFollowing: publicProcedure
    .input(
      z.object({
        uid: z.string(),
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = followsCol()
        .where('followerUid', '==', input.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.cursor) {
        const cursorDoc = await followsCol().doc(input.cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      return {
        following: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  // ── Activity Feed ────────────────────────────────────────────────────

  /** Get personalized activity feed from followed users */
  getActivityFeed: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Get who the user follows
      const followingSnap = await followsCol()
        .where('followerUid', '==', ctx.user.uid)
        .select('followedUid')
        .get();

      const followedUids = followingSnap.docs.map((d) => d.data().followedUid as string);
      if (followedUids.length === 0) return { events: [], nextCursor: undefined };

      // Firestore `in` queries cap at 30 — batch if needed
      const batches: string[][] = [];
      for (let i = 0; i < followedUids.length; i += 30) {
        batches.push(followedUids.slice(i, i + 30));
      }

      const allEvents: any[] = [];
      for (const batch of batches) {
        let query = activityCol()
          .where('actorUid', 'in', batch)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);

        if (input.cursor) {
          const cursorDoc = await activityCol().doc(input.cursor).get();
          if (cursorDoc.exists) query = query.startAfter(cursorDoc);
        }

        const snap = await query.get();
        allEvents.push(...snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      }

      // Sort merged results by createdAt desc and take limit
      allEvents.sort((a, b) => {
        const aTime = a.createdAt?.toDate?.() || new Date(a.createdAt);
        const bTime = b.createdAt?.toDate?.() || new Date(b.createdAt);
        return bTime.getTime() - aTime.getTime();
      });
      const events = allEvents.slice(0, input.limit);

      return {
        events,
        nextCursor: events.length === input.limit ? events[events.length - 1]?.id : undefined,
      };
    }),

  /** Get global activity feed (all users) */
  getGlobalFeed: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      let query = activityCol().orderBy('createdAt', 'desc').limit(input.limit);

      if (input.cursor) {
        const cursorDoc = await activityCol().doc(input.cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      return {
        events: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  // ── Notifications ────────────────────────────────────────────────────

  /** Get user's notifications */
  getNotifications: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
        unreadOnly: z.boolean().default(false),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      let query = notificationsCol()
        .where('recipientUid', '==', ctx.user.uid)
        .orderBy('createdAt', 'desc')
        .limit(input.limit);

      if (input.unreadOnly) {
        query = notificationsCol()
          .where('recipientUid', '==', ctx.user.uid)
          .where('read', '==', false)
          .orderBy('createdAt', 'desc')
          .limit(input.limit);
      }

      if (input.cursor) {
        const cursorDoc = await notificationsCol().doc(input.cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snapshot = await query.get();
      return {
        notifications: snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
        nextCursor:
          snapshot.docs.length === input.limit
            ? snapshot.docs[snapshot.docs.length - 1]?.id
            : undefined,
      };
    }),

  /** Mark notification(s) as read */
  markRead: protectedProcedure
    .input(
      z.object({
        notificationId: z.string().optional(),
        all: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.all) {
        const unread = await notificationsCol()
          .where('recipientUid', '==', ctx.user.uid)
          .where('read', '==', false)
          .get();

        const batch = db!.batch();
        unread.docs.forEach((doc) => batch.update(doc.ref, { read: true }));
        await batch.commit();
      } else if (input.notificationId) {
        await notificationsCol().doc(input.notificationId).update({ read: true });
      }
      return { ok: true };
    }),

  /** Get unread notification count */
  getUnreadCount: protectedProcedure.query(async ({ ctx }) => {
    const snapshot = await notificationsCol()
      .where('recipientUid', '==', ctx.user.uid)
      .where('read', '==', false)
      .count()
      .get();

    return { count: snapshot.data().count };
  }),
});
