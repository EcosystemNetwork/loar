import type { StorageProvider, UploadResult } from './types';
import { computeSha256, fetchToBuffer, getMimeType } from './types';
import { minioService } from '../minio';

/**
 * Adapter wrapping the existing Firebase Storage service (minio.ts) as a StorageProvider.
 * Acts as the reliable centralized fallback (priority 4).
 */
export class FirebaseAdapter implements StorageProvider {
  readonly name = 'firebase';
  readonly priority = 4;

  isAvailable(): boolean {
    return !!process.env.FIREBASE_STORAGE_BUCKET;
  }

  async upload(buffer: Buffer, filename: string, _mimeType?: string): Promise<UploadResult> {
    const contentHash = computeSha256(buffer);
    const key = await minioService.upload(buffer, filename);

    return {
      provider: this.name,
      contentId: key,
      contentHash,
      url: minioService.getPublicUrl(key),
      size: buffer.length,
    };
  }

  async uploadFromUrl(url: string, filename?: string): Promise<UploadResult> {
    const { buffer } = await fetchToBuffer(url);
    const resolvedFilename =
      filename || url.split('/').pop()?.split('?')[0] || `file-${Date.now()}.mp4`;
    return this.upload(buffer, resolvedFilename);
  }

  async download(key: string): Promise<Uint8Array> {
    return minioService.download(key);
  }

  getPublicUrl(key: string): string {
    return minioService.getPublicUrl(key);
  }
}
