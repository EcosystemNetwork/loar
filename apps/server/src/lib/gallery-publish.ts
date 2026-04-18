import { db } from './firebase';
import { triggerContentThumbnailAsync } from '../services/content-cover-image';

export type GalleryMediaType = 'image' | 'ai-image' | 'video' | 'ai-video' | 'audio' | '3d';

export interface PublishGalleryInput {
  creatorUid: string;
  mediaUrl: string;
  mediaType: GalleryMediaType;
  title: string;
  description: string;
  thumbnailUrl?: string | null;
  universeId?: string | null;
  generationId: string;
  generationModel: string;
  tags?: string[];
  createdAt?: Date;
}

export function buildGalleryDoc(input: PublishGalleryInput): Record<string, unknown> {
  const now = input.createdAt ?? new Date();
  return {
    title: input.title.slice(0, 100) || 'Generated',
    description: input.description,
    mediaUrl: input.mediaUrl,
    thumbnailUrl: input.thumbnailUrl ?? null,
    mediaType: input.mediaType,
    classification: 'original',
    tags: input.tags ?? [],
    ipDeclaration: {
      isOriginal: true,
      usesCopyrightedMaterial: false,
      license: 'all-rights-reserved',
    },
    visibility: 'public',
    creatorUid: input.creatorUid,
    ...(input.universeId ? { universeId: input.universeId } : {}),
    createdAt: now,
    updatedAt: now,
    views: 0,
    likes: 0,
    reviewStatus: 'not_required',
    generationId: input.generationId,
    generationModel: input.generationModel,
  };
}

export function publishToGallery(input: PublishGalleryInput): Promise<void> {
  if (!db) return Promise.resolve();
  return db
    .collection('content')
    .add(buildGalleryDoc(input))
    .then((ref) => {
      if (!input.thumbnailUrl) {
        triggerContentThumbnailAsync({
          id: ref.id,
          mediaUrl: input.mediaUrl,
          mediaType: input.mediaType,
          creatorUid: input.creatorUid,
        });
      }
    })
    .catch((err: unknown) => {
      console.error(`[gallery] publish failed (${input.generationId}):`, err);
    });
}
