/**
 * Content fingerprint + CSAM scan entry point.
 *
 * Typical call site (direct upload or storage-persist path):
 *
 *   import { scanUpload } from 'src/services/fingerprint';
 *   const verdict = await scanUpload({ url, bytes, mimeType, kind: 'image' });
 *   if (verdict.block) throw new Error(verdict.reason);
 *   if (verdict.fingerprint) await registerFingerprint(contentId, verdict.fingerprint);
 */

export * from './types';
export * from './phash';
export * from './csam-providers';

import { LocalPhashProvider } from './phash';
import { scanForCsam } from './csam-providers';
import type { MediaRef, PerceptualHashResult, CsamScanResult } from './types';

export interface UploadVerdict {
  block: boolean;
  reason?: string;
  fingerprint?: PerceptualHashResult;
  csam?: CsamScanResult;
}

const localPhash = new LocalPhashProvider();

/**
 * Pre-upload scan (bytes in memory, no hosted URL yet).
 *
 * Runs:
 *   - perceptual fingerprint (needed for dedup / copyright checks before the
 *     upload is even persisted)
 *
 * Does NOT run CSAM — vendor APIs (PhotoDNA, Hive) require a fetch-able URL
 * or base64 blob, and base64 payloads over 4 MB break on most vendor edges.
 * Use `scanHosted()` after `manager.upload()` completes.
 */
export async function scanUpload(media: MediaRef): Promise<UploadVerdict> {
  const fp = await localPhash.compute(media).catch((err) => {
    console.warn('[fingerprint] phash compute failed:', err);
    return { configured: false as const, reason: 'compute error' };
  });

  return {
    block: false,
    fingerprint: fp.configured ? fp : undefined,
  };
}

/**
 * Post-upload CSAM scan against a hosted URL. This is the enforcement point:
 * if it matches, the caller MUST remove the content from the gallery and
 * file a contentAuditLog entry. IPFS content is immutable, so "removal"
 * is a gallery/index delist, not a delete.
 */
export async function scanHosted(media: MediaRef): Promise<UploadVerdict> {
  const csam = await scanForCsam(media);
  if (csam && csam.configured && csam.match) {
    return {
      block: true,
      reason: 'content flagged by CSAM detection',
      csam,
    };
  }
  return {
    block: false,
    csam: csam && csam.configured ? csam : undefined,
  };
}
