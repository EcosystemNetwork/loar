/**
 * SIWE (Sign-In With Ethereum) authentication.
 * Generates nonces, verifies wallet signatures, and issues/verifies JWT sessions.
 * Falls back to in-memory nonce storage when Firestore is unavailable.
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { recoverMessageAddress, getAddress } from 'viem';
import { db, firebaseAvailable } from './firebase';

// AUTH-03: In production, Firestore is REQUIRED for nonce storage to ensure
// multi-instance safety. In-memory fallback is only allowed in local dev.
const getNoncesCol = () => {
  if (firebaseAvailable) return db.collection('siweNonces');
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Firestore is unavailable but required for nonce storage in production. ' +
        'In-memory nonce storage is unsafe for multi-instance deployments.'
    );
  }
  return null;
};

// In-memory nonce store fallback (local dev only — see AUTH-03 above)
const memoryNonces = new Map<string, { createdAt: Date; expiresAt: Date; used: boolean }>();
setInterval(
  () => {
    const now = Date.now();
    for (const [key, val] of memoryNonces) {
      if (now > val.expiresAt.getTime()) memoryNonces.delete(key);
    }
  },
  5 * 60 * 1000
);

// Firestore nonce cleanup — delete expired/used nonces every 15 minutes
// Prevents unbounded document accumulation.
setInterval(
  async () => {
    const col = getNoncesCol();
    if (!col) return;

    try {
      const cutoff = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
      const expired = await col.where('expiresAt', '<', cutoff).limit(500).get();
      if (expired.empty) return;

      const batch = db.batch();
      expired.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    } catch (err) {
      console.error('[SIWE] Nonce cleanup failed:', err);
    }
  },
  15 * 60 * 1000
);

// JWT Secret Rotation Procedure (INFRA-02):
// 1. Set SIWE_JWT_SECRET_PREVIOUS = current SIWE_JWT_SECRET value
// 2. Set SIWE_JWT_SECRET = new secret value
// 3. Deploy — new tokens signed with new secret, old tokens still verify
// 4. After 24h (JWT TTL), remove SIWE_JWT_SECRET_PREVIOUS

const jwtSecretRaw = process.env.SIWE_JWT_SECRET;
if (!jwtSecretRaw || jwtSecretRaw.length < 32) {
  throw new Error(
    'SIWE_JWT_SECRET must be set and at least 32 characters. Generate one with: openssl rand -hex 32'
  );
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretRaw);

const jwtSecretPreviousRaw = process.env.SIWE_JWT_SECRET_PREVIOUS;
const JWT_SECRET_PREVIOUS = jwtSecretPreviousRaw
  ? new TextEncoder().encode(jwtSecretPreviousRaw)
  : null;

const JWT_ISSUER = 'loar-server';
const JWT_AUDIENCE = 'loar-app';
const JWT_EXPIRY = '24h';

/** Allowed SIWE domains. In production, SIWE_ALLOWED_DOMAINS must be set explicitly. */
const ALLOWED_DOMAINS = new Set(
  (() => {
    const raw = process.env.SIWE_ALLOWED_DOMAINS || 'localhost,loar.fun';
    const domains = raw.split(',').map((d) => d.trim());
    // Reject localhost in production to prevent domain spoofing
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

/** Allowed Chain IDs. Base L2 mainnet (8453) + Base Sepolia (84532) + Sepolia testnet (11155111) + localhost. */
const ALLOWED_CHAIN_IDS = new Set(
  (process.env.SIWE_ALLOWED_CHAIN_IDS || '8453,84532,11155111,31337')
    .split(',')
    .map((id) => id.trim())
);

export interface SiweSessionPayload extends JWTPayload {
  sub: string; // checksummed wallet address
  iat: number;
}

/** Generate a cryptographically random nonce and store it with a 2-minute TTL. */
export async function generateNonce(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const now = new Date();
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000);

  const col1 = getNoncesCol();
  if (col1) {
    await col1.doc(nonce).set({ createdAt: now, expiresAt, used: false });
  } else {
    memoryNonces.set(nonce, { createdAt: now, expiresAt, used: false });
  }

  return nonce;
}

/** Consume a server-issued nonce (marks as used, throws if invalid/expired/reused). */
export async function consumeNonce(nonce: string): Promise<void> {
  const col = getNoncesCol();
  if (col) {
    const nonceDoc = await col.doc(nonce).get();
    if (!nonceDoc.exists) throw new Error('Invalid or expired nonce');
    const nonceData = nonceDoc.data()!;
    if (nonceData.used) throw new Error('Invalid or expired nonce');
    if (new Date() > nonceData.expiresAt.toDate()) throw new Error('Invalid or expired nonce');
    // AUTH-03: Delete nonce from Firestore on consume (one-time use)
    await col.doc(nonce).delete();
  } else {
    // Atomic nonce consumption: delete IMMEDIATELY to prevent TOCTOU race.
    // If two requests arrive with the same nonce, only the first delete returns
    // truthy data; the second sees undefined and is rejected.
    const nonceData = memoryNonces.get(nonce);
    if (!nonceData) throw new Error('Invalid or expired nonce');
    memoryNonces.delete(nonce); // consume before any async work
    if (nonceData.used) throw new Error('Invalid or expired nonce');
    if (new Date() > nonceData.expiresAt) throw new Error('Invalid or expired nonce');
  }
}

/** Verify a SIWE message signature and consume the nonce. Returns the checksummed address. */
export async function verifySiweSignature(
  message: string,
  signature: `0x${string}`,
  requestOrigin?: string
): Promise<string> {
  // Extract and validate domain from the SIWE message (line 1). Fail-closed:
  // a message whose preamble doesn't match the expected pattern must be
  // rejected, otherwise an attacker can craft a misformatted line 1 showing
  // `evil.com` to the wallet UI while bypassing the domain + origin check.
  const lines = message.split('\n');
  const domainLine = lines[0]?.trim();
  const domainMatch = domainLine?.match(/^(.+?) wants you to sign in/);
  if (!domainMatch) {
    throw new Error('SIWE message is missing or malformed domain line');
  }
  const messageDomain = domainMatch[1];
  // Strip port from domain for comparison — window.location.host includes the port
  // (e.g. "localhost:3001") but ALLOWED_DOMAINS lists hostnames only.
  const messageDomainHostname = messageDomain.replace(/:\d+$/, '');
  if (!ALLOWED_DOMAINS.has(messageDomain) && !ALLOWED_DOMAINS.has(messageDomainHostname)) {
    throw new Error(`SIWE domain "${messageDomain}" is not allowed`);
  }

  // Cross-check SIWE domain against the request Origin header to prevent
  // an attacker signing a message with domain "loar.fun" from "evil.com"
  if (requestOrigin) {
    try {
      const originHost = new URL(requestOrigin).hostname;
      if (messageDomain !== originHost && originHost !== 'localhost') {
        throw new Error(
          `SIWE domain "${messageDomain}" does not match request origin "${originHost}"`
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('does not match')) throw e;
      // Malformed origin — reject instead of silently passing
      throw new Error('Malformed request origin');
    }
  }

  // Extract address from the SIWE message (line 2)
  const rawAddress = lines[1]?.trim();

  if (!rawAddress || !rawAddress.startsWith('0x')) {
    throw new Error('Could not extract address from SIWE message');
  }

  const address = getAddress(rawAddress); // checksums it

  // Recover signer from signature and verify it matches the claimed address
  const recoveredAddress = await recoverMessageAddress({ message, signature });

  if (getAddress(recoveredAddress) !== address) {
    throw new Error('Signature does not match claimed address');
  }

  // Validate message expiration time (REQUIRED per EIP-4361)
  const expirationMatch = message.match(/Expiration Time: (.+)/);
  if (!expirationMatch) {
    throw new Error('SIWE message must include an Expiration Time');
  }
  const expiresAt = new Date(expirationMatch[1]);
  if (isNaN(expiresAt.getTime())) {
    throw new Error('Invalid Expiration Time in SIWE message');
  }
  if (new Date() > expiresAt) {
    throw new Error('SIWE message has expired. Please sign in again.');
  }

  // Validate Chain ID (REQUIRED per EIP-4361)
  const chainIdMatch = message.match(/Chain ID: (\d+)/);
  if (!chainIdMatch) {
    throw new Error('SIWE message must include a Chain ID');
  }
  if (!ALLOWED_CHAIN_IDS.has(chainIdMatch[1])) {
    throw new Error(`SIWE Chain ID "${chainIdMatch[1]}" is not allowed`);
  }

  // Validate URI field (REQUIRED per EIP-4361)
  const uriMatch = message.match(/URI: (.+)/);
  if (!uriMatch) {
    throw new Error('SIWE message must include a URI');
  }
  try {
    const uri = new URL(uriMatch[1].trim());
    const uriHostname = uri.hostname;
    if (!ALLOWED_DOMAINS.has(uriHostname) && uriHostname !== 'localhost') {
      throw new Error(`SIWE URI hostname "${uriHostname}" is not in the allowed domains`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('SIWE URI hostname')) throw e;
    throw new Error('SIWE message contains an invalid URI');
  }

  // Extract and validate nonce
  const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/);
  if (!nonceMatch) {
    throw new Error('Could not extract nonce from SIWE message');
  }

  const nonce = nonceMatch[1];

  const col2 = getNoncesCol();
  if (col2) {
    // Atomic nonce consumption via Firestore transaction to prevent race conditions
    await db.runTransaction(async (transaction) => {
      const nonceRef = col2.doc(nonce);
      const nonceDoc = await transaction.get(nonceRef);
      if (!nonceDoc.exists) throw new Error('Invalid or expired nonce');

      const nonceData = nonceDoc.data()!;
      if (nonceData.used) throw new Error('Invalid or expired nonce');
      if (new Date() > nonceData.expiresAt.toDate()) throw new Error('Invalid or expired nonce');

      // AUTH-03: Delete nonce from Firestore (one-time use) instead of marking used
      transaction.delete(nonceRef);
    });
  } else {
    // Atomic nonce consumption: delete IMMEDIATELY before any async work
    // to prevent TOCTOU race. The nonce is consumed even if validation
    // fails below — this is intentional (a malformed nonce should not be reusable).
    const nonceData = memoryNonces.get(nonce);
    if (!nonceData) throw new Error('Invalid or expired nonce');
    memoryNonces.delete(nonce);
    if (nonceData.used) throw new Error('Invalid or expired nonce');
    if (new Date() > nonceData.expiresAt) throw new Error('Invalid or expired nonce');
  }

  return address;
}

/** Issue a signed JWT for the given wallet address. */
export async function issueSessionToken(address: string): Promise<string> {
  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');

  return new SignJWT({ sub: getAddress(address) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

// ── Token blacklist (in-memory, or Firestore if available) ──────────────
// Used to revoke tokens before they expire naturally.
// Bounded to MAX_BLACKLIST_SIZE entries to prevent memory exhaustion.
const MAX_BLACKLIST_SIZE = 10_000;
const memoryBlacklist = new Map<string, number>();

// Clean up in-memory blacklist every 30 minutes. Evict entries older than
// 24 h (JWT TTL) instead of clearing everything when the set gets large.
setInterval(
  () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000; // JWT TTL
    for (const [jti, revokedAt] of memoryBlacklist) {
      if (revokedAt < cutoff) memoryBlacklist.delete(jti);
    }
  },
  30 * 60 * 1000
);

/** Blacklist a JWT so it cannot be used even before expiry. */
export async function revokeToken(jti: string): Promise<void> {
  const col = firebaseAvailable ? db.collection('revokedTokens') : null;
  if (col) {
    await col.doc(jti).set({ revokedAt: new Date() });
  } else {
    // Evict oldest entries if at capacity (LRU-style eviction)
    if (memoryBlacklist.size >= MAX_BLACKLIST_SIZE) {
      const keysToRemove = [...memoryBlacklist.entries()]
        .sort((a, b) => a[1] - b[1])
        .slice(0, Math.floor(MAX_BLACKLIST_SIZE * 0.1))
        .map(([k]) => k);
      for (const k of keysToRemove) memoryBlacklist.delete(k);
    }
    memoryBlacklist.set(jti, Date.now());
  }
}

/** Check if a token has been revoked. */
async function isTokenRevoked(jti: string): Promise<boolean> {
  const col = firebaseAvailable ? db.collection('revokedTokens') : null;
  if (col) {
    const doc = await col.doc(jti).get();
    return doc.exists;
  }
  return memoryBlacklist.has(jti);
}

/** Verify a SIWE session JWT. Returns the payload or null if invalid/expired/revoked.
 *  Supports secret rotation: tries the current secret first, then falls back to
 *  SIWE_JWT_SECRET_PREVIOUS if set (see INFRA-02 rotation procedure above). */
export async function verifySessionToken(token: string): Promise<SiweSessionPayload | null> {
  const result = await verifySessionTokenDetailed(token);
  return result?.payload ?? null;
}

/** Verify a SIWE session JWT and return which secret validated it. Callers
 *  that mint a new token from an old one (refreshSessionToken) use this to
 *  refuse extending sessions that only verified against the previous secret,
 *  so a leaked pre-rotation token does not become durable post-rotation. */
export async function verifySessionTokenDetailed(
  token: string
): Promise<{ payload: SiweSessionPayload; secret: 'current' | 'previous' } | null> {
  const verifyOpts = { issuer: JWT_ISSUER, audience: JWT_AUDIENCE };

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, verifyOpts);
    if (payload.jti && (await isTokenRevoked(payload.jti))) return null;
    return { payload: payload as SiweSessionPayload, secret: 'current' };
  } catch {
    if (!JWT_SECRET_PREVIOUS) return null;
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET_PREVIOUS, verifyOpts);
      if (payload.jti && (await isTokenRevoked(payload.jti))) return null;
      console.warn(
        '[SIWE] Token verified with previous secret — rotation still in progress. ' +
          'Remove SIWE_JWT_SECRET_PREVIOUS after 24h.'
      );
      return { payload: payload as SiweSessionPayload, secret: 'previous' };
    } catch {
      return null;
    }
  }
}

/**
 * Refresh a session token. Returns a new JWT if the existing one is valid
 * AND was signed with the CURRENT secret. Tokens that only verify against
 * the previous secret are refused during rotation so a leaked pre-rotation
 * token cannot be upgraded into a new 24h current-secret session. Those
 * users must re-sign-in.
 */
export async function refreshSessionToken(token: string): Promise<string | null> {
  const result = await verifySessionTokenDetailed(token);
  if (!result?.payload?.sub) return null;
  if (result.secret !== 'current') return null;

  // Revoke the old token so it can't be reused
  if (result.payload.jti) {
    await revokeToken(result.payload.jti);
  }

  return issueSessionToken(result.payload.sub);
}

/** Construct a SIWE-compliant message string. */
export function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId: number;
  statement?: string;
}): string {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000);
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    params.statement || 'Sign in to LOAR',
    '',
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expiresAt.toISOString()}`,
  ].join('\n');
}
