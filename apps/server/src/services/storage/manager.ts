import { db } from '../../lib/firebase';
import type {
  StorageProvider,
  StorageManifest,
  UploadResult,
  ProviderAttempt,
  UploadTrace,
} from './types';
import { computeSha256, fetchToBuffer, getMimeType } from './types';
import { validateUploadUrl } from '../../lib/url-validator';
import { PinataProvider } from './ipfs';
import { LighthouseProvider } from './lighthouse';
import { FirebaseAdapter } from './firebase-adapter';
import { getCostLedger } from './cost-ledger';

const MANIFESTS_COLLECTION = 'storageManifests';

// How long to wait for a HEAD verification request (ms).
const VERIFY_TIMEOUT_MS = 8_000;

// Max attempts per provider in the background redundancy path.
const BG_MAX_RETRIES = 2;
const BG_RETRY_DELAYS = [5_000, 15_000];

/** Default provider priority order. Can be overridden via STORAGE_PROVIDER_PRIORITY env. */
function buildProviders(): StorageProvider[] {
  const all: StorageProvider[] = [
    new PinataProvider(),
    new LighthouseProvider(),
    new FirebaseAdapter(),
  ];

  // Allow reordering via env: "pinata,lighthouse,firebase"
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

/**
 * Verify a URL is accessible with a HEAD request.
 * Returns true if HTTP 200–399, false on error or timeout.
 */
async function headVerify(url: string): Promise<boolean> {
  try {
    // SSRF protection — reject private/internal addresses before making the request
    await validateUploadUrl(url);

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    const res = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'error' });
    clearTimeout(tid);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
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

  async upload(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    userId?: string
  ): Promise<StorageManifest> {
    const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200MB
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error(
        `File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB exceeds 200MB limit`
      );
    }

    const uploadStart = Date.now();
    const contentHash = computeSha256(buffer);
    const resolvedMime = mimeType || getMimeType(filename);

    // Deduplication — check if already uploaded
    const existing = await this.findManifest(contentHash);
    if (existing) {
      console.log(`[StorageManager] Dedup hit for ${contentHash.slice(0, 12)}…`);
      // Return with a lightweight trace indicating cache hit
      return {
        ...existing,
        trace: {
          contentHash,
          attempts: [],
          primaryProvider: existing.uploads[0]?.provider ?? 'unknown',
          totalDurationMs: Date.now() - uploadStart,
          verified: false,
          fromCache: true,
        },
      };
    }

    const available = this.providers.filter((p) => p.isAvailable());
    const skipped = this.providers.filter((p) => !p.isAvailable());

    if (available.length === 0) {
      throw new Error('No storage providers available');
    }

    const attempts: ProviderAttempt[] = [];

    // Record skipped providers in the trace
    for (const p of skipped) {
      attempts.push({ provider: p.name, status: 'skipped', durationMs: 0 });
    }

    // Try providers in priority order until one succeeds
    let primaryResult: UploadResult | null = null;
    const results: UploadResult[] = [];

    for (const provider of available) {
      const t0 = Date.now();
      try {
        console.log(`[StorageManager] Uploading to ${provider.name}…`);
        const result = await provider.upload(buffer, filename, resolvedMime);
        const durationMs = Date.now() - t0;

        // Post-upload HEAD verification
        const verified = await headVerify(result.url);
        if (!verified) {
          console.warn(
            `[StorageManager] ${provider.name} upload succeeded but HEAD verify failed for ${result.url}`
          );
        }

        attempts.push({
          provider: provider.name,
          status: 'success',
          durationMs,
          contentId: result.contentId,
          url: result.url,
          verified,
        });

        results.push(result);
        primaryResult = result;

        // Record cost
        void getCostLedger().recordUpload({
          provider: provider.name,
          bytes: buffer.length,
          contentHash,
          userId,
        });

        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const durationMs = Date.now() - t0;
        console.error(`[StorageManager] ${provider.name} failed (${durationMs}ms): ${msg}`);
        attempts.push({ provider: provider.name, status: 'failed', durationMs, error: msg });
      }
    }

    if (!primaryResult) {
      const failedList = attempts
        .filter((a) => a.status === 'failed')
        .map((a) => `  ${a.provider}: ${a.error}`)
        .join('\n');
      throw new Error(`All storage providers failed:\n${failedList}`);
    }

    const trace: UploadTrace = {
      contentHash,
      attempts,
      primaryProvider: primaryResult.provider,
      totalDurationMs: Date.now() - uploadStart,
      verified: attempts.some((a) => a.status === 'success' && a.verified),
      fromCache: false,
    };

    // Build manifest (trace stored in Firestore too)
    const manifest: StorageManifest = {
      contentHash,
      uploads: results,
      originalFilename: filename,
      mimeType: resolvedMime,
      size: buffer.length,
      createdAt: Date.now(),
      trace,
    };

    await this.saveManifest(manifest);

    // Background: upload to remaining providers for redundancy
    const remaining = available.filter((p) => !results.some((r) => r.provider === p.name));
    if (remaining.length > 0) {
      this.uploadToRemainingProviders(
        buffer,
        filename,
        resolvedMime,
        contentHash,
        remaining,
        userId
      );
    }

    return manifest;
  }

  async uploadFromUrl(url: string, filename?: string, userId?: string): Promise<StorageManifest> {
    const { buffer, contentType } = await fetchToBuffer(url);
    const resolvedFilename =
      filename || url.split('/').pop()?.split('?')[0] || `file-${Date.now()}`;
    return this.upload(buffer, resolvedFilename, contentType, userId);
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
    mimeType?: string,
    userId?: string
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

    void getCostLedger().recordUpload({
      provider: 'firebase',
      bytes: buffer.length,
      contentHash,
      userId,
    });

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

  async uploadToGalleryFromUrl(
    url: string,
    filename?: string,
    userId?: string
  ): Promise<StorageManifest> {
    const { buffer, contentType } = await fetchToBuffer(url);
    const resolvedFilename =
      filename || url.split('/').pop()?.split('?')[0] || `file-${Date.now()}`;
    return this.uploadToGallery(buffer, resolvedFilename, contentType, userId);
  }

  // ─── Pin to IPFS (for NFT minting) ─────────────────────────

  /**
   * Pin existing content to IPFS for permanent on-chain storage.
   * Called when a user mints their content as an NFT.
   * Returns the IPFS CID and updated manifest.
   */
  async pinToIPFS(
    contentHash: string,
    userId?: string
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

    void getCostLedger().record({
      userId,
      contentHash,
      operation: 'pin_ipfs',
      provider: 'pinata',
      bytes: buffer.length,
      estimatedUploadCostUsd: 0,
      estimatedMonthlyCostUsd: (0.000195 * buffer.length) / (1024 * 1024),
      totalCostUsd: (0.000195 * buffer.length) / (1024 * 1024),
      createdAt: Date.now(),
    });

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
    remaining: StorageProvider[],
    userId?: string
  ): void {
    for (const provider of remaining) {
      this.uploadWithRetry(provider, buffer, filename, mimeType, BG_MAX_RETRIES)
        .then(async (result) => {
          console.log(
            `[StorageManager] Background upload to ${provider.name} succeeded (contentId=${result.contentId})`
          );

          void getCostLedger().recordUpload({
            provider: provider.name,
            bytes: buffer.length,
            contentHash,
            userId,
            metadata: { background: true },
          });

          try {
            const manifest = await this.findManifest(contentHash);
            if (manifest) {
              manifest.uploads.push(result);
              await this.saveManifest(manifest);
            }
          } catch {
            // Non-critical — manifest update best-effort
          }
        })
        .catch((err) => {
          console.error(
            `[StorageManager] Background upload to ${provider.name} permanently failed: ${
              err instanceof Error ? err.message : err
            }`
          );
        });
    }
  }

  /**
   * Upload to a single provider with exponential backoff retry.
   * Used for background redundancy uploads.
   */
  private async uploadWithRetry(
    provider: StorageProvider,
    buffer: Buffer,
    filename: string,
    mimeType: string,
    maxRetries: number
  ): Promise<UploadResult> {
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = BG_RETRY_DELAYS[attempt - 1] ?? 15_000;
        console.log(
          `[StorageManager] Retrying ${provider.name} background upload in ${delay}ms (attempt ${attempt}/${maxRetries})`
        );
        await new Promise((r) => setTimeout(r, delay));
      }

      try {
        return await provider.upload(buffer, filename, mimeType);
      } catch (err) {
        lastErr = err;
        console.warn(
          `[StorageManager] ${provider.name} background attempt ${attempt + 1} failed: ${
            err instanceof Error ? err.message : err
          }`
        );
      }
    }

    throw lastErr;
  }
}

export function getStorageManager(): StorageManager {
  return StorageManager.getInstance();
}
