import { db } from '../../lib/firebase';
import type { StorageProvider, StorageManifest, UploadResult } from './types';
import { computeSha256, fetchToBuffer, getMimeType } from './types';
import { PinataProvider } from './ipfs';
import { LighthouseProvider } from './lighthouse';
import { StorachaProvider } from './storacha';
import { FirebaseAdapter } from './firebase-adapter';

const MANIFESTS_COLLECTION = 'storageManifests';

/** Default provider priority order. Can be overridden via STORAGE_PROVIDER_PRIORITY env. */
function buildProviders(): StorageProvider[] {
  const all: StorageProvider[] = [
    new PinataProvider(),
    new LighthouseProvider(),
    new StorachaProvider(),
    new FirebaseAdapter(),
  ];

  // Allow reordering via env: "pinata,lighthouse,storacha,firebase"
  const order = process.env.STORAGE_PROVIDER_PRIORITY?.split(',').map((s) =>
    s.trim().toLowerCase()
  );

  if (order?.length) {
    all.sort((a, b) => {
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
  } else {
    all.sort((a, b) => a.priority - b.priority);
  }

  return all;
}

export class StorageManager {
  private static instance: StorageManager | null = null;
  private providers: StorageProvider[];

  private constructor() {
    this.providers = buildProviders();

    const available = this.providers.filter((p) => p.isAvailable()).map((p) => p.name);
    console.log(
      `[StorageManager] Initialized with providers (priority order): ${this.providers.map((p) => p.name).join(', ')}`
    );
    console.log(`[StorageManager] Currently available: ${available.join(', ') || 'none'}`);
  }

  static getInstance(): StorageManager {
    if (!this.instance) {
      this.instance = new StorageManager();
    }
    return this.instance;
  }

  // ─── Upload ───────────────────────────────────────────────

  async upload(buffer: Buffer, filename: string, mimeType?: string): Promise<StorageManifest> {
    const contentHash = computeSha256(buffer);
    const resolvedMime = mimeType || getMimeType(filename);

    // Deduplication — check if already uploaded
    const existing = await this.findManifest(contentHash);
    if (existing) {
      console.log(`[StorageManager] Dedup hit for ${contentHash.slice(0, 12)}…`);
      return existing;
    }

    const available = this.providers.filter((p) => p.isAvailable());
    if (available.length === 0) {
      throw new Error('No storage providers available');
    }

    // Try providers in priority order until one succeeds
    let primaryResult: UploadResult | null = null;
    const results: UploadResult[] = [];
    const errors: string[] = [];

    for (const provider of available) {
      try {
        console.log(`[StorageManager] Uploading to ${provider.name}…`);
        const result = await provider.upload(buffer, filename, resolvedMime);
        results.push(result);
        primaryResult = result;
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[StorageManager] ${provider.name} failed: ${msg}`);
        errors.push(`${provider.name}: ${msg}`);
      }
    }

    if (!primaryResult) {
      throw new Error(`All storage providers failed:\n${errors.join('\n')}`);
    }

    // Build manifest
    const manifest: StorageManifest = {
      contentHash,
      uploads: results,
      originalFilename: filename,
      mimeType: resolvedMime,
      size: buffer.length,
      createdAt: Date.now(),
    };

    // Save manifest to Firestore
    await this.saveManifest(manifest);

    // Background: upload to remaining providers for redundancy
    const remaining = available.filter((p) => !results.some((r) => r.provider === p.name));
    if (remaining.length > 0) {
      this.uploadToRemainingProviders(buffer, filename, resolvedMime, contentHash, remaining);
    }

    return manifest;
  }

  async uploadFromUrl(url: string, filename?: string): Promise<StorageManifest> {
    const { buffer, contentType } = await fetchToBuffer(url);
    const resolvedFilename =
      filename || url.split('/').pop()?.split('?')[0] || `file-${Date.now()}`;
    return this.upload(buffer, resolvedFilename, contentType);
  }

  // ─── Firebase-Only Upload (for gallery/dashboard content) ──

  /**
   * Upload content to Firebase only. Used for gallery/dashboard content
   * that doesn't need permanent on-chain storage yet.
   * Content stays mutable and cheap until the user decides to mint.
   */
  async uploadToGallery(
    buffer: Buffer,
    filename: string,
    mimeType?: string
  ): Promise<StorageManifest> {
    const contentHash = computeSha256(buffer);
    const resolvedMime = mimeType || getMimeType(filename);

    const existing = await this.findManifest(contentHash);
    if (existing) return existing;

    const firebase = this.providers.find((p) => p.name === 'firebase');
    if (!firebase?.isAvailable()) {
      throw new Error('Firebase storage is not available');
    }

    const result = await firebase.upload(buffer, filename, resolvedMime);

    const manifest: StorageManifest = {
      contentHash,
      uploads: [result],
      originalFilename: filename,
      mimeType: resolvedMime,
      size: buffer.length,
      createdAt: Date.now(),
    };

    await this.saveManifest(manifest);
    return manifest;
  }

  async uploadToGalleryFromUrl(url: string, filename?: string): Promise<StorageManifest> {
    const { buffer, contentType } = await fetchToBuffer(url);
    const resolvedFilename =
      filename || url.split('/').pop()?.split('?')[0] || `file-${Date.now()}`;
    return this.uploadToGallery(buffer, resolvedFilename, contentType);
  }

  // ─── Pin to IPFS (for NFT minting) ─────────────────────────

  /**
   * Pin existing content to IPFS for permanent on-chain storage.
   * Called when a user mints their content as an NFT.
   * Returns the IPFS CID and updated manifest.
   */
  async pinToIPFS(
    contentHash: string
  ): Promise<{ cid: string; url: string; manifest: StorageManifest }> {
    const manifest = await this.findManifest(contentHash);
    if (!manifest) {
      throw new Error(`No manifest found for contentHash: ${contentHash}`);
    }

    // Check if already pinned to IPFS
    const existingIpfs = manifest.uploads.find((u) => u.provider === 'pinata');
    if (existingIpfs) {
      return { cid: existingIpfs.contentId, url: existingIpfs.url, manifest };
    }

    // Download from existing provider and re-upload to IPFS
    const ipfs = this.providers.find((p) => p.name === 'pinata');
    if (!ipfs?.isAvailable()) {
      throw new Error('IPFS provider is not available');
    }

    const data = await this.download(contentHash);
    const buffer = Buffer.from(data);
    const result = await ipfs.upload(
      buffer,
      manifest.originalFilename || `nft-${contentHash.slice(0, 12)}`,
      manifest.mimeType
    );

    // Append IPFS upload to manifest
    manifest.uploads.push(result);
    await this.saveManifest(manifest);

    return { cid: result.contentId, url: result.url, manifest };
  }

  // ─── Resolve & Download ───────────────────────────────────

  /** Resolve a contentHash to the best available URL. */
  async resolve(contentHash: string): Promise<string | null> {
    const manifest = await this.findManifest(contentHash);
    if (!manifest || manifest.uploads.length === 0) return null;
    return manifest.uploads[0].url;
  }

  /** Download content by contentHash, trying each provider in the manifest. */
  async download(contentHash: string): Promise<Uint8Array> {
    const manifest = await this.findManifest(contentHash);
    if (!manifest) {
      throw new Error(`No manifest found for contentHash: ${contentHash}`);
    }

    for (const upload of manifest.uploads) {
      const provider = this.providers.find((p) => p.name === upload.provider);
      if (!provider?.isAvailable()) continue;

      try {
        return await provider.download(upload.contentId);
      } catch (err) {
        console.error(`[StorageManager] Download from ${upload.provider} failed:`, err);
      }
    }

    throw new Error(`All providers failed to download contentHash: ${contentHash}`);
  }

  // ─── Manifest Persistence ─────────────────────────────────

  async findManifest(contentHash: string): Promise<StorageManifest | null> {
    try {
      const doc = await db.collection(MANIFESTS_COLLECTION).doc(contentHash).get();

      if (!doc.exists) return null;
      return doc.data() as StorageManifest;
    } catch {
      return null;
    }
  }

  async getManifest(contentHash: string): Promise<StorageManifest | null> {
    return this.findManifest(contentHash);
  }

  private async saveManifest(manifest: StorageManifest): Promise<void> {
    try {
      await db
        .collection(MANIFESTS_COLLECTION)
        .doc(manifest.contentHash)
        .set(manifest, { merge: true });
    } catch (err) {
      console.error('[StorageManager] Failed to save manifest:', err);
    }
  }

  // ─── Background Redundancy ────────────────────────────────

  private uploadToRemainingProviders(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    contentHash: string,
    remaining: StorageProvider[]
  ): void {
    // Fire-and-forget background uploads
    for (const provider of remaining) {
      provider
        .upload(buffer, filename, mimeType)
        .then(async (result) => {
          console.log(`[StorageManager] Background upload to ${provider.name} succeeded`);

          // Append to manifest
          try {
            const manifest = await this.findManifest(contentHash);
            if (manifest) {
              manifest.uploads.push(result);
              await this.saveManifest(manifest);
            }
          } catch {
            // Non-critical
          }
        })
        .catch((err) => {
          console.error(
            `[StorageManager] Background upload to ${provider.name} failed:`,
            err instanceof Error ? err.message : err
          );
        });
    }
  }
}

export function getStorageManager(): StorageManager {
  return StorageManager.getInstance();
}
