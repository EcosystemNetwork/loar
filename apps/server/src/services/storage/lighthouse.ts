/**
 * Lighthouse storage provider — permanent Filecoin+IPFS storage with encryption
 * and token-gated access control. Priority 2 (permanent source-of-truth).
 * Requires LIGHTHOUSE_API_KEY env var.
 */
import type { StorageProvider, UploadResult } from './types';
import { computeSha256, fetchToBuffer, getMimeType } from './types';

const UPLOAD_URL = 'https://node.lighthouse.storage/api/v0/add';
const GATEWAY = 'https://gateway.lighthouse.storage';

const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_BREAKER_RESET_MS = 60_000;

export class LighthouseProvider implements StorageProvider {
  readonly name = 'lighthouse';
  readonly priority = 2;

  private apiKey: string;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  constructor() {
    this.apiKey = process.env.LIGHTHOUSE_API_KEY || '';
  }

  isAvailable(): boolean {
    if (!this.apiKey) return false;
    if (
      this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES &&
      Date.now() - this.lastFailureTime < CIRCUIT_BREAKER_RESET_MS
    ) {
      return false;
    }
    return true;
  }

  async upload(buffer: Buffer, filename: string, mimeType?: string): Promise<UploadResult> {
    try {
      const contentHash = computeSha256(buffer);
      const resolvedMime = mimeType || getMimeType(filename);

      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: resolvedMime });
      formData.append('file', blob, filename);

      const response = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Lighthouse upload failed: HTTP ${response.status} — ${body}`);
      }

      const result = (await response.json()) as { Hash: string; Size: number };

      this.consecutiveFailures = 0;

      return {
        provider: this.name,
        contentId: result.Hash,
        contentHash,
        url: this.getPublicUrl(result.Hash),
        size: result.Size,
      };
    } catch (error) {
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();
      throw error;
    }
  }

  async uploadFromUrl(url: string, filename?: string): Promise<UploadResult> {
    const { buffer, contentType } = await fetchToBuffer(url);
    const resolvedFilename =
      filename || url.split('/').pop()?.split('?')[0] || `file-${Date.now()}`;
    return this.upload(buffer, resolvedFilename, contentType);
  }

  async download(cid: string): Promise<Uint8Array> {
    const response = await fetch(`${GATEWAY}/ipfs/${cid}`);
    if (!response.ok) {
      throw new Error(`Lighthouse download failed: HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  getPublicUrl(cid: string): string {
    return `${GATEWAY}/ipfs/${cid}`;
  }
}
