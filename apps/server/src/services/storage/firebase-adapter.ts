import type { StorageProvider, UploadResult } from './types';
import { computeSha256, fetchToBuffer, getMimeType } from './types';
import { firebaseStorageService } from '../firebase-storage';

/**
 * Adapter wrapping the Firebase Storage service as a StorageProvider.
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
    const key = await firebaseStorageService.upload(buffer, filename);

    return {
      provider: this.name,
      contentId: key,
      contentHash,
      url: firebaseStorageService.getPublicUrl(key),
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
    return firebaseStorageService.download(key);
  }

  getPublicUrl(key: string): string {
    return firebaseStorageService.getPublicUrl(key);
  }
}
