/**
 * Storacha storage provider — decentralized hot storage on Filecoin+IPFS via w3up.
 * Priority 3 (redundancy / archive resilience layer).
 *
 * Requires:
 *   STORACHA_KEY   — base64url-encoded Ed25519 private key
 *                    (generate: npx w3 key create)
 *   STORACHA_PROOF — base64-encoded delegation CAR proof
 *                    (generate: npx w3 delegation create <did> --can 'upload/add' | base64)
 *
 * One-time setup:
 *   npx w3 key create                          # outputs STORACHA_KEY + DID
 *   npx w3 login you@email.com                 # authenticate with Storacha
 *   npx w3 space create loar                   # create storage space
 *   npx w3 delegation create <did> \
 *     --can 'upload/add' --can 'filecoin/offer' | base64   # outputs STORACHA_PROOF
 */
import type { StorageProvider, UploadResult } from './types';
import { computeSha256, fetchToBuffer, getMimeType } from './types';

const GATEWAY = 'https://w3s.link';

export class StorachaProvider implements StorageProvider {
  readonly name = 'storacha';
  readonly priority = 3;

  private key: string;
  private proof: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;

  constructor() {
    this.key = process.env.STORACHA_KEY || '';
    this.proof = process.env.STORACHA_PROOF || '';
  }

  isAvailable(): boolean {
    return !!(this.key && this.proof);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async getClient(): Promise<any> {
    if (this.client) return this.client;

    const { create } = await import('@web3-storage/w3up-client');
    const { StoreMemory } = await import('@web3-storage/w3up-client/stores/memory');
    const Proof = await import('@web3-storage/w3up-client/proof');
    const ed = await import('@ucanto/principal/ed25519');

    const principal = ed.Signer.parse(this.key);
    const store = new StoreMemory();
    const client = await create({ principal, store });

    const proofBytes = Buffer.from(this.proof, 'base64');
    const proof = await Proof.parse(new Uint8Array(proofBytes));
    const space = await client.addSpace(proof);
    await client.setCurrentSpace(space.did());

    this.client = client;
    return client;
  }

  async upload(buffer: Buffer, filename: string, mimeType?: string): Promise<UploadResult> {
    const contentHash = computeSha256(buffer);
    const resolvedMime = mimeType || getMimeType(filename);

    const client = await this.getClient();
    const file = new File([new Uint8Array(buffer)], filename, { type: resolvedMime });
    const cid = await client.uploadFile(file);
    const cidString = cid.toString();

    return {
      provider: this.name,
      contentId: cidString,
      contentHash,
      url: this.getPublicUrl(cidString),
      size: buffer.length,
    };
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
      throw new Error(`Storacha download failed: HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  getPublicUrl(cid: string): string {
    return `${GATEWAY}/ipfs/${cid}`;
  }
}
