/**
 * tRPC context factory -- extracts the authenticated user (if any) from the
 * incoming request headers and makes it available to all tRPC procedures.
 */
import type { Context as HonoContext } from 'hono';
import { verifyAuth, type AuthUser } from './auth';

export type CreateContextOptions = {
  context: HonoContext;
};

export async function createContext({ context }: CreateContextOptions) {
  const user = await verifyAuth(context.req.raw.headers);
  return { user };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
