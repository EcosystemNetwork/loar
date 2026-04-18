/**
 * Layer 4 — storage
 * Checks: uploadDirect (base64 tiny PNG), resolve contentHash, getManifest.
 * Identifies: StorageManager misconfiguration, Firebase Storage failure,
 *             Pinata/Lighthouse credential issues.
 *
 * All checks use the protected tRPC procedures — requires a valid JWT.
 */
import type { SmokeConfig } from '../config.ts';
import { tRPCMutate, tRPCQuery } from '../client.ts';
import { TINY_PNG_BASE64, TINY_PNG_MIME, TINY_PNG_FILENAME } from '../fixtures.ts';
import { check, type CheckResult } from '../reporter.ts';

interface StorageManifest {
  contentHash: string;
  uploads: Array<{ provider: string; url: string; size: number }>;
  mimeType: string;
  size: number;
}

export interface StorageResult {
  contentHash: string | undefined;
  resolvedUrl: string | undefined;
  checks: CheckResult[];
}

export async function runStorageLayer(cfg: SmokeConfig, token: string): Promise<StorageResult> {
  const results: CheckResult[] = [];
  let contentHash: string | undefined;
  let resolvedUrl: string | undefined;

  // 1. uploadDirect — base64 1×1 PNG via tRPC
  results.push(
    await check('storage.uploadDirect → manifest returned', async () => {
      if (!token) throw new Error('no JWT — auth layer failed');
      const manifest = await tRPCMutate<StorageManifest>(
        cfg,
        'storage.uploadDirect',
        {
          data: TINY_PNG_BASE64,
          filename: TINY_PNG_FILENAME,
          mimeType: TINY_PNG_MIME,
        },
        token
      );

      const m = manifest as Record<string, unknown>;
      contentHash = m?.contentHash as string | undefined;
      const uploads = (m?.uploads as unknown[]) ?? [];

      if (!contentHash) throw new Error('no contentHash in manifest');
      if (uploads.length === 0) throw new Error('no uploads in manifest');

      const providers = uploads
        .map((u) => (u as Record<string, unknown>).provider)
        .filter(Boolean)
        .join(', ');
      return `hash=${contentHash.slice(0, 12)}… providers=[${providers}]`;
    })
  );

  if (!contentHash) return { contentHash, resolvedUrl, checks: results };

  // 2. storage.resolve — contentHash → URL
  results.push(
    await check('storage.resolve → URL returned', async () => {
      const result = await tRPCQuery<{ url: string | null }>(cfg, 'storage.resolve', {
        contentHash,
      });
      const url = (result as Record<string, unknown>)?.url as string | undefined;
      if (!url) throw new Error('resolve returned null URL');
      resolvedUrl = url;
      return url.slice(0, 60) + (url.length > 60 ? '…' : '');
    })
  );

  // 3. storage.getManifest — full manifest from Firestore
  results.push(
    await check('storage.getManifest → manifest persisted in Firestore', async () => {
      const manifest = await tRPCQuery<StorageManifest | null>(cfg, 'storage.getManifest', {
        contentHash,
      });
      if (!manifest) throw new Error('manifest not found in Firestore');
      const m = manifest as Record<string, unknown>;
      const size = m?.size as number | undefined;
      const mime = m?.mimeType as string | undefined;
      if (!size) throw new Error('manifest missing size');
      return `size=${size}B mime=${mime}`;
    })
  );

  return { contentHash, resolvedUrl, checks: results };
}
