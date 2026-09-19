import { z } from 'zod';
import { isAllowedMediaHost } from '../../lib/media-hosts';

/** Extra hosts LOAR serves its own media from that `isAllowedMediaHost` doesn't list. */
const EXTRA_SUFFIXES = ['loar.fun', 'meshy.ai', '4everland.io', 'nftstorage.link'];

/**
 * True when `raw` is a URL a draft may point at: https on a known media host,
 * a LOAR domain, or an operator-approved host (DRAFT_MEDIA_EXTRA_HOSTS, comma
 * separated suffixes). Outside production, http://localhost is also accepted so
 * local dev against the emulator keeps working.
 */
export function isAllowedDraftMediaUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  if (process.env.NODE_ENV !== 'production' && u.protocol === 'http:') {
    return host === 'localhost' || host === '127.0.0.1';
  }
  if (u.protocol !== 'https:') return false;
  if (isAllowedMediaHost(raw)) return true;
  const extra = (process.env.DRAFT_MEDIA_EXTRA_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...EXTRA_SUFFIXES, ...extra].some((sfx) => host === sfx || host.endsWith(`.${sfx}`));
}

/** Draft media URLs: bounded length, and restricted to trusted media hosts. */
export const mediaUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine(isAllowedDraftMediaUrl, { message: 'Media URL host is not allowed' });

/**
 * Picks the canonical media for a sandbox draft. Shared by saveDraft (which
 * mirrors a draft into a gallery content record) and promoteToUniverse so the
 * two always agree on which URL / media type represents a draft.
 *
 * Priority: 3D model > video > audio > image. A 3D draft usually also carries
 * a turntable video and a thumbnail image; the model file must win or the GLB
 * is never published.
 */
export type DraftMediaType = 'ai-3d' | 'ai-video' | 'ai-audio' | 'ai-image';

export interface DraftMediaInput {
  videoUrl?: string | null;
  imageUrl?: string | null;
  audioUrl?: string | null;
  modelUrl?: string | null;
  thumbnailUrl?: string | null;
}

export function resolveDraftMedia(d: DraftMediaInput): {
  mediaUrl: string;
  mediaType: DraftMediaType;
  thumbnailUrl: string | null;
} {
  const thumbnailUrl = d.thumbnailUrl || d.imageUrl || null;
  if (d.modelUrl) return { mediaUrl: d.modelUrl, mediaType: 'ai-3d', thumbnailUrl };
  if (d.videoUrl) return { mediaUrl: d.videoUrl, mediaType: 'ai-video', thumbnailUrl };
  if (d.audioUrl) return { mediaUrl: d.audioUrl, mediaType: 'ai-audio', thumbnailUrl };
  return { mediaUrl: d.imageUrl || '', mediaType: 'ai-image', thumbnailUrl };
}
