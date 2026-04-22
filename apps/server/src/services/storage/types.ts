import { createHash } from 'crypto';
import { validateUploadUrl } from '../../lib/url-validator';

// ─── Core Types ──────────────────────────────────────────────

export interface UploadResult {
  provider: string;
  contentId: string; // Provider-specific (blobId, CID, pieceCid, key)
  contentHash: string; // SHA-256 hex of raw content (canonical ID)
  url: string;
  size: number;
}

/** Per-provider attempt record written during an upload pass. */
export interface ProviderAttempt {
  provider: string;
  status: 'success' | 'skipped' | 'failed';
  durationMs: number;
  error?: string;
  contentId?: string;
  url?: string;
  /** True if a HEAD check confirmed the URL is accessible after upload. */
  verified?: boolean;
}

/** Full tracing record attached to a manifest after upload. */
export interface UploadTrace {
  contentHash: string;
  attempts: ProviderAttempt[];
  /** Provider that produced the primary (returned) upload result. */
  primaryProvider: string;
  totalDurationMs: number;
  /** True if at least one provider passed post-upload HEAD verification. */
  verified: boolean;
  /** True if the manifest was returned from the deduplication cache. */
  fromCache: boolean;
}

/** Cost ledger entry persisted to Firestore `costLedger` collection. */
export interface CostEntry {
  id: string;
  userId?: string;
  contentHash?: string;
  /** 'upload' = storage, 'generation' = AI model, 'pin_ipfs' = explicit NFT pin */
  operation: 'upload' | 'generation' | 'pin_ipfs';
  provider: string;
  bytes: number;
  estimatedUploadCostUsd: number; // One-time transfer/pin cost
  estimatedMonthlyCostUsd: number; // Ongoing monthly storage cost
  totalCostUsd: number; // upload + monthly (1-month snapshot)
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface StorageManifest {
  contentHash: string;
  uploads: UploadResult[];
  originalFilename?: string;
  mimeType: string;
  size: number;
  createdAt: number;
  /** Populated on fresh uploads; absent on dedup hits returned from cache. */
  trace?: UploadTrace;
}

export interface ProviderStatus {
  name: string;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  contentId?: string;
  url?: string;
  error?: string;
}

// ─── Provider Interface ──────────────────────────────────────

export interface StorageProvider {
  readonly name: string;
  readonly priority: number;

  isAvailable(): boolean;
  upload(buffer: Buffer, filename: string, mimeType?: string): Promise<UploadResult>;
  uploadFromUrl(url: string, filename?: string): Promise<UploadResult>;
  download(contentId: string): Promise<Uint8Array>;
  getPublicUrl(contentId: string): string;
}

// ─── Helpers ─────────────────────────────────────────────────

export function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sha256ToBytes32(hex: string): `0x${string}` {
  return `0x${hex}` as `0x${string}`;
}

/** Fetch a URL into a Buffer with timeout + size limits. Validates against SSRF
 *  via DNS resolution + private-range check (the regex-only variant could be
 *  bypassed with a hostname pointing at 127.0.0.1 / 169.254.169.254). */
export async function fetchToBuffer(
  url: string,
  timeoutMs = 30_000,
  maxBytes = 200 * 1024 * 1024
): Promise<{ buffer: Buffer; contentType: string }> {
  await validateUploadUrl(url);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LOARStorage/1.0)',
      },
      redirect: 'error', // Prevent redirect-based SSRF bypass
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length === 0) {
      throw new Error('Empty response body');
    }
    if (buffer.length > maxBytes) {
      throw new Error(
        `File too large: ${Math.round(buffer.length / 1024 / 1024)}MB (max ${Math.round(maxBytes / 1024 / 1024)}MB)`
      );
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    return { buffer, contentType };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    m4v: 'video/mp4',
    // Raster images
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
    bmp: 'image/bmp',
    avif: 'image/avif',
    heic: 'image/heic',
    heif: 'image/heif',
    svg: 'image/svg+xml',
    // Texture / HDR
    exr: 'image/x-exr',
    hdr: 'image/vnd.radiance',
    tga: 'image/x-tga',
    dds: 'image/vnd.ms-dds',
    // Design app native
    psd: 'image/vnd.adobe.photoshop',
    psb: 'image/vnd.adobe.photoshop',
    xcf: 'image/x-xcf',
    ai: 'application/postscript',
    eps: 'application/postscript',
    kra: 'application/octet-stream',
    blend: 'application/octet-stream',
    fbx: 'application/octet-stream',
    c4d: 'application/octet-stream',
    // 3D models
    gltf: 'model/gltf+json',
    glb: 'model/gltf-binary',
    obj: 'model/obj',
    stl: 'model/stl',
    dae: 'model/vnd.collada+xml',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    aac: 'audio/aac',
    m4a: 'audio/mp4',
    aiff: 'audio/aiff',
    // Documents
    pdf: 'application/pdf',
    json: 'application/json',
    txt: 'text/plain',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}
