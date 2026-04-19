/**
 * Local perceptual hash (aHash) baseline.
 *
 * We implement aHash (not dHash or pHash) because it's the simplest hash that
 * still survives recompression, re-encoding, and minor crops — good enough
 * for a first-line duplicate / copyright fingerprint check. Upgrading to
 * dHash or pHash is a one-file change when we need stronger similarity.
 *
 * Requires `sharp` for image decoding. If sharp isn't installed, this
 * provider reports configured=false so the moderation pipeline can skip it
 * without crashing (matches the "all real integrations, no mocks" rule —
 * a missing dep is missing capability, not silent fake output).
 */

import { createHash } from 'node:crypto';
import type { FingerprintProvider, FingerprintOutcome, MediaRef } from './types';

const HASH_SIZE = 8; // 8×8 = 64 bits

// Typed loosely on purpose — `sharp` is an optional peer dep and may not be
// installed. The local pHash provider returns `configured: false` when the
// dynamic import fails, so tsc shouldn't see a hard dependency.
type SharpFactory = (input: Buffer) => {
  resize: (w: number, h: number, opts?: { fit?: string }) => ReturnType<SharpFactory>;
  greyscale: () => ReturnType<SharpFactory>;
  raw: () => ReturnType<SharpFactory>;
  toBuffer: () => Promise<Buffer>;
};

async function loadSharp(): Promise<SharpFactory | null> {
  try {
    const mod: { default?: SharpFactory } = await import(/* @vite-ignore */ 'sharp' as string);
    return mod.default ?? (mod as unknown as SharpFactory);
  } catch {
    return null;
  }
}

async function fetchBytes(media: MediaRef): Promise<Buffer> {
  if (media.bytes) return media.bytes;
  const res = await fetch(media.url);
  if (!res.ok) throw new Error(`fetch ${media.url} returned ${res.status}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

/**
 * Resize to HASH_SIZE×HASH_SIZE grayscale, threshold each pixel against the
 * mean luminance, pack the resulting bits into a hex string.
 */
async function computeAhash(buffer: Buffer): Promise<string> {
  const sharp = await loadSharp();
  if (!sharp) throw new Error('sharp is not installed');

  const pixels = await sharp(buffer)
    .resize(HASH_SIZE, HASH_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();

  let sum = 0;
  for (const p of pixels) sum += p;
  const mean = sum / pixels.length;

  const bits: number[] = [];
  for (let i = 0; i < pixels.length; i++) {
    bits.push(pixels[i] >= mean ? 1 : 0);
  }

  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i + 1] << 2) | (bits[i + 2] << 1) | bits[i + 3];
    hex += nibble.toString(16);
  }
  return hex;
}

export class LocalPhashProvider implements FingerprintProvider {
  readonly name = 'local-ahash';

  async compute(media: MediaRef): Promise<FingerprintOutcome> {
    if (media.kind === 'video') {
      // Video fingerprinting needs a frame extraction step (ffmpeg). Out of
      // scope for the baseline — VLM moderation already covers video, so the
      // gap is copyright-dedup of video which we defer.
      return { configured: false, reason: 'video fingerprinting not implemented locally' };
    }

    const sharp = await loadSharp();
    if (!sharp) {
      return {
        configured: false,
        reason: 'sharp not installed — run `pnpm add sharp` in apps/server to enable local pHash',
      };
    }

    const start = Date.now();
    const bytes = await fetchBytes(media);
    const hash = await computeAhash(bytes);
    return {
      configured: true,
      algorithm: 'ahash',
      hash,
      computeMs: Date.now() - start,
    };
  }
}

/**
 * Content-addressable hash of the raw bytes — cheap, exact-match only.
 * Useful for catching identical reuploads even before pHash runs.
 */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
