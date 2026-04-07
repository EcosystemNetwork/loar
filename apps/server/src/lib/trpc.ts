/**
 * tRPC initialization and base procedure definitions.
 * Exports public (unauthenticated) and protected (auth-required) procedures.
 */
import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from './context';

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
    });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

/** Admin addresses — loaded from ADMIN_ADDRESSES env var (comma-separated) */
const ADMIN_ADDRESSES = (process.env.ADMIN_ADDRESSES ?? '')
  .split(',')
  .map((a) => a.trim().toLowerCase())
  .filter(Boolean);

/** Protected procedure that also requires admin role */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const address = ctx.user.address?.toLowerCase();
  if (!address) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access requires a wallet address' });
  }
  // If no admin list configured, allow all authenticated users (dev mode)
  if (ADMIN_ADDRESSES.length > 0 && !ADMIN_ADDRESSES.includes(address)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});
