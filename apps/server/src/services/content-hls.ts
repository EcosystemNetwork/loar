/**
 * Content HLS Pipeline
 *
 * Wraps `transcodeToHls` + `generateThumbnailSprite` for the gallery's
 * fire-and-forget post-upload hook. Only runs for video content; everything
 * else short-circuits.
 *
 * On success the content document picks up two new fields:
 *   - hlsUrl: master.m3u8 URL (the player prefers this when present)
 *   - vttThumbnailsUrl: WebVTT cue track that pairs with the sprite sheet
 *   - hlsRenditions: count of variant playlists generated
 *
 * On failure we leave the doc unchanged — the original mediaUrl still plays
 * via progressive download. HLS is purely additive.
 *
 * Used by:
 *   - lib/gallery-publish.ts (post-publish, fire-and-forget)
 *   - routers/content/content.routes.ts:create (post-create, fire-and-forget)
 *   - scripts/backfill-hls.ts (TODO: existing-content backfill)
 */

import { db } from '../lib/firebase';
import { transcodeToHls, generateThumbnailSprite } from './video-transcode';
import type { ContentMediaType } from './content-cover-image';

export interface ContentForHls {
  id: string;
  mediaUrl: string;
  mediaType: ContentMediaType;
  creatorUid?: string;
  /** Skip 1080p transcode (useful for vertical / short-form content). */
  shortForm?: boolean;
}

export interface EnsureContentHlsResult {
  hlsUrl: string | null;
  vttThumbnailsUrl: string | null;
  renditionCount: number;
  source: 'transcoded' | 'skipped' | 'failed';
}

const ENABLED = (process.env.HLS_TRANSCODE_ENABLED ?? 'true').toLowerCase() !== 'false';

/**
 * Transcode to HLS + generate thumbnail sprite, then patch the content doc.
 * Pure side-effects on success; returns the URLs so callers can log them.
 */
export async function ensureContentHls(content: ContentForHls): Promise<EnsureContentHlsResult> {
  if (!ENABLED) {
    return { hlsUrl: null, vttThumbnailsUrl: null, renditionCount: 0, source: 'skipped' };
  }
  if (content.mediaType !== 'video' && content.mediaType !== 'ai-video') {
    return { hlsUrl: null, vttThumbnailsUrl: null, renditionCount: 0, source: 'skipped' };
  }
  if (!db) throw new Error('Firestore not initialized');

  // Run both pipelines in parallel — they share the source URL but otherwise
  // don't depend on each other, so back-to-back ffmpeg invocations is wasted
  // wall time.
  const [transcode, sprite] = await Promise.all([
    transcodeToHls(content.mediaUrl, content.id, {
      uploaderUid: content.creatorUid ?? 'system',
      skip1080: content.shortForm,
    }),
    generateThumbnailSprite(content.mediaUrl, content.id, {
      uploaderUid: content.creatorUid ?? 'system',
    }),
  ]);

  if (!transcode && !sprite) {
    return { hlsUrl: null, vttThumbnailsUrl: null, renditionCount: 0, source: 'failed' };
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (transcode) {
    patch.hlsUrl = transcode.masterUrl;
    patch.hlsRenditions = transcode.variantUrls.length;
  }
  if (sprite) {
    patch.vttThumbnailsUrl = sprite.vttUrl;
    patch.spriteSheetUrl = sprite.spriteUrl;
  }

  await db.collection('content').doc(content.id).update(patch);

  return {
    hlsUrl: transcode?.masterUrl ?? null,
    vttThumbnailsUrl: sprite?.vttUrl ?? null,
    renditionCount: transcode?.variantUrls.length ?? 0,
    source: 'transcoded',
  };
}

/**
 * Fire-and-forget HLS pipeline. Logs result/failure but never throws.
 * Long-running (transcode is CPU-bound), so we explicitly do not block the
 * caller's response.
 */
export function triggerContentHlsAsync(content: ContentForHls): void {
  if (!ENABLED) return;
  if (content.mediaType !== 'video' && content.mediaType !== 'ai-video') return;

  ensureContentHls(content)
    .then((result) => {
      if (result.source === 'transcoded') {
        console.log(
          `[content-hls] ${content.id}: master=${result.hlsUrl} renditions=${result.renditionCount} vtt=${result.vttThumbnailsUrl ? 'yes' : 'no'}`
        );
      } else if (result.source === 'failed') {
        console.warn(`[content-hls] ${content.id}: transcode failed (HLS unavailable)`);
      }
    })
    .catch((err) => {
      console.error(`[content-hls] ${content.id}: unexpected error`, err);
    });
}
