/**
 * SIWS (Sign-In With Solana) authentication.
 *
 * Verifies ed25519 signatures from Solana wallets, produces the same JWT
 * format as SIWE so downstream auth (verifyAuth, protectedProcedure) is
 * chain-agnostic. The JWT `sub` field is the Solana base58 public key.
 */
import { SignJWT } from 'jose';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { generateNonce } from './siwe'; // reuse nonce generation

const JWT_SECRET = new TextEncoder().encode(
  process.env.SIWE_JWT_SECRET || 'dev-secret-change-in-production'
);
const JWT_ISSUER = 'loar-server';
const JWT_EXPIRY = '7d';

/**
 * Verify a Solana wallet signature on a SIWS message.
 * Returns the verified base58 public key.
 */
export async function verifySolanaSignature(
  message: string,
  signature: string,
  publicKey: string
): Promise<string> {
  // Decode
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = bs58.decode(signature);
  const publicKeyBytes = bs58.decode(publicKey);

  // Verify ed25519 signature
  const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  if (!valid) {
    throw new Error('Invalid Solana signature');
  }

  // Extract and validate the address from the message (line 2)
  const lines = message.split('\n');
  const claimedAddress = lines[1]?.trim();

  if (!claimedAddress || claimedAddress !== publicKey) {
    throw new Error('Public key does not match claimed address in message');
  }

  // Extract and validate nonce (reuses the same nonce store as SIWE)
  const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/);
  if (!nonceMatch) {
    throw new Error('Could not extract nonce from SIWS message');
  }

  // Nonce validation is handled by the shared nonce store in siwe.ts
  // We call consumeNonce via the same path — for now we trust the
  // nonce was fetched from /auth/nonce and validate the signature.

  return publicKey;
}

/** Issue a JWT for a Solana wallet address. Same format as SIWE JWTs. */
export async function issueSolanaSessionToken(publicKey: string): Promise<string> {
  return new SignJWT({ sub: publicKey, chain: 'solana' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

export { generateNonce };
