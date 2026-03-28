/**
 * SIWE (Sign-In With Ethereum) helpers for mobile.
 * Mirrors apps/web/src/lib/wallet-auth.ts but without DOM/localStorage.
 */

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL || 'http://localhost:3000';

export function buildSiweMessage(params: {
  address: string;
  nonce: string;
  chainId: number;
}): string {
  const domain = 'loarvault.app';
  const uri = 'https://loarvault.app';
  const now = new Date().toISOString();

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
    `Issued At: ${now}`,
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
