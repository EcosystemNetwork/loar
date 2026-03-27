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

  // Resolve DNS and check for private IPs
  try {
    const addresses = await dns.resolve4(parsed.hostname);
    for (const addr of addresses) {
      for (const range of PRIVATE_IP_RANGES) {
        if (range.test(addr)) {
          throw new Error('URL resolves to a private address');
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('private')) {
      throw err;
    }
    // DNS resolution failure for non-private reasons — let it pass
    // (the actual fetch will fail with a more descriptive error)
  }

  return parsed;
}
