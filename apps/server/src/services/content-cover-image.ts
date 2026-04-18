/**
 * Content Cover Image Service
 *
 * Ensures every `content` document in Firestore ends up with a `thumbnailUrl`
 * so gallery tiles always render a real cover instead of the placeholder.
 *
 * Strategy by mediaType:
 *   - image / ai-image → copy mediaUrl into thumbnailUrl (the asset is its own cover)
 *   - video / ai-video → extract a frame with ffmpeg via StorageManager
 *   - audio / 3d       → no-op (no canonical cover; UI renders a kind-specific tile)
 *
 * Used by:
 *   - routers/content/content.routes.ts:create (fire-and-forget post-insert)
 *   - scripts/generate-missing-thumbnails.ts   (batch backfill)
 */

import { db } from '../lib/firebase';
import { extractVideoThumbnail } from './video-thumbnail';

export type ContentMediaType = 'image' | 'ai-image' | 'video' | 'ai-video' | 'audio' | '3d';

export interface ContentForCover {
  id: string;
  mediaUrl: string;
  mediaType: ContentMediaType;
  existingThumbnailUrl?: string | null;
  creatorUid?: string;
}

export interface EnsureContentThumbnailResult {
  thumbnailUrl: string | null;
  source: 'existing' | 'mediaUrl' | 'extracted' | 'skipped';
}

/**
 * Ensure a content doc has a thumbnailUrl and persist the result to Firestore.
 * Idempotent — returns the existing thumbnail if already set.
 */
export async function ensureContentThumbnail(
  content: ContentForCover
): Promise<EnsureContentThumbnailResult> {
  if (content.existingThumbnailUrl) {
    return { thumbnailUrl: content.existingThumbnailUrl, source: 'existing' };
  }
  if (!db) throw new Error('Firestore not initialized');

  if (content.mediaType === 'image' || content.mediaType === 'ai-image') {
    await db.collection('content').doc(content.id).update({
      thumbnailUrl: content.mediaUrl,
      updatedAt: new Date(),
    });
    return { thumbnailUrl: content.mediaUrl, source: 'mediaUrl' };
  }

  if (content.mediaType === 'video' || content.mediaType === 'ai-video') {
    const url = await extractVideoThumbnail(content.mediaUrl, content.id, {
      uploaderUid: content.creatorUid ?? 'system',
    });
    if (!url) return { thumbnailUrl: null, source: 'skipped' };
    await db.collection('content').doc(content.id).update({
      thumbnailUrl: url,
      updatedAt: new Date(),
    });
    return { thumbnailUrl: url, source: 'extracted' };
  }

  return { thumbnailUrl: null, source: 'skipped' };
}

/**
 * Fire-and-forget thumbnail ensure — logs failures but never throws.
 * Use this from create routes where you don't want to block the response.
 */
export function triggerContentThumbnailAsync(content: ContentForCover): void {
  ensureContentThumbnail(content)
    .then((result) => {
      if (result.source === 'existing' || result.source === 'skipped') return;
      console.log(
        `[content-cover] Set thumbnail for ${content.id} (${content.mediaType}/${result.source}): ${result.thumbnailUrl}`
      );
    })
    .catch((err) => {
      console.error(`[content-cover] Failed for ${content.id} (${content.mediaType}):`, err);
    });
}
