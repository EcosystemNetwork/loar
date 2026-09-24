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
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractFramePng, probeVideo } from '../ffmpeg/probe';
import type { FingerprintProvider, FingerprintOutcome, MediaRef } from './types';

const HASH_SIZE = 8; // 8×8 = 64 bits

/** Relative positions sampled for a video fingerprint (skips fades at 0%/100%). */
const VIDEO_SAMPLE_POINTS = [0.25, 0.5, 0.75] as const;
/** Refuse to download more than this for fingerprinting — it runs on the upload path. */
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;

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

/**
 * Fingerprint a video as the concatenation of the aHash of frames sampled at
 * 25% / 50% / 75% of its duration (3 × 64 bits = 48 hex chars). Comparing two
 * videos is then a per-frame Hamming distance, which survives re-encoding and
 * resolution changes the same way the image hash does.
 *
 * The bytes are spooled to a temp file (rather than handing ffmpeg the URL) so
 * the fetch goes through `safeFetch`'s SSRF pinning and ffmpeg never touches
 * the network.
 */
async function computeVideoHash(media: MediaRef): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), 'vphash-'));
  try {
    const path = join(workDir, 'input');
    if (media.bytes) {
      if (media.bytes.length > MAX_VIDEO_BYTES) throw new Error('video too large to fingerprint');
      await writeFile(path, media.bytes);
    } else {
      const { safeFetch } = await import('../../lib/url-validator');
      const res = await safeFetch(media.url, { redirect: 'error' });
      if (!res.ok) throw new Error(`fetch ${media.url} returned ${res.status}`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_VIDEO_BYTES) throw new Error('video too large to fingerprint');
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_VIDEO_BYTES) throw new Error('video too large to fingerprint');
      await writeFile(path, bytes);
    }

    const { durationSec } = await probeVideo(path);
    let hash = '';
    for (const point of VIDEO_SAMPLE_POINTS) {
      const frame = await extractFramePng(path, durationSec * point);
      hash += await computeAhash(frame);
    }
    return hash;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export class LocalPhashProvider implements FingerprintProvider {
  readonly name = 'local-ahash';

  async compute(media: MediaRef): Promise<FingerprintOutcome> {
    const sharp = await loadSharp();
    if (!sharp) {
      return {
        configured: false,
        reason: 'sharp not installed — run `pnpm add sharp` in apps/server to enable local pHash',
      };
    }

    if (media.kind === 'video') {
      const start = Date.now();
      const hash = await computeVideoHash(media);
      return { configured: true, algorithm: 'ahash', hash, computeMs: Date.now() - start };
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
