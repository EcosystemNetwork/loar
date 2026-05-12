/**
 * SIWS (Sign-In With Solana) authentication.
 *
 * Parallel to lib/siwe.ts. Verifies an ed25519 signature over a CAIP-122 /
 * SIWx-shaped message, consumes the same nonce store as SIWE so a single
 * user can have linked EVM + Solana identities sharing nonce inventory.
 *
 * Issues JWTs via the existing siwe.ts issueSessionToken() with
 * namespace='solana' — the rest of the auth pipeline (verifyAuth, ctx.user)
 * picks up the chain-namespace branching automatically.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { consumeNonce, generateNonce } from './siwe';
import { SOLANA_GENESIS_HASH, type SolanaCluster } from '@loar/abis/chain';

// Re-export nonce generation so frontend can use one /auth/nonce endpoint.
export { generateNonce };

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Domains accepted in SIWS line 1 — same allowlist as SIWE. */
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const ALLOWED_DOMAINS = new Set(
  (() => {
    const raw = process.env.SIWE_ALLOWED_DOMAINS || 'localhost,loar.fun';
    const domains = raw
      .split(',')
      .map((d) => d.trim())
      .filter((d) => d.length > 0 && DOMAIN_RE.test(d));
    if (process.env.NODE_ENV === 'production') {
      const filtered = domains.filter((d) => d !== 'localhost');
      if (filtered.length === 0) {
        throw new Error(
          'SIWE_ALLOWED_DOMAINS must contain at least one non-localhost domain in production'
        );
      }
      return filtered;
    }
    return domains;
  })()
);

/** Clusters accepted in SIWS messages. Defaults to devnet + mainnet-beta. */
const ALLOWED_CLUSTERS = new Set<SolanaCluster>(
  (() => {
    const raw = process.env.SIWS_ALLOWED_CLUSTERS;
    if (raw) {
      return raw
        .split(',')
        .map((c) => c.trim() as SolanaCluster)
        .filter(
          (c): c is SolanaCluster => c === 'devnet' || c === 'mainnet-beta' || c === 'testnet'
        );
    }
    return ['devnet', 'mainnet-beta'];
  })()
);

const MAX_SIWS_LIFETIME_MS = 10 * 60 * 1000;

/** SPKI DER prefix for raw 32-byte ed25519 pubkeys. RFC 8410. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/**
 * Verify an ed25519 signature over a Solana sign-in message.
 *
 * Phantom / Solflare / Backpack all expose `signMessage(message: Uint8Array)`
 * which returns a 64-byte signature (base58 in some wallets, raw Uint8Array
 * in @solana/wallet-adapter). Callers pass the signature as base58.
 */
function verifyEd25519Signature(
  message: string,
  signatureBase58: string,
  publicKeyBase58: string
): boolean {
  let sig: Buffer;
  let pubkeyBytes: Buffer;
  try {
    sig = Buffer.from(bs58.decode(signatureBase58));
    pubkeyBytes = Buffer.from(bs58.decode(publicKeyBase58));
  } catch {
    return false;
  }
  if (sig.length !== 64 || pubkeyBytes.length !== 32) return false;

  // Node's crypto.verify wants an SPKI-encoded ed25519 key.
  const pubkey = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, pubkeyBytes]),
    format: 'der',
    type: 'spki',
  });

  return cryptoVerify(null, Buffer.from(message, 'utf8'), pubkey, sig);
}

/** Build a CAIP-122 SIWx message string for Solana. */
export function buildSiwsMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  cluster: SolanaCluster;
  statement?: string;
}): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  const chainRef = `solana:${SOLANA_GENESIS_HASH[params.cluster].slice(0, 32)}`;
  return [
    `${params.domain} wants you to sign in with your Solana account:`,
    params.address,
    '',
    params.statement || 'Sign in to LOAR',
    '',
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${chainRef}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}

/**
 * Verify a SIWS message + signature pair, consume the nonce, and return the
 * checksummed Solana address (base58, case-sensitive — no transformation).
 */
export async function verifySiwsSignature(
  message: string,
  signatureBase58: string,
  requestOrigin?: string
): Promise<string> {
  const lines = message.split('\n');
  const domainLine = lines[0]?.trim();
  const domainMatch = domainLine?.match(/^(\S+) wants you to sign in with your Solana account:$/);
  if (!domainMatch) {
    throw new Error('SIWS message is missing or malformed domain line');
  }
  const messageDomain = domainMatch[1];
  const messageDomainHostname = messageDomain.replace(/:\d+$/, '');
  if (!ALLOWED_DOMAINS.has(messageDomain) && !ALLOWED_DOMAINS.has(messageDomainHostname)) {
    throw new Error(`SIWS domain "${messageDomain}" is not allowed`);
  }

  if (requestOrigin) {
    try {
      const originHost = new URL(requestOrigin).hostname;
      if (messageDomain !== originHost && originHost !== 'localhost') {
        throw new Error(
          `SIWS domain "${messageDomain}" does not match request origin "${originHost}"`
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('does not match')) throw e;
      throw new Error('Malformed request origin');
    }
  }

  const rawAddress = lines[1]?.trim();
  if (!rawAddress || !SOLANA_ADDR_RE.test(rawAddress)) {
    throw new Error('Could not extract Solana address from SIWS message');
  }
  // Validate it parses as a real Solana pubkey (catches base58 collisions
  // with the regex that happen to be the wrong length).
  try {
    new PublicKey(rawAddress);
  } catch {
    throw new Error('Invalid Solana address in SIWS message');
  }

  // Verify the signature first — bind every other check to a real signer.
  if (!verifyEd25519Signature(message, signatureBase58, rawAddress)) {
    throw new Error('Signature does not match claimed Solana address');
  }

  // Expiration
  const expirationMatch = message.match(/Expiration Time: (.+)/);
  if (!expirationMatch) {
    throw new Error('SIWS message must include an Expiration Time');
  }
  const expiresAt = new Date(expirationMatch[1]);
  if (isNaN(expiresAt.getTime())) {
    throw new Error('Invalid Expiration Time in SIWS message');
  }
  const now = new Date();
  if (now > expiresAt) {
    throw new Error('SIWS message has expired. Please sign in again.');
  }
  if (expiresAt.getTime() - now.getTime() > MAX_SIWS_LIFETIME_MS) {
    throw new Error('SIWS message expiration is too far in the future.');
  }

  // Chain ID (CAIP-2 form for Solana)
  const chainIdMatch = message.match(/Chain ID: solana:([1-9A-HJ-NP-Za-km-z]{32,})/);
  if (!chainIdMatch) {
    throw new Error('SIWS message must include a Chain ID in CAIP-2 solana:<genesis> form');
  }
  const claimedGenesis = chainIdMatch[1];
  const matchedCluster = (
    Object.entries(SOLANA_GENESIS_HASH) as Array<[SolanaCluster, string]>
  ).find(([, hash]) => hash.startsWith(claimedGenesis))?.[0];
  if (!matchedCluster || !ALLOWED_CLUSTERS.has(matchedCluster)) {
    throw new Error(`SIWS Chain ID "${claimedGenesis}" is not allowed`);
  }

  // URI
  const uriMatch = message.match(/URI: (.+)/);
  if (!uriMatch) {
    throw new Error('SIWS message must include a URI');
  }
  try {
    const uri = new URL(uriMatch[1].trim());
    if (!ALLOWED_DOMAINS.has(uri.hostname) && uri.hostname !== 'localhost') {
      throw new Error(`SIWS URI hostname "${uri.hostname}" is not in the allowed domains`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('SIWS URI hostname')) throw e;
    throw new Error('SIWS message contains an invalid URI');
  }

  // Nonce — same one-time-use semantics as SIWE. Delegate to the shared
  // consumeNonce so the Firestore + in-memory paths are both covered (the
  // in-memory Map lives in siwe.ts; sharing it via an exported function is
  // the cleanest way to keep dev + prod consistent).
  const nonceMatch = message.match(/^Nonce: ([a-f0-9]{64})$/m);
  if (!nonceMatch) {
    throw new Error('Could not extract nonce from SIWS message');
  }
  await consumeNonce(nonceMatch[1]);

  return rawAddress;
}
