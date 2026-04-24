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
  // IPv4-mapped IPv6 — `::ffff:127.0.0.1` and friends. dns.resolve6 can
  // return these for hostnames that have an A record but no AAAA record.
  /^::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|0\.)/i,
];

const BLOCKED_HOSTNAMES = ['localhost', 'metadata.google.internal'];

export interface ValidatedUrl {
  /** Parsed URL (hostname, port, path preserved). */
  parsed: URL;
  /** The first IP that passed the private-range check — callers should pin
   *  outgoing connections to this exact address to prevent DNS rebinding
   *  between validation and fetch. */
  pinnedIp: string;
  /** IP family for the pinned address (4 or 6), for undici.Agent.connect.lookup. */
  family: 4 | 6;
}

/**
 * Validates a URL for safe server-side fetching (SSRF prevention).
 * Rejects private IPs, localhost, and metadata endpoints.
 *
 * Returns only the parsed URL so callers that forward the URL to an external
 * API (fal, Gemini, etc.) can stay unchanged. Callers that *themselves* fetch
 * the URL should prefer {@link validateAndPinUrl} + {@link safeFetch} to
 * close the DNS-rebinding TOCTOU window.
 */
export async function validateUploadUrl(url: string): Promise<URL> {
  const { parsed } = await validateAndPinUrl(url);
  return parsed;
}

/**
 * Same checks as {@link validateUploadUrl}, plus returns the resolved IP so
 * the caller can pin the outgoing connection. Prevents DNS-rebinding:
 *   1. validate resolves the hostname → IP_A (public, passes).
 *   2. attacker flips the DNS record → IP_B (169.254.169.254).
 *   3. unpinned `fetch(url)` re-resolves and hits IP_B.
 * By reusing `pinnedIp` from step 1, the connection cannot be redirected.
 */
export async function validateAndPinUrl(url: string): Promise<ValidatedUrl> {
  const parsed = new URL(url);

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed');
  }

  if (BLOCKED_HOSTNAMES.includes(parsed.hostname)) {
    throw new Error('URL hostname is not allowed');
  }

  // Resolve DNS (both IPv4 and IPv6) and check for private IPs
  let ipv4Addrs: string[] = [];
  let ipv6Addrs: string[] = [];
  try {
    [ipv4Addrs, ipv6Addrs] = await Promise.all([
      dns.resolve4(parsed.hostname).catch(() => [] as string[]),
      dns.resolve6(parsed.hostname).catch(() => [] as string[]),
    ]);
  } catch (err) {
    throw err instanceof Error ? err : new Error('Could not validate URL for safe fetching');
  }

  const allAddresses = [...ipv4Addrs, ...ipv6Addrs];
  if (allAddresses.length === 0) {
    throw new Error('Could not resolve hostname');
  }

  // Every resolved address must pass — we cannot let the connection pick a
  // bad one at random. Also track the first clean address for pinning.
  for (const addr of allAddresses) {
    for (const range of PRIVATE_IP_RANGES) {
      if (range.test(addr)) {
        throw new Error('URL resolves to a private address');
      }
    }
  }

  // Prefer IPv4 for pinning (wider compatibility). If only IPv6 resolved, use that.
  const pinnedIp = ipv4Addrs[0] ?? ipv6Addrs[0]!;
  const family: 4 | 6 = ipv4Addrs.includes(pinnedIp) ? 4 : 6;
  return { parsed, pinnedIp, family };
}

/**
 * Validates + fetches a URL without re-resolving DNS between the check and
 * the connection. Closes the rebinding TOCTOU — see {@link validateAndPinUrl}.
 *
 * Usage mirrors `fetch` but returns the already-buffered response body so
 * the dispatcher can be disposed immediately.
 */
export async function safeFetch(
  url: string,
  init: Omit<RequestInit, 'dispatcher'> = {}
): Promise<Response> {
  const { parsed, pinnedIp, family } = await validateAndPinUrl(url);
  // Dynamic import — undici is vendored by Node 20+ but importing unconditionally
  // pulls it into bundles where only validateUploadUrl is used.
  const { Agent } = await import('undici');
  const dispatcher = new Agent({
    connect: {
      // Force the outgoing TCP connection to use the IP we just validated.
      // Node passes a lookup shaped like dns.lookup's callback form.
      lookup: (_hostname, _options, cb) =>
        cb(null, pinnedIp as unknown as string, family as unknown as number),
    },
  });
  // `dispatcher` is an undici-specific fetch option recognised by Node 20+.
  // Cast because the DOM RequestInit lib types don't expose it.
  return fetch(parsed.toString(), {
    ...init,
    redirect: init.redirect ?? 'error',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatcher,
  } as any);
}
