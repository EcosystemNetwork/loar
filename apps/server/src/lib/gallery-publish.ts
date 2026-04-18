import { db } from './firebase';

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
}

export function publishToGallery(input: PublishGalleryInput): Promise<void> {
  if (!db) return Promise.resolve();
  const now = new Date();
  return db
    .collection('content')
    .add({
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
    })
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error(`[gallery] publish failed (${input.generationId}):`, err);
    });
}
