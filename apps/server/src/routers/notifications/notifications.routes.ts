/**
 * Notifications Router
 *
 * Manages FCM device tokens and notification preferences.
 * Device registration enables push notifications via Firebase Cloud Messaging.
 * Preferences control which channels (in-app, push, email) are active
 * per notification type.
 */
import { z } from 'zod';
import { protectedProcedure, router } from '../../lib/trpc';
import { db } from '../../lib/firebase';
import { sendPushToUser } from '../../services/push-notifications';

const fcmTokensCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('fcmTokens');
};

const preferencesCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('notificationPreferences');
};

export const notificationsRouter = router({
  /**
   * Register a device FCM token for push notifications.
   * Upserts — if the token already exists for this user, updates the metadata.
   */
  registerDevice: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1),
        platform: z.enum(['web', 'ios', 'android']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.uid;
      const docId = `${userId}_${input.token.slice(-16)}`;

      await fcmTokensCol().doc(docId).set(
        {
          userId,
          token: input.token,
          platform: input.platform,
          updatedAt: new Date(),
        },
        { merge: true }
      );

      return { ok: true };
    }),

  /**
   * Unregister a device FCM token (e.g. on logout or permission revoke).
   */
  unregisterDevice: protectedProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.uid;

      const snapshot = await fcmTokensCol()
        .where('userId', '==', userId)
        .where('token', '==', input.token)
        .get();

      if (!snapshot.empty) {
        const batch = db!.batch();
        snapshot.docs.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      return { ok: true };
    }),

  /**
   * Get the user's notification preferences.
   * Returns defaults if no preferences have been saved yet.
   */
  getPreferences: protectedProcedure.query(async ({ ctx }) => {
    const doc = await preferencesCol().doc(ctx.user.uid).get();

    if (!doc.exists) {
      return {
        push: true,
        email: false,
        channels: {} as Record<string, string[]>,
      };
    }

    const data = doc.data()!;
    return {
      push: data.push ?? true,
      email: data.email ?? false,
      channels: (data.channels ?? {}) as Record<string, string[]>,
    };
  }),

  /**
   * Update notification preferences.
   * Supports partial updates — only provided fields are changed.
   */
  updatePreferences: protectedProcedure
    .input(
      z.object({
        push: z.boolean().optional(),
        email: z.boolean().optional(),
        channels: z.record(z.string(), z.array(z.string())).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.push !== undefined) update.push = input.push;
      if (input.email !== undefined) update.email = input.email;
      if (input.channels !== undefined) update.channels = input.channels;

      await preferencesCol().doc(ctx.user.uid).set(update, { merge: true });

      return { ok: true };
    }),

  /**
   * Send a test push notification to the current user.
   * Useful for verifying device registration and FCM setup.
   */
  testPush: protectedProcedure.mutation(async ({ ctx }) => {
    await sendPushToUser(ctx.user.uid, {
      title: 'LOAR Test Notification',
      body: 'Push notifications are working! You will receive alerts for activity on your content.',
      url: 'https://loar.fun/dashboard',
    });

    return { ok: true };
  }),
});
