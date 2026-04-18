import { URL } from 'url';
import dns from 'dns/promises';

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00/,
  /^fe80/,
];

const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal'];

/**
 * Validates a URL for safe server-side fetching (SSRF prevention).
 * Rejects private IPs, localhost, and metadata endpoints.
 */
export async function validateUploadUrl(url: string): Promise<URL> {
  const parsed = new URL(url);

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed');
  }

  if (BLOCKED_HOSTNAMES.includes(parsed.hostname)) {
    throw new Error('URL hostname is not allowed');
  }

  // Resolve DNS (both IPv4 and IPv6) and check for private IPs
  try {
    const [ipv4Addrs, ipv6Addrs] = await Promise.all([
      dns.resolve4(parsed.hostname).catch(() => [] as string[]),
      dns.resolve6(parsed.hostname).catch(() => [] as string[]),
    ]);
    const allAddresses = [...ipv4Addrs, ...ipv6Addrs];

    if (allAddresses.length === 0) {
      throw new Error('Could not resolve hostname');
    }

    for (const addr of allAddresses) {
      for (const range of PRIVATE_IP_RANGES) {
        if (range.test(addr)) {
          throw new Error('URL resolves to a private address');
        }
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('private') || err.message.includes('resolve'))
    ) {
      throw err;
    }
    // DNS resolution failure for non-private reasons — let it pass
    // (the actual fetch will fail with a more descriptive error)
  }

  return parsed;
}
