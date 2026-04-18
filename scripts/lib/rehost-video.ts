/**
 * Shared helper: pin an ephemeral video URL (e.g. ByteDance Seedance presigned,
 * FAL ephemeral, etc.) to Pinata IPFS and return a permanent gateway URL.
 *
 * Generation providers return URLs that expire within hours-to-days. Any script
 * that calls `Universe.createNode(..., link, ...)` MUST rehost first, otherwise
 * the on-chain `link` points at dead storage once the presigned URL expires.
 *
 * No silent fallback — on failure this throws. Callers decide whether to retry
 * or skip the scene; writing an ephemeral URL on-chain is never correct.
 */
import { keccak256, toBytes } from 'viem';

const PINATA_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

export interface RehostResult {
  /** Permanent gateway URL — safe to write on-chain */
  url: string;
  /** IPFS CID */
  cid: string;
  /** keccak256 of the permanent URL (matches Universe.contentHash) */
  contentHash: `0x${string}`;
  /** Size in bytes of the fetched asset */
  size: number;
}

export interface RehostOptions {
  /** Filename for Pinata metadata (pattern: `<slug>.mp4`) */
  filename: string;
  /** Optional label used by Pinata metadata `name` for searching */
  pinName?: string;
  /** Download timeout in milliseconds (default: 120_000) */
  timeoutMs?: number;
  /** Pinata JWT — defaults to `process.env.PINATA_JWT` */
  pinataJwt?: string;
  /** Gateway override — defaults to `process.env.PINATA_GATEWAY_URL` or public gateway */
  gatewayUrl?: string;
}

export async function rehostVideoToPinata(
  sourceUrl: string,
  opts: RehostOptions
): Promise<RehostResult> {
  const jwt = opts.pinataJwt ?? process.env.PINATA_JWT;
  if (!jwt) throw new Error('PINATA_JWT not set — cannot rehost video');

  const timeoutMs = opts.timeoutMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let buffer: Buffer;
  try {
    const res = await fetch(sourceUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`video fetch failed: HTTP ${res.status} ${res.statusText}`);
    }
    const arrayBuf = await res.arrayBuffer();
    buffer = Buffer.from(new Uint8Array(arrayBuf));
  } finally {
    clearTimeout(timer);
  }

  if (buffer.length < 1024) {
    throw new Error(
      `video fetch too small (${buffer.length} bytes) — likely expired or error page`
    );
  }

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'video/mp4' }), opts.filename);
  form.append('pinataMetadata', JSON.stringify({ name: opts.pinName ?? opts.filename }));

  const pinRes = await fetch(PINATA_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: form,
  });

  if (!pinRes.ok) {
    const body = await pinRes.text().catch(() => '');
    throw new Error(`Pinata pin failed: HTTP ${pinRes.status} ${body.slice(0, 200)}`);
  }

  const { IpfsHash } = (await pinRes.json()) as { IpfsHash: string };
  const gateway =
    opts.gatewayUrl ?? process.env.PINATA_GATEWAY_URL ?? 'https://gateway.pinata.cloud';
  const url = `${gateway.replace(/\/$/, '')}/ipfs/${IpfsHash}`;

  return {
    url,
    cid: IpfsHash,
    contentHash: keccak256(toBytes(url)),
    size: buffer.length,
  };
}

/**
 * Detect whether a URL is an ephemeral provider URL that MUST be rehosted
 * before writing on-chain. Conservative — returns true for any known-ephemeral
 * pattern, false for already-permanent storage (Pinata, Lighthouse, etc).
 */
export function isEphemeralVideoUrl(url: string): boolean {
  if (!url) return false;
  // ByteDance Seedance presigned URLs
  if (url.includes('volces.com') && url.includes('X-Tos-Expires')) return true;
  // FAL temporary URLs
  if (url.includes('fal.media') || url.includes('fal.run')) return true;
  // Replicate delivery URLs (expire after ~24h)
  if (url.includes('replicate.delivery')) return true;
  // Anything with a presigned signature/expires query param
  if (/[?&](X-Amz-Expires|X-Tos-Expires|X-Goog-Expires|Expires)=/i.test(url)) return true;
  return false;
}
