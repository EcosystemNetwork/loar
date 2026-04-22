import { db } from './firebase';

export type ContentStatus =
  | 'active'
  | 'flagged'
  | 'under_review'
  | 'hidden'
  | 'removed'
  | 'reinstated';

const OPERABLE_STATUSES: ContentStatus[] = ['active', 'reinstated'];

export async function assertContentOperable(contentId: string): Promise<void> {
  const doc = await db.collection('content').doc(contentId).get();
  if (!doc.exists) {
    throw new Error('Content not found');
  }
  const status = doc.data()?.contentStatus as ContentStatus | undefined;
  if (status && !OPERABLE_STATUSES.includes(status)) {
    throw new Error(`Content is not available (status: ${status})`);
  }
}

/**
 * Gate mint / list / license operations on canon for monetized universes.
 *
 * Rule: a monetized universe must have at least one canon episode before any
 * of its content can be commercialized. This stops creators from minting or
 * listing drafts in a universe whose canonical story hasn't been established
 * yet — canon is the publishing commit that turns the universe into IP.
 *
 * Orphan content (no `universeId`) and fun-universe content both pass through
 * untouched.
 */
export async function assertCanonReadyForMonetization(contentId: string): Promise<void> {
  const contentDoc = await db.collection('content').doc(contentId).get();
  if (!contentDoc.exists) return; // upstream check surfaces NOT_FOUND

  const universeId = (contentDoc.data()?.universeId as string | undefined)?.toLowerCase();
  if (!universeId) return; // orphan content has no universe gate to apply

  const universeDoc = await db.collection('cinematicUniverses').doc(universeId).get();
  if (!universeDoc.exists) return;

  const universeType =
    (universeDoc.data()?.universeType as 'fun' | 'monetized' | undefined) ?? 'monetized';
  if (universeType !== 'monetized') return;

  const canonSnap = await db
    .collection('episodes')
    .where('universeId', '==', universeId)
    .where('isCanon', '==', true)
    .limit(1)
    .get();

  if (canonSnap.empty) {
    throw new Error(
      'Monetized universe has no canon episodes yet — publish at least one episode as canon before minting or listing.'
    );
  }
}
