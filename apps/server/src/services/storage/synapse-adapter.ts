import type { StorageProvider, UploadResult } from "./types";
import { computeSha256, fetchToBuffer } from "./types";
import { getSynapseService } from "../synapse";

/**
 * Adapter wrapping the existing SynapseService as a StorageProvider.
 * Does NOT rewrite synapse logic — reuses the proven circuit breaker implementation.
 */
export class SynapseAdapter implements StorageProvider {
  readonly name = "synapse";
  readonly priority = 3;

  isAvailable(): boolean {
    return !!process.env.PRIVATE_KEY;
  }

  async upload(
    buffer: Buffer,
    _filename: string,
    _mimeType?: string
  ): Promise<UploadResult> {
    const contentHash = computeSha256(buffer);
    const service = await getSynapseService();
    const pieceCid = await service.upload(buffer);

    return {
      provider: this.name,
      contentId: pieceCid,
      contentHash,
      url: this.getPublicUrl(pieceCid),
      size: buffer.length,
    };
  }

  async uploadFromUrl(url: string, filename?: string): Promise<UploadResult> {
    const { buffer } = await fetchToBuffer(url);
    return this.upload(buffer, filename || "file");
  }

  async download(pieceCid: string): Promise<Uint8Array> {
    const service = await getSynapseService();
    return service.download(pieceCid);
  }

  getPublicUrl(pieceCid: string): string {
    // Synapse HTTP gateway convention
    return `https://calibration.synapse.filoz.org/api/filecoin/${pieceCid}`;
  }
}
