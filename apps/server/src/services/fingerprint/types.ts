/**
 * Perceptual fingerprint + CSAM detection contracts.
 *
 * Why it's split this way:
 *   1. `perceptualHash` — platform-controlled, baseline duplicate/similarity
 *      detection. Computed locally. Used for copyright fingerprint lookups.
 *   2. `csamScan` — third-party vendor (PhotoDNA / Hive / Thorn). Platform
 *      never stores the hashes themselves (privacy + legal); we only store
 *      vendor match verdicts.
 *   3. `nsfwScan` — policy moderation, lower stakes than CSAM. Can be served
 *      by the same VLM pipeline already in `services/vlm/moderation.ts` or by
 *      a dedicated vendor; abstracted here so callers don't have to care.
 *
 * Every provider returns a `ProviderResult` with `configured: false` when its
 * credentials are missing. Callers must treat "missing provider" distinctly
 * from "provider ran, no match" — the former is an ops incident for anything
 * CSAM-adjacent.
 */

export interface MediaRef {
  /** Absolute HTTPS URL the provider can fetch. */
  url: string;
  /** Raw bytes when already in memory — avoids a second network round-trip. */
  bytes?: Buffer;
  /** MIME type — required for some vendor APIs. */
  mimeType: string;
  /** "image" | "video"; most vendors only cover the former. */
  kind: 'image' | 'video';
}

/** Baseline perceptual hash — 64 or 256 bits, hex-encoded. */
export interface PerceptualHashResult {
  configured: true;
  algorithm: 'ahash' | 'phash' | 'dhash';
  /** Hex string; length encodes bit count (16 hex = 64 bits). */
  hash: string;
  /** Milliseconds spent computing, excluding network fetch. */
  computeMs: number;
}

/** CSAM match from a vendor. Hash bytes are intentionally NOT returned. */
export interface CsamScanResult {
  configured: true;
  match: boolean;
  /** Opaque vendor ID for audit logging — not the hash itself. */
  vendorReferenceId: string | null;
  /** Vendor-specific confidence when the match is probabilistic. */
  confidence: number | null;
  vendor: 'photodna' | 'hive' | 'thorn' | string;
}

export interface NsfwScanResult {
  configured: true;
  nsfwScore: number;
  violenceScore: number | null;
  vendor: 'vlm' | 'hive' | string;
}

export interface ProviderDisabled {
  configured: false;
  reason: string;
}

export type FingerprintOutcome = PerceptualHashResult | ProviderDisabled;
export type CsamOutcome = CsamScanResult | ProviderDisabled;
export type NsfwOutcome = NsfwScanResult | ProviderDisabled;

export interface FingerprintProvider {
  readonly name: string;
  compute(media: MediaRef): Promise<FingerprintOutcome>;
}

export interface CsamProvider {
  readonly name: string;
  scan(media: MediaRef): Promise<CsamOutcome>;
}

export interface NsfwProvider {
  readonly name: string;
  scan(media: MediaRef): Promise<NsfwOutcome>;
}

/**
 * Hamming distance between two equal-length hex strings. Lower = more similar.
 * Returns null when the strings are different lengths (can't compare).
 */
export function hammingDistance(a: string, b: string): number | null {
  if (a.length !== b.length) return null;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    const byteA = parseInt(a.slice(i, i + 2), 16);
    const byteB = parseInt(b.slice(i, i + 2), 16);
    let xor = byteA ^ byteB;
    while (xor) {
      d += xor & 1;
      xor >>= 1;
    }
  }
  return d;
}
