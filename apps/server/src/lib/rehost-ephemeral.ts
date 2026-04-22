/**
 * Rehosting utility — any URL from an AI provider's CDN (fal.media, volces,
 * Replicate, DALL-E signed URLs, etc.) will 403 once the signature expires.
 * Call this before persisting such a URL anywhere (gallery, entity, offChain
 * node) so we always store a permanent Pinata URL instead.
 */

const EPHEMERAL_HOSTS = [
  'volces.com', // ByteDance ModelArk / Seedance / Seedream
  'fal.media',
  'replicate.delivery',
  'pbxt.replicate.delivery',
  'oaidalleapiprodscus.blob.core.windows.net', // OpenAI DALL-E
  'ark-acg', // ByteDance TOS prefix
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
