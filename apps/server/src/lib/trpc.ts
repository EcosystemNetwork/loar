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

/**
 * Admin addresses — consolidated from ADMIN_ADDRESSES (comma-separated list)
 * with fallback to legacy ADMIN_WALLET (single address).
 * Validated at load time: invalid addresses are rejected with a warning.
 */
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ADMIN_ADDRESSES: string[] = (() => {
  const raw = [
    ...(process.env.ADMIN_ADDRESSES ?? '').split(','),
    ...(process.env.ADMIN_WALLET ? [process.env.ADMIN_WALLET] : []),
  ]
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  // Deduplicate
  const unique = [...new Set(raw)];
  // Validate each address
  for (const addr of unique) {
    if (!ETH_ADDRESS_RE.test(addr)) {
      console.warn(`[trpc] Invalid admin address ignored: ${addr}`);
    }
  }
  return unique.filter((a) => ETH_ADDRESS_RE.test(a));
})();

/**
 * Enforce API key permissions. JWT users bypass (full access).
 * Use in routes: `protectedProcedure.use(requirePermission('entities.update'))`.
 */
export function requirePermission(permission: string) {
  return t.middleware(({ ctx, next }) => {
    // ctx.user is guaranteed non-null here (chained after protectedProcedure)
    const user = ctx.user as NonNullable<typeof ctx.user>;
    const perms = (user as any).apiKeyPermissions as string[] | undefined;
    // JWT users have no apiKeyPermissions → full access
    if (perms && perms.length > 0 && !perms.includes(permission)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `API key lacks required permission: ${permission}`,
      });
    }
    return next({ ctx: { ...ctx, user } });
  });
}

/** Protected procedure that also requires admin role */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  const address = ctx.user.address?.toLowerCase();
  if (!address) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access requires a wallet address' });
  }
  if (ADMIN_ADDRESSES.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access not configured. Set ADMIN_ADDRESSES or ADMIN_WALLET env var.',
    });
  }
  if (!ADMIN_ADDRESSES.includes(address)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});
