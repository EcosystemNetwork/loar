/**
 * Worker-thread entry for GLB optimisation. Simplification is synchronous
 * WASM (seconds on a 2M-triangle mesh) — off the main thread so API
 * requests keep flowing. One message in, one out; the parent terminates
 * the worker afterwards so its memory is returned.
 *
 * Bundled as its own esbuild entry (see apps/server/Dockerfile).
 */
import { parentPort } from 'node:worker_threads';
import { optimizeGlb, type OptimizeGlbOptions } from './optimize-core';

parentPort?.on('message', async (msg: { input: ArrayBuffer; options?: OptimizeGlbOptions }) => {
  try {
    const { buffer, stats } = await optimizeGlb(new Uint8Array(msg.input), msg.options);
    // Copy into a standalone ArrayBuffer so it can be transferred.
    const out = buffer.slice().buffer;
    parentPort!.postMessage({ ok: true, output: out, stats }, [out]);
  } catch (err) {
    parentPort!.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
