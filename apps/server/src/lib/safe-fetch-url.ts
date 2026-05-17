/**
 * Basic SSRF guard for user-supplied URLs the server itself dereferences
 * (transcription, image-to-3D, etc).
 *
 * Rejects:
 *   - non-http(s) schemes (file://, gopher://, ftp://, etc.)
 *   - loopback hosts (localhost, 127.0.0.1, 0.0.0.0, ::1)
 *   - RFC1918 IPv4 ranges (10/8, 172.16/12, 192.168/16)
 *   - AWS / GCP IMDS host (169.254.169.254)
 *   - IPv6 unique-local (fc00::/7) and link-local (fe80::/10) prefixes
 *   - IPv4-mapped IPv6 (::ffff:127.0.0.1)
 *   - Decimal / hex / octal IPv4 encodings (e.g. 2130706433, 0x7f000001, 0177.0.0.1)
 *
 * IMPORTANT: This is a basic syntactic guard, NOT a complete SSRF defense.
 * It does NOT protect against:
 *   - DNS rebinding (host resolves to a public IP at validation time, then
 *     to an internal IP at fetch time)
 *   - HTTP redirects to internal addresses (we only inspect the input URL)
 *   - DNS lookups returning private IPs for public hostnames
 *
 * For full SSRF protection use an egress proxy that resolves the hostname,
 * blocks if the IP is private, and forbids upstream redirects to non-public
 * addresses.
 */

function isPrivateOrLoopbackIPv4(octets: number[]): boolean {
  if (octets.length !== 4) return false;
  const [a, b] = octets;
  if (a === 127 || a === 0 || a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * Parse an IPv4 host in any of: dotted-quad (127.0.0.1), single decimal
 * (2130706433), single hex (0x7f000001), single octal (017700000001), or
 * mixed dotted with hex/octal parts (0x7f.0.0.1, 0177.0.0.1).
 *
 * Returns the four octets, or null if the host doesn't parse as any IPv4 form.
 */
function parseIPv4Variants(host: string): number[] | null {
  const lower = host.toLowerCase();
  const parts = lower.split('.');

  const parsePart = (s: string): number | null => {
    if (s.length === 0) return null;
    let n: number;
    if (s.startsWith('0x')) {
      if (!/^0x[0-9a-f]+$/.test(s)) return null;
      n = parseInt(s.slice(2), 16);
    } else if (s.length > 1 && s.startsWith('0')) {
      if (!/^0[0-7]+$/.test(s)) return null;
      n = parseInt(s.slice(1), 8);
    } else {
      if (!/^\d+$/.test(s)) return null;
      n = parseInt(s, 10);
    }
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
  };

  if (parts.length === 1) {
    const n = parsePart(parts[0]);
    if (n === null || n < 0 || n > 0xffffffff) return null;
    return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  }
  if (parts.length === 4) {
    const octets: number[] = [];
    for (const p of parts) {
      const n = parsePart(p);
      if (n === null || n > 255) return null;
      octets.push(n);
    }
    return octets;
  }
  return null;
}

export function assertSafeExternalUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('URL: only http(s) allowed');
  }
  let host = url.hostname.toLowerCase();
  // Strip IPv6 brackets if present
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host === 'localhost' || host === '0.0.0.0' || host === '127.0.0.1' || host === '::1') {
    throw new Error('URL: loopback rejected');
  }

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (host.startsWith('::ffff:') || host.startsWith('0000:0000:0000:0000:0000:ffff:')) {
    const tail = host.slice(host.indexOf(':ffff:') + 6);
    const octets = parseIPv4Variants(tail);
    if (octets && isPrivateOrLoopbackIPv4(octets)) {
      throw new Error('URL: private/metadata host rejected');
    }
    // Also try parsing the tail as 2x hex words (e.g. 7f00:1 => 127.0.0.1)
    const hexParts = tail.split(':');
    if (
      hexParts.length === 2 &&
      /^[0-9a-f]{1,4}$/.test(hexParts[0]) &&
      /^[0-9a-f]{1,4}$/.test(hexParts[1])
    ) {
      const hi = parseInt(hexParts[0], 16);
      const lo = parseInt(hexParts[1], 16);
      const mapped = [(hi >>> 8) & 0xff, hi & 0xff, (lo >>> 8) & 0xff, lo & 0xff];
      if (isPrivateOrLoopbackIPv4(mapped)) {
        throw new Error('URL: private/metadata host rejected');
      }
    }
    throw new Error('URL: IPv4-mapped IPv6 rejected');
  }

  // Decimal / hex / octal / dotted IPv4 in any encoding
  const ipv4 = parseIPv4Variants(host);
  if (ipv4) {
    if (isPrivateOrLoopbackIPv4(ipv4)) {
      throw new Error('URL: private/metadata host rejected');
    }
    // Reject non-dotted-quad encodings outright as a defense-in-depth measure —
    // decimal/hex/octal forms have no legitimate use and are a common SSRF
    // bypass vector even when the numeric value resolves to a public address.
    const dotted = ipv4.join('.');
    if (host !== dotted) {
      throw new Error('URL: non-canonical IPv4 encoding rejected');
    }
  }

  if (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    host === '169.254.169.254'
  ) {
    throw new Error('URL: private/metadata host rejected');
  }
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    throw new Error('URL: private IPv6 rejected');
  }
  return url;
}
