/**
 * Video Thumbnail Extraction
 *
 * Pulls a single frame out of a video URL via ffmpeg and uploads it through
 * the StorageManager (Pinata → Lighthouse → Firebase fallback). Returns the
 * public URL or null on any failure — callers treat null as "no cover yet".
 *
 * Shared by:
 *   - routers/generation/generation.routes.ts (auto-publish to gallery)
 *   - services/content-cover-image.ts         (ensureContentThumbnail)
 *   - scripts/generate-missing-thumbnails.ts  (backfill)
 */

import { getStorageManager } from './storage';

export interface ExtractVideoThumbnailOptions {
  /** Seconds into the video to grab. Defaults to 0.5. */
  seekSeconds?: number;
  /** Target width in px; height is scaled to preserve aspect. Defaults to 640. */
  width?: number;
  /** ffmpeg subprocess timeout in ms. Defaults to 15s. */
  timeoutMs?: number;
  /** UID attributed as the uploader in the storage manifest. Defaults to 'system'. */
  uploaderUid?: string;
}

export async function extractVideoThumbnail(
  videoUrl: string,
  idHint: string,
  options: ExtractVideoThumbnailOptions = {}
): Promise<string | null> {
  const seek = options.seekSeconds ?? 0.5;
  const width = options.width ?? 640;
  const timeout = options.timeoutMs ?? 15000;
  const uploaderUid = options.uploaderUid ?? 'system';

  try {
    // Only accept HTTPS URLs. ffmpeg's default protocol set includes `file:`,
    // `concat:`, `subfile:`, HLS-with-nested-`file:`, etc., which let an
    // attacker-controlled `videoUrl` read local files into the encoded frame
    // (env-var dumps, service-account JSON, /proc/self/environ).
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(videoUrl);
    } catch {
      return null;
    }
    if (parsedUrl.protocol !== 'https:') {
      console.warn(`[thumbnail] rejecting non-https videoUrl for ${idHint}`);
      return null;
    }

    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { readFile, unlink } = await import('fs/promises');
    const execFileAsync = promisify(execFile);

    const outPath = join(tmpdir(), `thumb-${idHint}.jpg`);

    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        // Belt-and-braces — even if a future caller slips a non-https URL
        // through, ffmpeg will refuse to open `file:` / `concat:` / etc.
        '-protocol_whitelist',
        'https,tls,tcp',
        '-i',
        videoUrl,
        '-ss',
        String(seek),
        '-frames:v',
        '1',
        '-q:v',
        '2',
        '-vf',
        `scale=${width}:-1`,
        outPath,
      ],
      { timeout }
    );

    const thumbBuffer = await readFile(outPath);
    unlink(outPath).catch(() => {});

    const manager = getStorageManager();
    const filename = `thumb-${idHint}.jpg`;
    const manifest = await manager.upload(thumbBuffer, filename, 'image/jpeg', uploaderUid);
    return manifest.uploads[0]?.url || null;
  } catch (err) {
    console.warn(`[thumbnail] Failed to extract thumbnail for ${idHint}:`, (err as Error).message);
    return null;
  }
}
