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
