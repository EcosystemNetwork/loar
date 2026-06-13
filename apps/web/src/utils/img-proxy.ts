// Server image-resize proxy helpers.
//
// The proxy (`GET /api/img`) fetches the original from our dedicated IPFS
// gateway, downscales with sharp, and content-negotiates AVIF/WebP. Routing
// `<img>` thumbnails through it turns a 1–3 MB full-resolution original into a
// few-hundred-KB rendition — the main lever for fast cold-cache grid loads.
//
// Only use this for IMAGES. Video sources and <video> posters that point at
// large media must NOT go through the proxy (it only transcodes still images).
import { resolveIpfsUrl, isIpfsGatewayUrl } from '@/utils/ipfs-url';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');

export const RESIZE_WIDTHS = [320, 480, 640, 960, 1280, 1600];

// The proxy only accepts recognized IPFS gateway URLs (SSRF guard). Local
// assets (/placeholder.jpg), data: URIs, and non-IPFS hosts pass through
// untouched so they still render.
function proxyable(src?: string | null): string | null {
  const resolved = resolveIpfsUrl(src);
  if (!SERVER_URL || !resolved) return null;
  return isIpfsGatewayUrl(resolved) ? resolved : null;
}

/**
 * Point a single image URL at the resize proxy at the given target width.
 * Returns the bare gateway/asset URL when the proxy can't serve it (no server
 * URL configured, or a non-IPFS source).
 */
export function proxiedImage(src?: string | null, width = 640): string {
  const target = proxyable(src);
  if (!target) return resolveIpfsUrl(src);
  return `${SERVER_URL}/api/img?url=${encodeURIComponent(target)}&w=${width}&format=auto`;
}

/**
 * Build a responsive srcset across the standard rendition widths. Returns
 * undefined when the proxy can't serve the source so the bare `src` stands in.
 */
export function proxiedSrcSet(src?: string | null): string | undefined {
  const target = proxyable(src);
  if (!target) return undefined;
  return RESIZE_WIDTHS.map(
    (w) => `${SERVER_URL}/api/img?url=${encodeURIComponent(target)}&w=${w} ${w}w`
  ).join(', ');
}
