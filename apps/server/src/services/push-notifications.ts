/**
 * Push Notification Service
 *
 * Firebase Cloud Messaging (FCM) for web push notifications.
 * Sends multicast messages to all registered devices for a user,
 * and automatically cleans up invalid tokens.
 */
import { getMessaging } from 'firebase-admin/messaging';
import { db } from '../lib/firebase';

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string; // click action URL
  data?: Record<string, string>;
}

interface SendResult {
  successCount: number;
  failureCount: number;
  invalidTokens: string[];
}

const fcmTokensCol = () => {
  if (!db) return null;
  return db.collection('fcmTokens');
};

/**
 * Send a push notification to a list of FCM tokens.
 * Returns counts of successes, failures, and any invalid tokens that should be removed.
 */
export async function sendPushNotification(
  fcmTokens: string[],
  payload: PushPayload
): Promise<SendResult> {
  if (fcmTokens.length === 0) {
    return { successCount: 0, failureCount: 0, invalidTokens: [] };
  }

  const messaging = getMessaging();

  const message = {
    tokens: fcmTokens,
    notification: {
      title: payload.title,
      body: payload.body,
      ...(payload.icon ? { imageUrl: payload.icon } : {}),
    },
    webpush: payload.url
      ? {
          fcmOptions: {
            link: payload.url,
          },
        }
      : undefined,
    data: payload.data,
  };

  const response = await messaging.sendEachForMulticast(message);

  const invalidTokens: string[] = [];
  response.responses.forEach((resp, idx) => {
    if (
      !resp.success &&
      resp.error &&
      (resp.error.code === 'messaging/invalid-registration-token' ||
        resp.error.code === 'messaging/registration-token-not-registered')
    ) {
      invalidTokens.push(fcmTokens[idx]);
    }
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
  };
}

/**
 * Send a push notification to all devices registered by a specific user.
 * Looks up FCM tokens from the `fcmTokens` Firestore collection,
 * sends multicast, and cleans up any invalid tokens.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  const col = fcmTokensCol();
  if (!col) return;

  try {
    const snapshot = await col.where('userId', '==', userId).get();

    if (snapshot.empty) return;

    const tokens = snapshot.docs.map((doc) => doc.data().token as string);
    const result = await sendPushNotification(tokens, payload);

    // Clean up invalid tokens
    if (result.invalidTokens.length > 0) {
      const batch = db!.batch();
      for (const invalidToken of result.invalidTokens) {
        const matchingDocs = snapshot.docs.filter((doc) => doc.data().token === invalidToken);
        for (const doc of matchingDocs) {
          batch.delete(doc.ref);
        }
      }
      await batch.commit();
      console.log(
        `[push] Cleaned up ${result.invalidTokens.length} invalid FCM tokens for user ${userId}`
      );
    }
  } catch (err) {
    console.error(`[push] Failed to send push to user ${userId}:`, err);
  }
}
