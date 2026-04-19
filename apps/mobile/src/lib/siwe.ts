/**
 * SIWE (Sign-In With Ethereum) helpers for mobile.
 * Mirrors apps/web/src/lib/wallet-auth.ts but without DOM/localStorage.
 */

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:3000';

/**
 * Chains the mobile client is allowed to sign against. The server enforces
 * its own SIWE_ALLOWED_CHAIN_IDS, but pinning here prevents a malicious or
 * compromised wallet from coaxing the user into signing a mainnet-shaped
 * message while the mobile build is targeting testnet (cross-chain replay
 * once mainnet is deployed).
 */
const ALLOWED_CHAIN_IDS = new Set<number>([
  11155111, // Sepolia
  84532, // Base Sepolia
]);

const SIWE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes — aligns with server nonce TTL

export function buildSiweMessage(params: {
  address: string;
  nonce: string;
  chainId: number;
}): string {
  if (!ALLOWED_CHAIN_IDS.has(params.chainId)) {
    throw new Error(`Chain ID ${params.chainId} is not enabled on this build`);
  }
  const domain = 'loarvault.app';
  const uri = 'https://loarvault.app';
  const now = new Date();
  const expires = new Date(now.getTime() + SIWE_EXPIRY_MS);

  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    'Sign in to LOAR',
    '',
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now.toISOString()}`,
    `Expiration Time: ${expires.toISOString()}`,
  ].join('\n');
}

export async function fetchNonce(): Promise<string> {
  const res = await fetch(`${SERVER_URL}/auth/nonce`);
  if (!res.ok) throw new Error('Failed to fetch nonce');
  const data = await res.json();
  return data.nonce as string;
}

export async function verifySignature(
  message: string,
  signature: string
): Promise<{ token: string; address: string }> {
  const res = await fetch(`${SERVER_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Verification failed' }));
    throw new Error((err as { error?: string }).error || 'Verification failed');
  }
  return res.json() as Promise<{ token: string; address: string }>;
}
