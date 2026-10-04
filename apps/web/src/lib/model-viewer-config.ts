/**
 * Global <model-viewer> configuration — import before '@google/model-viewer'.
 *
 * Generated 3D models are served as web-optimised copies compressed with
 * EXT_meshopt_compression (apps/server/src/services/tripo-world/optimize-core.ts).
 * model-viewer only decodes those when told where the decoder script lives,
 * and its CDN defaults are blocked by our CSP, so it's self-hosted
 * (public/decoders/meshopt_decoder.js — keep in sync with the server's
 * pinned `meshoptimizer` version).
 */
export const MESHOPT_DECODER_PATH = '/decoders/meshopt_decoder.js';

if (typeof self !== 'undefined') {
  const g = self as unknown as { ModelViewerElement?: Record<string, unknown> };
  g.ModelViewerElement = {
    ...(g.ModelViewerElement ?? {}),
    meshoptDecoderLocation: MESHOPT_DECODER_PATH,
  };
}
