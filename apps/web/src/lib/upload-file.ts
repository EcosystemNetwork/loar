import { hasSession } from '@/lib/wallet-auth';

export interface StorageManifest {
  contentHash: string;
  uploads: { provider: string; url: string; contentId: string; size: number }[];
  mimeType: string;
  size: number;
  createdAt: number;
}

/**
 * Upload one file to the decentralized-storage endpoint and report progress.
 * Throws with a readable message on auth or network failure; does not toast —
 * callers decide how to surface it.
 */
export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<StorageManifest> {
  if (!hasSession()) throw new Error('Authentication required');
  const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

  // Pre-flight: verify the session cookie before uploading. Avoids cryptic
  // HTTP/2 protocol errors when the server rejects auth mid-upload on
  // Railway's edge proxy.
  const meRes = await fetch(`${serverUrl}/auth/me`, { credentials: 'include' });
  if (!meRes.ok || !(await meRes.json()).authenticated) {
    throw new Error('Session expired — please sign in again');
  }

  const formData = new FormData();
  formData.append('file', file);

  const result = await new Promise<{ manifest: StorageManifest }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('Invalid response'));
        }
      } else {
        try {
          reject(new Error(JSON.parse(xhr.responseText).error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
    xhr.open('POST', `${serverUrl}/api/upload`);
    xhr.withCredentials = true; // send httpOnly session cookie
    xhr.send(formData);
  });
  return result.manifest;
}

/** Video containers the studio accepts on drop. */
export const VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
];
