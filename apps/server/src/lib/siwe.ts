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

const jwtSecretRaw = process.env.SIWE_JWT_SECRET;
if (!jwtSecretRaw || jwtSecretRaw.length < 32) {
  throw new Error(
    'SIWE_JWT_SECRET must be set and at least 32 characters. Generate one with: openssl rand -hex 32'
  );
}
const JWT_SECRET = new TextEncoder().encode(jwtSecretRaw);
const JWT_ISSUER = 'loar-server';
const JWT_EXPIRY = '4h';

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

    nonceData.used = true;
  }

  return address;
}

/** Issue a signed JWT for the given wallet address. */
export async function issueSessionToken(address: string): Promise<string> {
  return new SignJWT({ sub: getAddress(address) })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

/** Verify a SIWE session JWT. Returns the payload or null if invalid/expired. */
export async function verifySessionToken(token: string): Promise<SiweSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
    });
    return payload as SiweSessionPayload;
  } catch {
    return null;
  }
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
  const now = new Date().toISOString();
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
    `Issued At: ${now}`,
  ].join('\n');
}
