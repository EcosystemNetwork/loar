import { db } from './firebase';
import { triggerContentThumbnailAsync } from '../services/content-cover-image';
import { recordAssetEventAsync } from '../services/lineage';
import type { AssetOutputKind } from '../services/lineage/types';
import { isEphemeralUrl as _isEphemeralUrl, rehostEphemeralUrl } from './rehost-ephemeral';

export type GalleryMediaType = 'image' | 'ai-image' | 'video' | 'ai-video' | 'audio' | '3d';

/**
 * PRD-rights classification. `original` = creator's own IP, `fan` = fan art /
 * derivative of a third-party work, `licensed` = used under a bought/granted
 * license. Callers that know they're generating derivative content (e.g.
 * character-pipeline from a reference image the user uploaded) should pass
 * the appropriate value; everything else defaults to `original`.
 */
export type GalleryClassification = 'original' | 'fan' | 'licensed';

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
  classification?: GalleryClassification;
  /** Lineage refs — set when this clip is derived from another generation. */
  parentGenerationId?: string | null;
  sourceImageUrl?: string | null;
  sourceVideoGenerationId?: string | null;
  sourceAudioGenerationId?: string | null;
}

// Ephemeral-host detection lives in ./rehost-ephemeral so entities and other
// callers can share the same provider-CDN list. Re-exported below for callers
// importing through this module.
const isEphemeralUrl = _isEphemeralUrl;
export { isEphemeralUrl };

function extOf(mediaType: GalleryMediaType, fallbackUrl: string): string {
  if (mediaType.includes('image')) return 'png';
  if (mediaType === 'audio') return 'mp3';
  if (mediaType === '3d') return 'glb';
  // Try to infer from URL
  const m = fallbackUrl.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i);
  if (m) return m[1].toLowerCase();
  return 'mp4';
}

async function rehostIfEphemeral(
  input: PublishGalleryInput
): Promise<{ mediaUrl: string; thumbnailUrl: string | null; contentHash?: string }> {
  const ext = extOf(input.mediaType, input.mediaUrl);
  const baseFilename = `${input.generationId || 'gallery'}.${ext}`;

  const mediaResult = await rehostEphemeralUrl(input.mediaUrl, baseFilename, input.creatorUid);

  let thumbnailUrl: string | null = input.thumbnailUrl ?? null;
  if (thumbnailUrl) {
    const thumbFilename = `${input.generationId || 'gallery'}-thumb.jpg`;
    const thumbResult = await rehostEphemeralUrl(thumbnailUrl, thumbFilename, input.creatorUid);
    thumbnailUrl = thumbResult.url;
  }

  return {
    mediaUrl: mediaResult.url,
    thumbnailUrl,
    contentHash: mediaResult.contentHash,
  };
}

export function buildGalleryDoc(
  input: PublishGalleryInput,
  extra?: { contentHash?: string }
): Record<string, unknown> {
  const now = input.createdAt ?? new Date();
  const classification: GalleryClassification = input.classification ?? 'original';
  return {
    title: input.title.slice(0, 100) || 'Generated',
    description: input.description,
    mediaUrl: input.mediaUrl,
    thumbnailUrl: input.thumbnailUrl ?? null,
    mediaType: input.mediaType,
    classification,
    contentStatus: 'active',
    tags: input.tags ?? [],
    ipDeclaration: {
      isOriginal: classification === 'original',
      usesCopyrightedMaterial: classification !== 'original',
      license: classification === 'licensed' ? 'licensed' : 'all-rights-reserved',
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

/**
 * Enqueue a VLM moderation scan for a freshly-published content doc. Gated by
 * `VLM_MODERATION_ON_GENERATION=true` and only applies to visual media (image
 * / video) — Gemini can't score audio or GLB files. Non-blocking; a failed
 * enqueue must not take down a publish.
 */
async function enqueueVlmScanAsync(opts: {
  contentId: string;
  mediaUrl: string;
  mediaType: GalleryMediaType;
  creatorUid: string;
  generationId: string;
  universeId: string | null;
}): Promise<void> {
  if (process.env.VLM_MODERATION_ON_GENERATION !== 'true') return;
  const assetType: 'image' | 'video' | null = opts.mediaType.includes('image')
    ? 'image'
    : opts.mediaType.includes('video')
      ? 'video'
      : null;
  if (!assetType) return;
  try {
    const [{ getVlmQueue }, { randomUUID }] = await Promise.all([
      import('./queue'),
      import('node:crypto'),
    ]);
    const jobId = `vlm_${randomUUID()}`;
    await getVlmQueue().add(
      'extract',
      {
        jobId,
        kind: 'extract',
        creatorUid: opts.creatorUid.toLowerCase(),
        input: {
          assetType,
          mediaUrl: opts.mediaUrl,
          contentId: opts.contentId,
          generationId: opts.generationId,
          universeAddress: opts.universeId,
        },
      },
      { jobId }
    );
  } catch (err) {
    console.warn(`[gallery] VLM scan enqueue failed for ${opts.contentId}:`, err);
  }
}

/**
 * Gemini Flash auto-tagging. Env-gated because every publish adds a small
 * Gemini cost (~$0.0001–0.001). Merges with user-supplied tags; on failure
 * returns the original list so a broken VLM never blocks a publish.
 */
async function maybeAutoTag(input: PublishGalleryInput): Promise<string[]> {
  const userTags = input.tags ?? [];
  if (process.env.VLM_AUTOTAG_ON_PUBLISH !== 'true') return userTags;
  if (!input.mediaType.includes('image') && !input.mediaType.includes('video')) return userTags;
  try {
    const [{ autoTagContent, mergeTags }] = await Promise.all([import('../services/vlm/auto-tag')]);
    const auto = await autoTagContent({
      mediaUrl: input.mediaUrl,
      mediaType: input.mediaType,
      title: input.title,
      description: input.description,
    });
    return mergeTags(userTags, auto);
  } catch (err) {
    console.warn('[gallery] auto-tag failed, using user tags only:', err);
    return userTags;
  }
}

export async function publishToGallery(input: PublishGalleryInput): Promise<void> {
  if (!db) return;

  // Rehost ephemeral URLs (media + thumbnail) before writing so the gallery
  // never stores a URL that will 403 once the provider's signature expires.
  const { mediaUrl, thumbnailUrl, contentHash } = await rehostIfEphemeral(input);
  const tags = await maybeAutoTag({ ...input, mediaUrl });
  const resolvedInput: PublishGalleryInput = { ...input, mediaUrl, thumbnailUrl, tags };

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
      rightsClass: resolvedInput.classification ?? 'original',
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

    // PRD 10: every visual publish gets a VLM moderation scan so reviewers
    // see a risk score alongside the content. No-op for audio / 3D, and
    // env-gated so the ~$0.001/scan cost is opt-in before mainnet.
    void enqueueVlmScanAsync({
      contentId: ref.id,
      mediaUrl: resolvedInput.mediaUrl,
      mediaType: resolvedInput.mediaType,
      creatorUid: resolvedInput.creatorUid,
      generationId: resolvedInput.generationId,
      universeId: resolvedInput.universeId ?? null,
    });
  } catch (err: unknown) {
    console.error(`[gallery] publish failed (${input.generationId}):`, err);
  }
}
