import { db } from './firebase';
import { triggerContentThumbnailAsync } from '../services/content-cover-image';
import { recordAssetEventAsync } from '../services/lineage';
import type { AssetOutputKind } from '../services/lineage/types';

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
  /** Lineage refs — set when this clip is derived from another generation. */
  parentGenerationId?: string | null;
  sourceImageUrl?: string | null;
  sourceVideoGenerationId?: string | null;
  sourceAudioGenerationId?: string | null;
}

/**
 * Hosts that return expiring signed URLs we must NOT persist — they 403 once
 * the signature expires (usually hours to days). Any mediaUrl from these hosts
 * is rehosted to Pinata before we write the gallery doc.
 *
 * If you add a new model provider, add its CDN host here.
 */
const EPHEMERAL_HOSTS = [
  'volces.com', // ByteDance ModelArk / Seedance / Seedream
  'fal.media',
  'replicate.delivery',
  'oaidalleapiprodscus.blob.core.windows.net', // OpenAI DALL-E
  'pbxt.replicate.delivery',
  'ark-acg', // ByteDance TOS prefix
];

function isEphemeralUrl(url: string): boolean {
  try {
    const host = new URL(url).host.toLowerCase();
    return EPHEMERAL_HOSTS.some((ep) => host.includes(ep));
  } catch {
    return false;
  }
}

function extOf(mediaType: GalleryMediaType, fallbackUrl: string): string {
  if (mediaType.includes('image')) return 'png';
  if (mediaType === 'audio') return 'mp3';
  if (mediaType === '3d') return 'glb';
  // Try to infer from URL
  const m = fallbackUrl.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  if (m) return m[1].toLowerCase();
  return 'mp4';
}

function mimeFor(mediaType: GalleryMediaType, ext: string): string {
  if (mediaType.includes('image')) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  if (mediaType === 'audio') return `audio/${ext === 'mp3' ? 'mpeg' : ext}`;
  if (mediaType === '3d') return 'model/gltf-binary';
  return `video/${ext === 'mov' ? 'quicktime' : ext}`;
}

/**
 * Downloads a remote URL and rehosts it via the shared StorageManager so
 * the gallery doc holds a permanent Pinata/Lighthouse URL. Returns the
 * original URL on any failure — a broken-but-temporary URL is strictly
 * better than a failed publish.
 */
async function rehostIfEphemeral(
  input: PublishGalleryInput
): Promise<{ mediaUrl: string; contentHash?: string }> {
  if (!isEphemeralUrl(input.mediaUrl)) {
    return { mediaUrl: input.mediaUrl };
  }
  try {
    const { getStorageManager } = await import('../services/storage');
    const manager = getStorageManager();
    const ext = extOf(input.mediaType, input.mediaUrl);
    const mime = mimeFor(input.mediaType, ext);
    const filename = `${input.generationId || 'gallery'}.${ext}`;
    const manifest = await manager.uploadFromUrl(input.mediaUrl, filename, input.creatorUid);
    const permanent = manifest.uploads[0]?.url;
    if (!permanent) return { mediaUrl: input.mediaUrl };
    return { mediaUrl: permanent, contentHash: manifest.contentHash };
  } catch (err) {
    console.error(
      `[gallery] rehost failed for ${input.mediaUrl.slice(0, 80)} — publishing ephemeral:`,
      err
    );
    return { mediaUrl: input.mediaUrl };
  }
}

export function buildGalleryDoc(
  input: PublishGalleryInput,
  extra?: { contentHash?: string }
): Record<string, unknown> {
  const now = input.createdAt ?? new Date();
  return {
    title: input.title.slice(0, 100) || 'Generated',
    description: input.description,
    mediaUrl: input.mediaUrl,
    thumbnailUrl: input.thumbnailUrl ?? null,
    mediaType: input.mediaType,
    classification: 'original',
    contentStatus: 'active',
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
    ...(input.parentGenerationId ? { parentGenerationId: input.parentGenerationId } : {}),
    ...(input.sourceImageUrl ? { sourceImageUrl: input.sourceImageUrl } : {}),
    ...(input.sourceVideoGenerationId
      ? { sourceVideoGenerationId: input.sourceVideoGenerationId }
      : {}),
    ...(input.sourceAudioGenerationId
      ? { sourceAudioGenerationId: input.sourceAudioGenerationId }
      : {}),
    ...(extra?.contentHash ? { storageContentHash: extra.contentHash } : {}),
  };
}

export async function publishToGallery(input: PublishGalleryInput): Promise<void> {
  if (!db) return;

  // Rehost ephemeral URLs before writing so the gallery never stores a URL
  // that will 403 once the provider's signature expires.
  const { mediaUrl, contentHash } = await rehostIfEphemeral(input);
  const resolvedInput: PublishGalleryInput = { ...input, mediaUrl };

  try {
    const ref = await db.collection('content').add(buildGalleryDoc(resolvedInput, { contentHash }));
    if (!resolvedInput.thumbnailUrl) {
      triggerContentThumbnailAsync({
        id: ref.id,
        mediaUrl: resolvedInput.mediaUrl,
        mediaType: resolvedInput.mediaType,
        creatorUid: resolvedInput.creatorUid,
      });
    }

    // PRD 10: lineage event for the publish step. Parent = the generation
    // (or another generation we were derived from) so the asset family tree
    // walks generate → publish.
    const outputKind: AssetOutputKind = resolvedInput.mediaType.includes('image')
      ? 'image'
      : resolvedInput.mediaType === 'audio'
        ? 'audio'
        : resolvedInput.mediaType === '3d'
          ? '3d'
          : 'video';
    const parentAssetId =
      resolvedInput.parentGenerationId ??
      resolvedInput.sourceVideoGenerationId ??
      resolvedInput.sourceAudioGenerationId ??
      resolvedInput.generationId ??
      null;

    recordAssetEventAsync({
      assetId: ref.id,
      parentAssetId,
      kind: 'publish',
      tool: resolvedInput.generationModel || 'gallery',
      step: 'publish',
      prompt: resolvedInput.description || null,
      promptRefs: [],
      modelId: resolvedInput.generationModel || null,
      creditCost: 0,
      latencyMs: null,
      creatorUid: resolvedInput.creatorUid,
      universeId: resolvedInput.universeId ?? null,
      rightsClass: 'original',
      outputUrl: resolvedInput.mediaUrl,
      outputKind,
      status: 'completed',
    });

    // PostHog: creator "content published" funnel event. Together with
    // generation:completed this powers the creator success funnel:
    // signup → first generation → first published piece.
    void import('./analytics').then(({ captureServerEvent }) =>
      captureServerEvent('content:published', {
        distinctId: resolvedInput.creatorUid,
        contentId: ref.id,
        outputKind,
        universeId: resolvedInput.universeId ?? null,
        generationModel: resolvedInput.generationModel ?? null,
      })
    );
  } catch (err: unknown) {
    console.error(`[gallery] publish failed (${input.generationId}):`, err);
  }
}
