import type { StorageProvider, UploadResult } from './types';
import { computeSha256, fetchToBuffer, getMimeType } from './types';

const DEFAULT_GATEWAY = 'https://gateway.pinata.cloud';

// Circuit breaker
const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_BREAKER_RESET_MS = 60_000;

export class IpfsProvider implements StorageProvider {
  readonly name = 'ipfs';
  readonly priority = 2;

  private jwt: string;
  private gatewayUrl: string;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  constructor() {
    this.jwt = process.env.PINATA_JWT || '';
    this.gatewayUrl = process.env.PINATA_GATEWAY_URL || DEFAULT_GATEWAY;
  }

  isAvailable(): boolean {
    if (!this.jwt) return false;
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

      // Pinata v2 pinning API
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: resolvedMime });
      formData.append('file', blob, filename);

      const metadata = JSON.stringify({ name: filename });
      formData.append('pinataMetadata', metadata);

      const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.jwt}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Pinata upload failed: HTTP ${response.status} — ${body}`);
      }

      const result = (await response.json()) as {
        IpfsHash: string;
        PinSize: number;
      };

      // Reset circuit breaker on success
      this.consecutiveFailures = 0;

      return {
        provider: this.name,
        contentId: result.IpfsHash,
        contentHash,
        url: this.getPublicUrl(result.IpfsHash),
        size: result.PinSize,
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
    const response = await fetch(`${this.gatewayUrl}/ipfs/${cid}`);

    if (!response.ok) {
      throw new Error(`IPFS download failed: HTTP ${response.status}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  getPublicUrl(cid: string): string {
    return `${this.gatewayUrl}/ipfs/${cid}`;
  }
}
