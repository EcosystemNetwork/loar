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

  // Expose request headers so procedures can read client IP / UA without
  // depending on the Hono context object (keeps the tRPC surface portable).
  const clientIp =
    context.req.header('cf-connecting-ip') ||
    context.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';

  return { user, clientIp };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
