/**
 * SIWE (Sign-In With Ethereum) authentication.
 * Generates nonces, verifies wallet signatures, and issues/verifies JWT sessions.
 * Falls back to in-memory nonce storage when Firestore is unavailable.
 */
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { recoverMessageAddress, getAddress } from 'viem';
import { db, firebaseAvailable } from './firebase';

const getNoncesCol = () => (firebaseAvailable ? db.collection('siweNonces') : null);

// In-memory nonce store fallback
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

const jwtSecretRaw = process.env.SIWE_JWT_SECRET;
if (!jwtSecretRaw || jwtSecretRaw.length < 32) {
  throw new Error(
    'SIWE_JWT_SECRET must be set and at least 32 characters. Generate one with: openssl rand -hex 32'
  );
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretRaw);
const JWT_ISSUER = 'loar-server';
const JWT_EXPIRY = '24h';

/** Allowed SIWE domains. Add production domain when deploying. */
const ALLOWED_DOMAINS = new Set(
  (process.env.SIWE_ALLOWED_DOMAINS || 'localhost,loar.fun').split(',').map((d) => d.trim())
);

export interface SiweSessionPayload extends JWTPayload {
  sub: string; // checksummed wallet address
  iat: number;
}

/** Generate a cryptographically random nonce and store it with a 5-minute TTL. */
export async function generateNonce(): Promise<string> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  const now = new Date();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

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
    if (!nonceDoc.exists) throw new Error('Unknown nonce');
    const nonceData = nonceDoc.data()!;
    if (nonceData.used) throw new Error('Nonce already used');
    if (new Date() > nonceData.expiresAt.toDate()) throw new Error('Nonce expired');
    await col.doc(nonce).update({ used: true });
  } else {
    const nonceData = memoryNonces.get(nonce);
    if (!nonceData) throw new Error('Unknown nonce');
    if (nonceData.used) throw new Error('Nonce already used');
    if (new Date() > nonceData.expiresAt) throw new Error('Nonce expired');
    memoryNonces.delete(nonce);
  }
}

/** Verify a SIWE message signature and consume the nonce. Returns the checksummed address. */
export async function verifySiweSignature(
  message: string,
  signature: `0x${string}`
): Promise<string> {
  // Extract and validate domain from the SIWE message (line 1)
  const lines = message.split('\n');
  const domainLine = lines[0]?.trim();
  const domainMatch = domainLine?.match(/^(.+?) wants you to sign in/);
  if (domainMatch) {
    const messageDomain = domainMatch[1];
    if (!ALLOWED_DOMAINS.has(messageDomain)) {
      throw new Error(`SIWE domain "${messageDomain}" is not allowed`);
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

  // Validate message expiration time (if present)
  const expirationMatch = message.match(/Expiration Time: (.+)/);
  if (expirationMatch) {
    const expiresAt = new Date(expirationMatch[1]);
    if (isNaN(expiresAt.getTime())) {
      throw new Error('Invalid Expiration Time in SIWE message');
    }
    if (new Date() > expiresAt) {
      throw new Error('SIWE message has expired. Please sign in again.');
    }
  }

  // Extract and validate nonce
  const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/);
  if (!nonceMatch) {
    throw new Error('Could not extract nonce from SIWE message');
  }

  const nonce = nonceMatch[1];

  const col2 = getNoncesCol();
  if (col2) {
    const nonceDoc = await col2.doc(nonce).get();
    if (!nonceDoc.exists) throw new Error('Unknown nonce');

    const nonceData = nonceDoc.data()!;
    if (nonceData.used) throw new Error('Nonce already used');
    if (new Date() > nonceData.expiresAt.toDate()) throw new Error('Nonce expired');

    await col2.doc(nonce).update({ used: true });
  } else {
    const nonceData = memoryNonces.get(nonce);
    if (!nonceData) throw new Error('Unknown nonce');
    if (nonceData.used) throw new Error('Nonce already used');
    if (new Date() > nonceData.expiresAt) throw new Error('Nonce expired');

    // Atomically consume the nonce — delete prevents any concurrent use.
    // In Node.js single-threaded model, delete between awaits is safe, but
    // using delete (instead of a flag) makes double-use impossible even if
    // two requests interleave across microtask boundaries.
    memoryNonces.delete(nonce);
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
    .setIssuedAt()
    .setJti(jti)
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

// ── Token blacklist (in-memory, or Firestore if available) ──────────────
// Used to revoke tokens before they expire naturally.
const memoryBlacklist = new Set<string>();

// Clean up expired blacklist entries every 30 minutes
setInterval(
  () => {
    // In-memory entries auto-expire when the JWT itself expires.
    // We just clear the whole set periodically since stale entries are harmless.
    if (memoryBlacklist.size > 10_000) memoryBlacklist.clear();
  },
  30 * 60 * 1000
);

/** Blacklist a JWT so it cannot be used even before expiry. */
export async function revokeToken(jti: string): Promise<void> {
  const col = firebaseAvailable ? db.collection('revokedTokens') : null;
  if (col) {
    await col.doc(jti).set({ revokedAt: new Date() });
  } else {
    memoryBlacklist.add(jti);
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

/** Verify a SIWE session JWT. Returns the payload or null if invalid/expired/revoked. */
export async function verifySessionToken(token: string): Promise<SiweSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
    });

    // Check revocation if token has a jti
    if (payload.jti && (await isTokenRevoked(payload.jti))) {
      return null;
    }

    return payload as SiweSessionPayload;
  } catch {
    return null;
  }
}

/**
 * Refresh a session token. Returns a new JWT if the existing one is valid.
 * The old token remains valid until it expires (or is explicitly revoked).
 */
export async function refreshSessionToken(token: string): Promise<string | null> {
  const payload = await verifySessionToken(token);
  if (!payload?.sub) return null;
  return issueSessionToken(payload.sub);
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
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
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
