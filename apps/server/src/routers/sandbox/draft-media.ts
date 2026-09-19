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
