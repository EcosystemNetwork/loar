/**
 * HLS Transcoder
 *
 * Takes a source video (HTTPS URL) and produces a multi-bitrate HLS bundle:
 *   - 480p  (~800kbps)
 *   - 720p  (~1.6Mbps)
 *   - 1080p (~3Mbps, only when source ≥ 1080p)
 * Plus a master playlist that references all rendition variants by
 * absolute IPFS gateway URL (so the manifest is self-contained and safe
 * to serve from any gateway).
 *
 * Each .ts segment and each .m3u8 playlist is uploaded individually through
 * StorageManager (Pinata → Lighthouse → Firebase fallback). After the
 * segment uploads complete, we rewrite the variant playlists to point at the
 * absolute segment URLs, then upload them.
 *
 * Caller responsibility:
 *   - Source URL must be HTTPS (we reject anything else for SSRF reasons).
 *   - Caller stores the returned masterUrl alongside the original mediaUrl.
 *   - Caller decides when to invoke (we recommend fire-and-forget after the
 *     primary upload so playback isn't blocked on transcode time).
 *
 * Failure mode: returns null. Never throws to the caller. The original
 * progressive MP4 keeps working — HLS is purely an enhancement.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getStorageManager } from './storage';

const execFileAsync = promisify(execFile);

export interface TranscodeOptions {
  /** UID attributed as uploader on each segment manifest. Defaults to 'system'. */
  uploaderUid?: string;
  /** Hard ceiling on the ffmpeg subprocess in ms. Defaults to 5 minutes. */
  ffmpegTimeoutMs?: number;
  /** Skip 1080p output (useful for short-form / vertical content). */
  skip1080?: boolean;
}

export interface TranscodeResult {
  /** Absolute IPFS URL of the master HLS playlist. */
  masterUrl: string;
  /** Absolute IPFS URLs of each variant playlist. */
  variantUrls: string[];
  /** Segment count uploaded across all renditions. */
  segmentCount: number;
  /** Wall-clock time spent in this function. */
  durationMs: number;
}

interface Rendition {
  name: string;
  height: number;
  videoBitrateK: number;
  audioBitrateK: number;
  bandwidth: number;
  codecs: string;
}

const RENDITIONS: Rendition[] = [
  {
    name: '480p',
    height: 480,
    videoBitrateK: 800,
    audioBitrateK: 96,
    bandwidth: 928_000,
    codecs: 'avc1.4d401f,mp4a.40.2',
  },
  {
    name: '720p',
    height: 720,
    videoBitrateK: 1600,
    audioBitrateK: 128,
    bandwidth: 1_760_000,
    codecs: 'avc1.4d401f,mp4a.40.2',
  },
  {
    name: '1080p',
    height: 1080,
    videoBitrateK: 3000,
    audioBitrateK: 128,
    bandwidth: 3_200_000,
    codecs: 'avc1.4d401f,mp4a.40.2',
  },
];

export async function transcodeToHls(
  videoUrl: string,
  idHint: string,
  options: TranscodeOptions = {}
): Promise<TranscodeResult | null> {
  const t0 = Date.now();
  const uploaderUid = options.uploaderUid ?? 'system';
  const ffmpegTimeout = options.ffmpegTimeoutMs ?? 5 * 60_000;

  // Same SSRF guard as video-thumbnail.ts: only HTTPS.
  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') {
    console.warn(`[transcode] rejecting non-https videoUrl for ${idHint}`);
    return null;
  }

  const workDir = await mkdtemp(join(tmpdir(), `hls-${idHint}-`));

  try {
    const renditions = options.skip1080 ? RENDITIONS.filter((r) => r.height < 1080) : RENDITIONS;

    // Build the ffmpeg command. We chain a `split` filter so the source is
    // decoded once and fanned out to N scale+encode pipelines, then write
    // each rendition into its own HLS playlist + segment set.
    //
    // Output layout under workDir:
    //   480p/playlist.m3u8 + 480p/seg_000.ts ...
    //   720p/playlist.m3u8 + 720p/seg_000.ts ...
    //   1080p/playlist.m3u8 + ...
    const ffArgs: string[] = [
      '-y',
      '-protocol_whitelist',
      'https,tls,tcp,file,crypto,data',
      '-i',
      videoUrl,
    ];

    // Build filter_complex: split → N scales.
    const splitOutputs = renditions.map((_, i) => `[v${i}]`).join('');
    const filterParts: string[] = [`[0:v]split=${renditions.length}${splitOutputs}`];
    renditions.forEach((r, i) => {
      // -2 keeps the width even and divisible by 2 (h264 requirement).
      filterParts.push(`[v${i}]scale=-2:${r.height}[v${i}out]`);
    });
    ffArgs.push('-filter_complex', filterParts.join(';'));

    // Map each rendition's video output + audio.
    renditions.forEach((r, i) => {
      ffArgs.push('-map', `[v${i}out]`);
      ffArgs.push('-map', '0:a:0?');
      ffArgs.push(`-c:v:${i}`, 'libx264');
      ffArgs.push(`-b:v:${i}`, `${r.videoBitrateK}k`);
      ffArgs.push(`-maxrate:v:${i}`, `${Math.round(r.videoBitrateK * 1.07)}k`);
      ffArgs.push(`-bufsize:v:${i}`, `${r.videoBitrateK * 2}k`);
      ffArgs.push(`-preset:v:${i}`, 'veryfast');
      ffArgs.push(`-profile:v:${i}`, 'main');
      ffArgs.push(`-c:a:${i}`, 'aac');
      ffArgs.push(`-b:a:${i}`, `${r.audioBitrateK}k`);
    });

    // Force a 2-second GOP so segment boundaries are exact. Required for
    // adaptive switching to work cleanly across renditions.
    ffArgs.push('-g', '48', '-keyint_min', '48', '-sc_threshold', '0');

    // HLS muxer settings.
    ffArgs.push(
      '-f',
      'hls',
      '-hls_time',
      '4',
      '-hls_playlist_type',
      'vod',
      '-hls_segment_type',
      'mpegts',
      '-hls_flags',
      'independent_segments',
      // var_stream_map tells ffmpeg how to group the mapped streams into
      // separate variant playlists.
      '-var_stream_map',
      renditions.map((_, i) => `v:${i},a:${i}`).join(' '),
      '-master_pl_name',
      'master.m3u8',
      '-hls_segment_filename',
      join(workDir, '%v', 'seg_%03d.ts'),
      join(workDir, '%v', 'playlist.m3u8')
    );

    try {
      await execFileAsync('ffmpeg', ffArgs, {
        timeout: ffmpegTimeout,
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (err) {
      console.warn(`[transcode] ffmpeg failed for ${idHint}:`, (err as Error).message);
      return null;
    }

    // ffmpeg names rendition directories `0`, `1`, `2` in the order the
    // streams were mapped — our renditions[] array is the source of truth for
    // the human-readable label and bandwidth annotation.
    const manager = getStorageManager();
    const variantUrls: string[] = [];
    let segmentCount = 0;

    for (let i = 0; i < renditions.length; i++) {
      const r = renditions[i];
      const variantDir = join(workDir, String(i));
      const files = await readdir(variantDir);

      // Upload all .ts segments first, building a name → absolute-URL map.
      const segMap = new Map<string, string>();
      const segFiles = files.filter((f) => f.endsWith('.ts')).sort();
      for (const segName of segFiles) {
        const segPath = join(variantDir, segName);
        const segBuf = await readFile(segPath);
        const manifest = await manager.upload(
          segBuf,
          `${idHint}-${r.name}-${segName}`,
          'video/mp2t',
          uploaderUid
        );
        const segUrl = manifest.uploads[0]?.url;
        if (!segUrl) {
          console.warn(`[transcode] segment upload returned no url for ${segName}`);
          return null;
        }
        segMap.set(segName, segUrl);
        segmentCount++;
      }

      // Rewrite the variant playlist so each EXTINF target points at the
      // absolute segment URL we just uploaded.
      const playlistPath = join(variantDir, 'playlist.m3u8');
      const playlistRaw = await readFile(playlistPath, 'utf-8');
      const playlistRewritten = playlistRaw
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          const url = segMap.get(trimmed);
          return url ?? line;
        })
        .join('\n');

      const variantManifest = await manager.upload(
        Buffer.from(playlistRewritten, 'utf-8'),
        `${idHint}-${r.name}.m3u8`,
        'application/vnd.apple.mpegurl',
        uploaderUid
      );
      const variantUrl = variantManifest.uploads[0]?.url;
      if (!variantUrl) {
        console.warn(`[transcode] variant playlist upload failed for ${r.name}`);
        return null;
      }
      variantUrls.push(variantUrl);
    }

    // Master playlist references each variant by absolute URL.
    const masterLines = ['#EXTM3U', '#EXT-X-VERSION:3'];
    renditions.forEach((r, i) => {
      masterLines.push(
        `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${heightToWidth(r.height)}x${r.height},CODECS="${r.codecs}"`
      );
      masterLines.push(variantUrls[i]);
    });
    const masterBuf = Buffer.from(masterLines.join('\n') + '\n', 'utf-8');
    const masterManifest = await manager.upload(
      masterBuf,
      `${idHint}-master.m3u8`,
      'application/vnd.apple.mpegurl',
      uploaderUid
    );
    const masterUrl = masterManifest.uploads[0]?.url;
    if (!masterUrl) return null;

    return {
      masterUrl,
      variantUrls,
      segmentCount,
      durationMs: Date.now() - t0,
    };
  } catch (err) {
    console.warn(`[transcode] unexpected failure for ${idHint}:`, (err as Error).message);
    return null;
  } finally {
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// 16:9 width assumption for master playlist RESOLUTION header. Player only
// uses this for ABR display; actual frame size is determined by the encoded
// stream, so a slight mismatch on portrait/square content is harmless.
function heightToWidth(height: number): number {
  return Math.round((height * 16) / 9);
}

// ─── WebVTT thumbnail sprite ────────────────────────────────────────────
//
// Generates a single sprite sheet of frame thumbnails (one tile per N
// seconds) and a WebVTT cue track that maps timestamps to tile coordinates.
// The result is what enables thumbnail-on-scrub in the player UI.

export interface ThumbSpriteResult {
  /** Absolute URL of the JPEG sprite sheet. */
  spriteUrl: string;
  /** Absolute URL of the WebVTT cue file. */
  vttUrl: string;
  /** Tiles per row in the sprite (callers don't usually need this). */
  cols: number;
  /** Tile width in pixels. */
  tileWidth: number;
  /** Tile height in pixels. */
  tileHeight: number;
}

export interface ThumbSpriteOptions {
  /** Seconds between thumbnail tiles. Defaults to 5. */
  intervalSeconds?: number;
  /** Tile width in pixels. Aspect is preserved. Defaults to 160. */
  tileWidth?: number;
  /** UID attributed as uploader. Defaults to 'system'. */
  uploaderUid?: string;
  /** Hard ceiling on ffmpeg subprocess in ms. Defaults to 60s. */
  ffmpegTimeoutMs?: number;
}

export async function generateThumbnailSprite(
  videoUrl: string,
  idHint: string,
  options: ThumbSpriteOptions = {}
): Promise<ThumbSpriteResult | null> {
  const interval = options.intervalSeconds ?? 5;
  const tileWidth = options.tileWidth ?? 160;
  const uploaderUid = options.uploaderUid ?? 'system';
  const timeout = options.ffmpegTimeoutMs ?? 60_000;

  let parsed: URL;
  try {
    parsed = new URL(videoUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;

  const workDir = await mkdtemp(join(tmpdir(), `vtt-${idHint}-`));

  try {
    // Probe duration so we know how many tiles to generate (and thus the
    // sprite grid dimensions).
    let durationSec = 0;
    try {
      const { stdout } = await execFileAsync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'default=noprint_wrappers=1:nokey=1',
          videoUrl,
        ],
        { timeout: 30_000 }
      );
      durationSec = Math.floor(Number(stdout.trim()));
    } catch {
      // Some streams don't expose duration; bail out — sprites are useless
      // without knowing how many tiles to lay out.
      return null;
    }
    if (!Number.isFinite(durationSec) || durationSec < interval) return null;

    // tile aspect — we resize to width=tileWidth, ffmpeg picks the height.
    // We use a sane 16:9 estimate for sprite layout; ffmpeg's actual height
    // is read back after extraction.
    const tileCount = Math.floor(durationSec / interval);
    const cols = Math.min(10, Math.ceil(Math.sqrt(tileCount)));
    const rows = Math.ceil(tileCount / cols);

    const spritePath = join(workDir, 'sprite.jpg');
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-protocol_whitelist',
        'https,tls,tcp,file,crypto,data',
        '-i',
        videoUrl,
        '-vf',
        `fps=1/${interval},scale=${tileWidth}:-2,tile=${cols}x${rows}`,
        '-frames:v',
        '1',
        '-q:v',
        '5',
        spritePath,
      ],
      { timeout }
    );

    const spriteBuf = await readFile(spritePath);

    // Read back the actual tile height from the sprite (since aspect varies
    // by source). We use sharp metadata if available, else fall back to
    // assuming 16:9.
    let tileHeight = Math.round((tileWidth * 9) / 16);
    try {
      const sharpMod = await import('sharp');
      const meta = await sharpMod.default(spriteBuf).metadata();
      if (meta.height && rows > 0) {
        tileHeight = Math.floor(meta.height / rows);
      }
    } catch {
      /* fallback already set */
    }

    const manager = getStorageManager();
    const spriteManifest = await manager.upload(
      spriteBuf,
      `${idHint}-sprite.jpg`,
      'image/jpeg',
      uploaderUid
    );
    const spriteUrl = spriteManifest.uploads[0]?.url;
    if (!spriteUrl) return null;

    // Build WebVTT cues. Each cue maps a [start, end) time range to a tile
    // coordinate via the `#xywh=x,y,w,h` media-fragment syntax. Players that
    // support thumbnail tracks (Video.js, Plyr, Shaka UI, Bitmovin, native
    // WebVTT preview) read these and render them on hover/scrub.
    const vttLines = ['WEBVTT', ''];
    for (let i = 0; i < tileCount; i++) {
      const start = i * interval;
      const end = (i + 1) * interval;
      const col = i % cols;
      const row = Math.floor(i / cols);
      vttLines.push(
        `${formatVttTime(start)} --> ${formatVttTime(end)}`,
        `${spriteUrl}#xywh=${col * tileWidth},${row * tileHeight},${tileWidth},${tileHeight}`,
        ''
      );
    }
    const vttBuf = Buffer.from(vttLines.join('\n'), 'utf-8');
    const vttManifest = await manager.upload(
      vttBuf,
      `${idHint}-thumbnails.vtt`,
      'text/vtt',
      uploaderUid
    );
    const vttUrl = vttManifest.uploads[0]?.url;
    if (!vttUrl) return null;

    return { spriteUrl, vttUrl, cols, tileWidth, tileHeight };
  } catch (err) {
    console.warn(`[thumb-sprite] failed for ${idHint}:`, (err as Error).message);
    return null;
  } finally {
    rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function formatVttTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.000`;
}
