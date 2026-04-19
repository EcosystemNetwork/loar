/**
 * Firebase Cloud Storage service — singleton wrapper around Google Cloud Storage bucket.
 * Handles file upload, download, and public URL generation for media assets.
 */
import { getStorage } from 'firebase-admin/storage';
// @ts-expect-error firebase-admin/storage re-exports this type
import type { Bucket } from '@google-cloud/storage';

const BUCKET_NAME = process.env.FIREBASE_STORAGE_BUCKET || '';

/**
 * Sanitize a client-supplied filename so it cannot escape the `videos/` prefix
 * in the GCS key. Strips directory separators, leading dots (prevents `..`
 * segments after any CDN path normalization), and non-safe characters while
 * preserving the extension for MIME detection.
 */
function sanitizeGcsFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop() || '';
  const cleaned = basename
    .replace(/\0/g, '')
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 255);
  return cleaned || `file-${Date.now()}`;
}

class StorageService {
  private static instance: StorageService | null = null;
  private _bucket: Bucket | null = null;

  private get bucket(): Bucket {
    if (!this._bucket) {
      if (!BUCKET_NAME) {
        throw new Error('FIREBASE_STORAGE_BUCKET not set — file storage unavailable');
      }
      this._bucket = getStorage().bucket(BUCKET_NAME);
    }
    return this._bucket;
  }

  static getInstance(): StorageService {
    if (!this.instance) {
      this.instance = new StorageService();
    }
    return this.instance;
  }

  async upload(buffer: Buffer, filename: string): Promise<string> {
    const safeFilename = sanitizeGcsFilename(filename);
    const key = `videos/${safeFilename}`;
    const file = this.bucket.file(key);

    await file.save(buffer, {
      contentType: this.getContentType(safeFilename),
      metadata: { cacheControl: 'public, max-age=31536000' },
    });

    await file.makePublic();

    return key;
  }

  async uploadFromUrl(url: string, filename?: string): Promise<string> {
    const { validateUploadUrl } = await import('../lib/url-validator');
    await validateUploadUrl(url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LOARUploader/1.0)' },
      signal: controller.signal,
      redirect: 'error', // Prevent SSRF bypass via 3xx to internal metadata endpoints
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const urlFilename =
      filename || url.split('/').pop()?.split('?')[0] || `video-${Date.now()}.mp4`;

    return await this.upload(buffer, urlFilename);
  }

  async download(key: string): Promise<Uint8Array> {
    if (!key || key.length < 1) {
      throw new Error(`Invalid key: ${key}`);
    }

    const file = this.bucket.file(key);
    const [data] = await file.download();

    if (data.length === 0) {
      throw new Error(`Empty file for key: ${key}`);
    }

    if (data.length > 200 * 1024 * 1024) {
      throw new Error(`File too large: ${Math.round(data.length / 1024 / 1024)}MB`);
    }

    return new Uint8Array(data);
  }

  getPublicUrl(key: string): string {
    return `https://storage.googleapis.com/${BUCKET_NAME}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const [exists] = await this.bucket.file(key).exists();
      return exists;
    } catch {
      return false;
    }
  }

  private getContentType(filename: string): string {
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
}

export const firebaseStorageService = StorageService.getInstance();
