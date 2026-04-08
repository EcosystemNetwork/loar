/**
 * Multi-chain authentication verification.
 *
 * Verifies JWT session tokens from EVM (SIWE), Solana (SIWS), or SUI
 * wallet authentication. Returns a normalized user object for use in
 * tRPC context. Downstream code doesn't need to know which chain.
 */
import { verifySessionToken } from './siwe';

export type ChainFamily = 'evm' | 'solana' | 'sui';

export interface AuthUser {
  uid: string;
  address?: string;
  email?: string;
  /** Which chain family the user authenticated with. */
  chain?: ChainFamily;
}

export async function verifyAuth(headers: Headers): Promise<AuthUser | null> {
  const token = headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (payload?.sub) {
    // Determine chain from JWT payload.
    // Non-EVM JWTs have explicit `chain` field; fall back to 'evm'.
    const payloadChain = (payload as Record<string, unknown>).chain;
    const chain: ChainFamily =
      payloadChain === 'solana' ? 'solana' : payloadChain === 'sui' ? 'sui' : 'evm';

    // For EVM, uid is lowercased checksummed address.
    // For Solana/SUI, uid keeps original casing.
    const uid = chain === 'evm' ? payload.sub.toLowerCase() : payload.sub;

    return {
      uid,
      address: payload.sub,
      chain,
    };
  }

  return null;
}
