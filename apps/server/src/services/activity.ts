/**
 * Activity Event Service
 *
 * Shared service for emitting activity events and notifications.
 * Called by all routers after key user actions. Powers the activity feed
 * and notification system.
 */
import { db } from '../lib/firebase';

export type ActivityEventType =
  | 'created_universe'
  | 'created_content'
  | 'created_character'
  | 'created_entity'
  | 'minted_nft'
  | 'voted_proposal'
  | 'created_proposal'
  | 'executed_proposal'
  | 'followed_user'
  | 'purchased_credits'
  | 'subscribed_universe'
  | 'submitted_canon'
  | 'canon_accepted'
  | 'collab_started'
  | 'listed_item'
  | 'sold_item';

export type NotificationType =
  | 'new_follower'
  | 'proposal_vote'
  | 'canon_accepted'
  | 'canon_rejected'
  | 'content_in_universe'
  | 'item_sold'
  | 'subscription_new'
  | 'mention';

interface EmitActivityParams {
  actorUid: string;
  actorAddress?: string;
  actorDisplayName?: string;
  eventType: ActivityEventType;
  targetType?: string;
  targetId?: string;
  targetTitle?: string;
  metadata?: Record<string, string>;
}

interface SendNotificationParams {
  recipientUid: string;
  type: NotificationType;
  actorUid: string;
  actorDisplayName?: string;
  actorAvatarUrl?: string;
  message: string;
  targetType?: string;
  targetId?: string;
}

const activityCol = () => {
  if (!db) return null;
  return db.collection('activityEvents');
};

const notificationsCol = () => {
  if (!db) return null;
  return db.collection('notifications');
};

/**
 * Emit an activity event. Fire-and-forget — failures are logged but don't throw.
 */
export async function emitActivity(params: EmitActivityParams): Promise<void> {
  const col = activityCol();
  if (!col) return;

  try {
    await col.add({
      ...params,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('Failed to emit activity event:', err);
  }
}

/**
 * Send a notification to a user. Fire-and-forget.
 */
export async function sendNotification(params: SendNotificationParams): Promise<void> {
  const col = notificationsCol();
  if (!col) return;

  try {
    await col.add({
      ...params,
      read: false,
      createdAt: new Date(),
    });
  } catch (err) {
    console.error('Failed to send notification:', err);
  }
}
