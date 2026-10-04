/**
 * Produce web-delivery copies of generated GLBs (see optimize-core.ts).
 *
 * Runs each optimisation in a short-lived worker thread, one at a time —
 * a 60 MB mesh peaks at ~800 MB RSS, so parallel runs would starve the API
 * process. Production loads the bundled worker (dist/…/optimize.worker.js);
 * dev/tests (tsx, vitest) have only the .ts source, which a worker thread
 * can't load with its extensionless imports, so they run on the main thread.
 *
 * `webOptimizeUrl` never throws: a failed optimisation just means the
 * viewer keeps using the original GLB. When the original is already
 * web-sized it returns the original URL itself (so callers record "done").
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { authorizedMediaUrl } from '../ffmpeg/clip-pipeline';
import { optimizeGlb, type OptimizeGlbOptions, type OptimizeGlbStats } from './optimize-core';

const WORKER_TIMEOUT_MS = 3 * 60 * 1000;
/** Below this the original is already web-sized — don't bother. */
const MIN_INPUT_BYTES = 3 * 1024 * 1024;
const MAX_INPUT_BYTES = 300 * 1024 * 1024;

/** Bundled worker entry, if this is a build that has one. */
function workerFile(): string | null {
  const candidates = [
    // esbuild bundle: this code lives in dist/index.js, worker at dist/services/…
    new URL('./services/tripo-world/optimize.worker.js', import.meta.url),
    // unbundled JS next to this file
    new URL('./optimize.worker.js', import.meta.url),
  ];
  for (const url of candidates) {
    if (url.protocol !== 'file:') continue;
    const path = fileURLToPath(url);
    if (existsSync(path)) return path;
  }
  return null;
}

function runInWorker(
  input: Uint8Array,
  options?: OptimizeGlbOptions
): Promise<{ buffer: Uint8Array; stats: OptimizeGlbStats }> {
  const file = workerFile();
  if (!file) return optimizeGlb(input, options);
  return new Promise((resolve, reject) => {
    const worker = new Worker(file);
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new Error(`GLB optimisation timed out after ${WORKER_TIMEOUT_MS / 1000}s`));
    }, WORKER_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      void worker.terminate();
    };
    worker.once('message', (msg: any) => {
      done();
      if (msg?.ok) resolve({ buffer: new Uint8Array(msg.output), stats: msg.stats });
      else reject(new Error(msg?.error ?? 'GLB optimisation failed'));
    });
    worker.once('error', (err) => {
      done();
      reject(err);
    });
    const copy = input.slice().buffer;
    worker.postMessage({ input: copy, options }, [copy]);
  });
}

// One optimisation at a time, process-wide.
let chain: Promise<unknown> = Promise.resolve();
export function optimizeGlbQueued(
  input: Uint8Array,
  options?: OptimizeGlbOptions
): Promise<{ buffer: Uint8Array; stats: OptimizeGlbStats }> {
  const next = chain.then(() => runInWorker(input, options));
  chain = next.catch(() => undefined);
  return next;
}

/**
 * Download a permanent GLB, optimise it and upload the display copy.
 * Returns the copy's URL; the original `url` when it's already small enough
 * that a copy isn't worth it; null when optimisation failed (callers keep
 * the original and may try again later). `storeUpload` is injectable.
 */
export async function webOptimizeUrl(
  url: string | null | undefined,
  filename: string,
  userId: string,
  deps: {
    storeUpload?: (buf: Buffer, filename: string, userId: string) => Promise<string | null>;
  } = {}
): Promise<string | null> {
  if (!url) return null;
  try {
    const res = await fetch(authorizedMediaUrl(url));
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const input = new Uint8Array(await res.arrayBuffer());
    if (input.byteLength < MIN_INPUT_BYTES) return url;
    if (input.byteLength > MAX_INPUT_BYTES) return null;
    const { buffer, stats } = await optimizeGlbQueued(input);
    // Not worth a second copy when it barely shrank.
    if (stats.outputBytes > stats.inputBytes * 0.8) return url;
    const upload = deps.storeUpload ?? defaultUpload;
    const webUrl = await upload(Buffer.from(buffer), webFilename(filename), userId);
    console.log(
      `[tripo-world] optimised ${filename}: ${(stats.inputBytes / 1e6).toFixed(1)} MB → ` +
        `${(stats.outputBytes / 1e6).toFixed(1)} MB, ${stats.trianglesIn} → ${stats.trianglesOut} tris, ${stats.ms} ms`
    );
    return webUrl;
  } catch (err) {
    console.error(`[tripo-world] web optimisation of ${filename} failed (keeping original):`, err);
    return null;
  }
}

export function webFilename(filename: string): string {
  return filename.replace(/\.glb$/i, '') + '-web.glb';
}

async function defaultUpload(buf: Buffer, filename: string, userId: string) {
  const { getStorageManager } = await import('../storage');
  const manifest = await getStorageManager().upload(buf, filename, 'model/gltf-binary', userId);
  return manifest.uploads[0]?.url ?? null;
}
