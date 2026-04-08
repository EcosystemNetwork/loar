/**
 * Sign-In With SUI authentication.
 *
 * Verifies personal message signatures from SUI wallets, produces the same
 * JWT format as SIWE/SIWS so downstream auth (verifyAuth, protectedProcedure)
 * is chain-agnostic. The JWT `sub` field is the SUI hex address.
 */
import { SignJWT } from 'jose';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { generateNonce } from './siwe'; // reuse nonce generation

const JWT_SECRET = new TextEncoder().encode(
  process.env.SIWE_JWT_SECRET || 'dev-secret-change-in-production'
);
const JWT_ISSUER = 'loar-server';
const JWT_EXPIRY = '7d';

/**
 * Verify a SUI wallet personal message signature.
 * Returns the verified SUI address (0x...).
 */
export async function verifySuiSignature(
  message: string,
  signature: string,
  address: string
): Promise<string> {
  const messageBytes = new TextEncoder().encode(message);

  // verifyPersonalMessageSignature throws if the signature is invalid.
  // Pass the expected address so the SDK validates the signer matches.
  const publicKey = await verifyPersonalMessageSignature(messageBytes, signature, {
    address,
  });

  const recoveredAddress = publicKey.toSuiAddress();

  // Validate the address in the message matches
  const lines = message.split('\n');
  const claimedAddress = lines[1]?.trim();

  if (!claimedAddress || claimedAddress !== address) {
    throw new Error('Address does not match claimed address in message');
  }

  if (recoveredAddress !== address) {
    throw new Error('Recovered address does not match claimed address');
  }

  // Extract nonce (same format as SIWE/SIWS)
  const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/);
  if (!nonceMatch) {
    throw new Error('Could not extract nonce from message');
  }

  return address;
}

/** Issue a JWT for a SUI wallet address. Same format as SIWE/SIWS JWTs. */
export async function issueSuiSessionToken(address: string): Promise<string> {
  return new SignJWT({ sub: address, chain: 'sui' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

export { generateNonce };
