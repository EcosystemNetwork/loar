/**
 * Notification Dispatcher
 *
 * Unified notification delivery across all channels: in-app (Firestore),
 * push (FCM), and email (Resend). Extends the existing activity.ts pattern
 * by checking user preferences and dispatching to enabled channels.
 *
 * Fire-and-forget — logs errors but never throws.
 */
import { db } from '../lib/firebase';
import { sendPushToUser } from './push-notifications';
import { sendEmail } from './email-notifications';

export type NotificationChannel = 'in_app' | 'push' | 'email';

export interface NotificationPreferences {
  push: boolean;
  email: boolean;
  channels: Record<string, NotificationChannel[]>; // per-event-type channel overrides
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  push: true,
  email: false,
  channels: {},
};

interface DispatchParams {
  recipientUid: string;
  type: string;
  title: string;
  body: string;
  actorUid: string;
  actorDisplayName?: string;
  targetType?: string;
  targetId?: string;
  url?: string;
}

const notificationsCol = () => {
  if (!db) return null;
  return db.collection('notifications');
};

const preferencesCol = () => {
  if (!db) return null;
  return db.collection('notificationPreferences');
};

const usersCol = () => {
  if (!db) return null;
  return db.collection('users');
};

/**
 * Load notification preferences for a user.
 * Falls back to defaults if no preferences are stored.
 */
async function getPreferences(uid: string): Promise<NotificationPreferences> {
  const col = preferencesCol();
  if (!col) return DEFAULT_PREFERENCES;

  try {
    const doc = await col.doc(uid).get();
    if (!doc.exists) return DEFAULT_PREFERENCES;
    const data = doc.data()!;
    return {
      push: data.push ?? DEFAULT_PREFERENCES.push,
      email: data.email ?? DEFAULT_PREFERENCES.email,
      channels: data.channels ?? DEFAULT_PREFERENCES.channels,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Determine which channels are enabled for a given notification type.
 */
function resolveChannels(prefs: NotificationPreferences, type: string): Set<NotificationChannel> {
  // Per-type overrides take precedence
  const perType = prefs.channels[type];
  if (perType && perType.length > 0) {
    return new Set(perType);
  }

  // Fall back to global toggles
  const channels = new Set<NotificationChannel>(['in_app'] as NotificationChannel[]);
  if (prefs.push) channels.add('push');
  if (prefs.email) channels.add('email');
  return channels;
}

/**
 * Dispatch a notification across all enabled channels for the recipient.
 *
 * 1. Always writes to Firestore `notifications` collection (in-app).
 * 2. Checks user preferences from `notificationPreferences` collection.
 * 3. If push enabled: sends FCM via sendPushToUser.
 * 4. If email enabled: looks up email from `users` collection, sends via Resend.
 *
 * Fire-and-forget — logs errors but never throws.
 */
export async function dispatchNotification(params: DispatchParams): Promise<void> {
  const { recipientUid, type, title, body, actorUid, actorDisplayName, targetType, targetId, url } =
    params;

  // 1. Always write in-app notification
  const col = notificationsCol();
  if (col) {
    try {
      await col.add({
        recipientUid,
        type,
        message: body,
        actorUid,
        actorDisplayName,
        targetType,
        targetId,
        url,
        read: false,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error('[dispatcher] Failed to write in-app notification:', err);
    }
  }

  // 2. Load user preferences
  let prefs: NotificationPreferences;
  try {
    prefs = await getPreferences(recipientUid);
  } catch {
    prefs = DEFAULT_PREFERENCES;
  }

  const channels = resolveChannels(prefs, type);

  // 3. Push notification
  if (channels.has('push')) {
    try {
      await sendPushToUser(recipientUid, {
        title,
        body,
        url,
        data: {
          type,
          ...(targetType ? { targetType } : {}),
          ...(targetId ? { targetId } : {}),
        },
      });
    } catch (err) {
      console.error('[dispatcher] Push notification failed:', err);
    }
  }

  // 4. Email notification
  if (channels.has('email')) {
    try {
      const uCol = usersCol();
      if (uCol) {
        const userDoc = await uCol.doc(recipientUid).get();
        const email = userDoc.data()?.email;
        if (email) {
          await sendEmail({
            to: email,
            subject: title,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #1a1a1a;">${title}</h2>
                <p style="color: #444; font-size: 16px; line-height: 1.5;">${body}</p>
                ${
                  url
                    ? `<p><a href="${url}" style="display: inline-block; padding: 12px 24px; background: #6366f1; color: white; text-decoration: none; border-radius: 6px;">View on LOAR</a></p>`
                    : ''
                }
                <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
                <p style="color: #999; font-size: 12px;">You received this because you have email notifications enabled on <a href="https://loar.fun" style="color: #6366f1;">loar.fun</a>.</p>
              </div>
            `,
            text: `${title}\n\n${body}${url ? `\n\nView: ${url}` : ''}`,
          });
        }
      }
    } catch (err) {
      console.error('[dispatcher] Email notification failed:', err);
    }
  }
}
