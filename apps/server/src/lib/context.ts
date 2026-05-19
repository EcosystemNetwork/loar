/**
 * tRPC context factory -- extracts the authenticated user (if any) from the
 * incoming request headers/cookies and makes it available to all tRPC procedures.
 *
 * Supports SIWE JWT (httpOnly cookie or Bearer header) and API key auth.
 */
import type { Context as HonoContext } from 'hono';
import { getCookie } from 'hono/cookie';
import { getAddress } from 'viem';
import { verifyAuth, type AuthUser } from './auth';
import { getClientKey } from '../middleware/rate-limit';
import { lookupEvmForSolana } from './wallet-bridge';

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  // Extract session from httpOnly cookie (preferred) or headers (fallback)
  const cookieToken = getCookie(context, 'siwe-session');
  const user = await verifyAuth(context.req.raw.headers, cookieToken);

  // Normalize addresses to checksummed format for consistent comparisons
  if (user?.address) {
    try {
      user.address = getAddress(user.address);
      user.uid = user.address.toLowerCase();
    } catch {
      // Invalid address — leave as-is
    }
  }

  // Solana-primary sessions issued before walletLinks existed have no `evm`
  // claim, so `user.address` is undefined and `user.uid` is the base58
  // pubkey. That breaks any `creatorUid`-keyed query written under the
  // user's EVM identity. Bridge once per request: if the linked EVM is
  // known (via `walletLinks` or `circleSolanaWallets` fallback), promote it
  // to the canonical uid so all downstream queries match the dominant
  // identity. New SIWS sessions get the EVM claim baked into the JWT
  // (see routes/siws-auth.ts), so this Firestore lookup is a one-time cost
  // during the legacy-session drain window.
  if (user && user.chainNamespace === 'solana' && !user.address && user.solanaAddress) {
    const evm = await lookupEvmForSolana(user.solanaAddress);
    if (evm) {
      try {
        user.address = getAddress(evm);
        user.uid = user.address.toLowerCase();
      } catch {
        // Invalid evm shape — keep base58 uid as-is
      }
    }
  }

  // Reuse the same extractor the HTTP rate limiter uses so both paths agree
  // on what counts as "the client IP". Previously this trusted XFF/CF
  // unconditionally, which let any caller set `X-Forwarded-For: <random>`
  // and punch through per-IP rate limits on tRPC procedures (notably
  // analytics.recordView). getClientKey gates XFF trust on TRUST_PROXY
  // and validates IP format.
  const clientIp = getClientKey(context);

  return { user, clientIp };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
