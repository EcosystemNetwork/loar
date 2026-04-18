/**
 * Quest Auto-Tracker
 *
 * Fires quest progress updates after server-side actions.
 * Non-blocking — failures are logged but don't affect the main operation.
 */
import { db } from '../lib/firebase';

const questProgressCol = () => {
  if (!db) throw new Error('Firebase is not configured');
  return db.collection('questProgress');
};

/**
 * Increment quest progress for a user. Fire-and-forget.
 */
export function trackQuest(userId: string, questId: string, increment = 1): void {
  const docId = `${userId}_${questId}`;
  const ref = questProgressCol().doc(docId);

  ref
    .get()
    .then((doc) => {
      const currentCount = doc.exists ? doc.data()?.currentCount || 0 : 0;
      const newCount = currentCount + increment;

      return ref.set(
        {
          userId,
          questId,
          currentCount: newCount,
          updatedAt: new Date(),
          ...(doc.exists ? {} : { createdAt: new Date() }),
        },
        { merge: true }
      );
    })
    .catch((err) => {
      console.error(`Quest tracking failed for ${questId}:`, err);
    });
}

/**
 * Track multiple quests at once.
 */
export function trackQuests(
  userId: string,
  quests: { questId: string; increment?: number }[]
): void {
  for (const q of quests) {
    trackQuest(userId, q.questId, q.increment ?? 1);
  }
}

/**
 * Track unique model usage for the "try_5_models" quest.
 * Stores which models the user has tried in a separate doc.
 */
export async function trackModelUsage(userId: string, modelId: string): Promise<void> {
  try {
    const ref = db.collection('userModelUsage').doc(userId);
    const doc = await ref.get();
    const usedModels: string[] = doc.exists ? doc.data()?.models || [] : [];

    if (!usedModels.includes(modelId)) {
      usedModels.push(modelId);
      await ref.set({ models: usedModels, updatedAt: new Date() }, { merge: true });

      // Update quest progress with total unique models
      await questProgressCol()
        .doc(`${userId}_try_5_models`)
        .set(
          {
            userId,
            questId: 'try_5_models',
            currentCount: usedModels.length,
            completedAt: usedModels.length >= 5 ? new Date() : null,
            updatedAt: new Date(),
          },
          { merge: true }
        );
    }
  } catch (err) {
    console.error('Model usage tracking failed:', err);
  }
}
