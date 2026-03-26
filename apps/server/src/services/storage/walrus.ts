import type { StorageProvider, UploadResult } from "./types";
import { computeSha256, fetchToBuffer, getMimeType } from "./types";

const DEFAULT_PUBLISHER = "https://publisher.walrus-testnet.walrus.space";
const DEFAULT_AGGREGATOR = "https://aggregator.walrus-testnet.walrus.space";

// Circuit breaker constants
const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_BREAKER_RESET_MS = 60_000;

export class WalrusProvider implements StorageProvider {
  readonly name = "walrus";
  readonly priority = 1;

  private publisherUrl: string;
  private aggregatorUrl: string;
  private consecutiveFailures = 0;
  private lastFailureTime = 0;

  constructor() {
    this.publisherUrl =
      process.env.WALRUS_PUBLISHER_URL || DEFAULT_PUBLISHER;
    this.aggregatorUrl =
      process.env.WALRUS_AGGREGATOR_URL || DEFAULT_AGGREGATOR;
  }

  isAvailable(): boolean {
    if (
      this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES &&
      Date.now() - this.lastFailureTime < CIRCUIT_BREAKER_RESET_MS
    ) {
      return false;
    }
    return true;
  }

  async upload(
    buffer: Buffer,
    filename: string,
    _mimeType?: string
  ): Promise<UploadResult> {
    try {
      const contentHash = computeSha256(buffer);

      const response = await fetch(
        `${this.publisherUrl}/v1/blobs`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: new Uint8Array(buffer),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Walrus upload failed: HTTP ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json() as any;

      // Walrus returns either { newlyCreated: { blobObject: { blobId } } }
      // or { alreadyCertified: { blobId } }
      const blobId =
        result.newlyCreated?.blobObject?.blobId ??
        result.alreadyCertified?.blobId;

      if (!blobId) {
        throw new Error(
          `Walrus upload response missing blobId: ${JSON.stringify(result)}`
        );
      }

      // Reset circuit breaker on success
      this.consecutiveFailures = 0;

      return {
        provider: this.name,
        contentId: blobId,
        contentHash,
        url: this.getPublicUrl(blobId),
        size: buffer.length,
      };
    } catch (error) {
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();
      throw error;
    }
  }

  async uploadFromUrl(url: string, filename?: string): Promise<UploadResult> {
    const { buffer } = await fetchToBuffer(url);
    const resolvedFilename =
      filename || url.split("/").pop()?.split("?")[0] || `file-${Date.now()}`;
    return this.upload(buffer, resolvedFilename);
  }

  async download(blobId: string): Promise<Uint8Array> {
    const response = await fetch(
      `${this.aggregatorUrl}/v1/blobs/${blobId}`
    );

    if (!response.ok) {
      throw new Error(
        `Walrus download failed: HTTP ${response.status}`
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  getPublicUrl(blobId: string): string {
    return `${this.aggregatorUrl}/v1/blobs/${blobId}`;
  }
}
