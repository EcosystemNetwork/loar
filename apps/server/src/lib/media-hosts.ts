/**
 * Allowlist of hosts LOAR itself serves media from (clips, episode exports,
 * thumbnails, generated audio). Mirrors the `media-src` list in
 * `middleware/security-headers.ts` — keep the two in sync.
 *
 * Used to gate server-side proxy routes that fetch a user-supplied media URL
 * and stream the bytes back (e.g. `/api/clips/download`). Without this a
 * proxy route is an open forward proxy: an attacker can launder traffic
 * through the server's IP or (combined with a DNS-rebinding race) probe
 * internal services. `safeFetch()` closes the rebinding window; this closes
 * the "arbitrary public URL" hole.
 */

/** Exact hostnames that are always allowed. */
const EXACT_HOSTS = new Set<string>([
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  // Google-direct Veo ephemeral Files API (fallback path only).
  'generativelanguage.googleapis.com',
  'gateway.pinata.cloud',
  'ipfs.io',
  'w3s.link',
  'dweb.link',
]);

/** Suffixes (`host === suffix` or `host.endsWith('.' + suffix)`). */
const HOST_SUFFIXES = [
  'firebasestorage.app', // *.firebasestorage.app
  'pinata.cloud', // *.pinata.cloud / gateway.pinata.cloud
  'mypinata.cloud', // <subdomain>.mypinata.cloud
  'lighthouse.storage', // *.lighthouse.storage
  'fal.ai',
  'fal.media',
  'volces.com', // ByteDance/Volcengine TOS
  'w3s.link', // *.w3s.link / *.ipfs.w3s.link
  'dweb.link', // *.dweb.link / *.ipfs.dweb.link
];

/**
 * True when `rawUrl` is an https URL whose host is one LOAR serves media from.
 * Returns false for any parse error, non-https scheme, or unknown host.
 */
export function isAllowedMediaHost(rawUrl: string): boolean {
  let host: string;
  let protocol: string;
  try {
    const u = new URL(rawUrl);
    host = u.hostname.toLowerCase();
    protocol = u.protocol;
  } catch {
    return false;
  }
  if (protocol !== 'https:') return false;
  if (EXACT_HOSTS.has(host)) return true;
  return HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}
