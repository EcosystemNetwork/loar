/**
 * Rehosting utility — any URL from an AI provider's CDN (fal.media, volces,
 * Replicate, DALL-E signed URLs, Meshy, Tripo3D, etc.) will 403 once the
 * signature expires. Call this before persisting such a URL anywhere (gallery,
 * entity, offChain node) so we always store a permanent Pinata URL instead.
 */

const EPHEMERAL_HOSTS = [
  'volces.com', // ByteDance ModelArk / Seedance / Seedream
  'fal.media',
  'replicate.delivery',
  'pbxt.replicate.delivery',
  'oaidalleapiprodscus.blob.core.windows.net', // OpenAI DALL-E
  'ark-acg', // ByteDance TOS prefix
  'generativelanguage.googleapis.com', // Google-direct Veo/Gemini Files API — key-scoped, expires
  'assets.meshy.ai', // Meshy 3D — GLB/FBX/USDZ/thumbnail URLs, CloudFront-signed, expire
  'tripo-data', // Tripo3D 3D — tripo-data.rg1.data.tripo3d.ai + legacy tripo-data.cdn.bcebos.com, signed, expire
  'data.tripo3d.ai', // Tripo3D data domain (any region subdomain), signed, expire
];

export function isEphemeralUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).host.toLowerCase();
    return EPHEMERAL_HOSTS.some((ep) => host.includes(ep));
  } catch {
    return false;
  }
}

const REHOST_ATTEMPTS = 3;
const REHOST_BASE_DELAY_MS = 500;

/**
 * Download an ephemeral URL and re-host it via the shared StorageManager.
 * Non-ephemeral URLs are returned unchanged. On retry exhaustion, the original
 * URL is returned so callers can fall back to the ephemeral link.
 */
export async function rehostEphemeralUrl(
  url: string,
  filename: string,
  uploaderUid: string
): Promise<{ url: string; contentHash?: string; rehosted: boolean }> {
  if (!isEphemeralUrl(url)) return { url, rehosted: false };

  let lastErr: unknown;
  for (let attempt = 1; attempt <= REHOST_ATTEMPTS; attempt++) {
    try {
      const { getStorageManager } = await import('../services/storage');
      const manager = getStorageManager();
      const manifest = await manager.uploadFromUrl(url, filename, uploaderUid);
      const permanent = manifest.uploads[0]?.url;
      if (permanent) {
        return { url: permanent, contentHash: manifest.contentHash, rehosted: true };
      }
      lastErr = new Error('storage manager returned no permanent URL');
    } catch (err) {
      lastErr = err;
    }
    if (attempt < REHOST_ATTEMPTS) {
      const delay = REHOST_BASE_DELAY_MS * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  console.error(
    `[rehost] failed after ${REHOST_ATTEMPTS} attempts for ${url.slice(0, 80)}:`,
    lastErr
  );
  return { url, rehosted: false };
}

export interface RehostableModelOutput {
  glb?: string;
  fbx?: string;
  obj?: string;
  mtl?: string;
  usdz?: string;
}

/**
 * Rehost a 3D model output bundle (Meshy image/text-to-3D, retexture, auto-rig,
 * animation — any provider) so no expiring CDN URL is persisted. Every present
 * format plus the optional thumbnail/video is pushed through `rehostEphemeralUrl`:
 * non-ephemeral URLs pass through untouched and any single rehost failure falls
 * back to the original URL, so the bundle is always usable. `slug` seeds the
 * stored filename (entity name, prompt, or generation id).
 */
export async function rehostModelBundle(
  input: {
    modelUrls?: RehostableModelOutput | null;
    thumbnailUrl?: string | null;
    videoUrl?: string | null;
  },
  slug: string,
  uploaderUid: string
): Promise<{
  modelUrls: RehostableModelOutput;
  thumbnailUrl: string | null;
  videoUrl: string | null;
}> {
  const safeSlug =
    (slug || 'model').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) ||
    'model';
  const src = input.modelUrls ?? {};
  const out: RehostableModelOutput = {};
  const formats: Array<keyof RehostableModelOutput> = ['glb', 'fbx', 'obj', 'mtl', 'usdz'];

  await Promise.all([
    ...formats.map(async (fmt) => {
      const url = src[fmt];
      if (!url) return;
      const { url: permanent } = await rehostEphemeralUrl(
        url,
        `${safeSlug}.${fmt}`,
        uploaderUid
      );
      out[fmt] = permanent;
    }),
  ]);

  let thumbnailUrl = input.thumbnailUrl ?? null;
  if (thumbnailUrl) {
    thumbnailUrl = (await rehostEphemeralUrl(thumbnailUrl, `${safeSlug}-thumb.png`, uploaderUid))
      .url;
  }
  let videoUrl = input.videoUrl ?? null;
  if (videoUrl) {
    videoUrl = (await rehostEphemeralUrl(videoUrl, `${safeSlug}-turntable.mp4`, uploaderUid)).url;
  }

  return { modelUrls: out, thumbnailUrl, videoUrl };
}
