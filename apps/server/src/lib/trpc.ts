/**
 * tRPC initialization and base procedure definitions.
 * Exports public (unauthenticated) and protected (auth-required) procedures.
 */
import { initTRPC, TRPCError } from '@trpc/server';
import { getAddress } from 'viem';
import type { Context } from './context';
import { withCostScope } from '../services/cost-tracker/scope';
import {
  hasScope,
  isMcpServerKey,
  trackApiKeyUsage,
  acquireKeyConcurrencySlot,
  releaseKeyConcurrencySlot,
} from './apiKeys';

export const t = initTRPC.context<Context>().create();

export const router = t.router;

/**
 * Cost-scope middleware — attaches (userId, apiKeyId, aiAgentId, route) to
 * the async context so every provider call during this request auto-tags
 * its ledger entry. Runs on every procedure via publicProcedure/protectedProcedure.
 */
const costScopeMiddleware = t.middleware(async ({ ctx, path, next }) => {
  const u = ctx.user;
  // Fire-and-forget usage record — only when the caller is using an API key.
  // JWT / cookie sessions don't generate apiKeyUsage rows.
  if (u?.apiKeyId) {
    const keyType: 'mcp_server' | 'direct' = isMcpServerKey(u.apiKeyPermissions)
      ? 'mcp_server'
      : 'direct';
    trackApiKeyUsage({
      keyId: u.apiKeyId,
      endpoint: `trpc:${path}`,
      keyType,
      endUserAddress: u.endUserAddress,
    }).catch(() => {
      /* already logged inside helper */
    });
  }
  return withCostScope(
    {
      userId: u?.uid ?? null,
      apiKeyId: u?.apiKeyId ?? null,
      aiAgentId: u?.aiAgentId ?? null,
      route: `trpc:${path}`,
    },
    () => next()
  );
});

export const publicProcedure = t.procedure.use(costScopeMiddleware);

export const protectedProcedure = t.procedure.use(costScopeMiddleware).use(({ ctx, next }) => {
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
 * INF-6: per-key concurrency slot — wrap tRPC procedures that hit expensive
 * paid external APIs (image / video / voice / 3D / VLM). Caps how many jobs a
 * single API key can have in flight regardless of the rate-limit window. JWT
 * / cookie sessions are not gated here (they use an IP-level rate limit
 * upstream); only API-key-authenticated calls acquire a slot.
 *
 * Usage:
 *
 *     export const imageRouter = router({
 *       generate: expensiveProcedure.mutation(async ({ ctx, input }) => { ... }),
 *     });
 */
const concurrencySlotMiddleware = t.middleware(async ({ ctx, next }) => {
  const keyId = ctx.user?.apiKeyId;
  if (!keyId) {
    // JWT or anonymous path — no per-key slot applies.
    return next();
  }
  const isMcp = isMcpServerKey(ctx.user?.apiKeyPermissions);
  const acquired = acquireKeyConcurrencySlot(keyId, isMcp);
  if (!acquired) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message:
        'Per-key concurrency cap reached for this API key. Wait for in-flight jobs to finish before starting new ones.',
    });
  }
  try {
    return await next();
  } finally {
    releaseKeyConcurrencySlot(keyId);
  }
});

export const expensiveProcedure = protectedProcedure.use(concurrencySlotMiddleware);

/**
 * Admin addresses — consolidated from ADMIN_ADDRESSES (comma-separated list)
 * with fallback to legacy ADMIN_WALLET (single address).
 * Validated at load time: invalid addresses are rejected with a warning.
 */
const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/**
 * Public helper (SRV-9): returns true if the given wallet address is in the
 * admin allowlist derived at module load from `ADMIN_ADDRESSES` +
 * `ADMIN_WALLET`. Case-insensitive. Callers outside tRPC (Hono routes, scripts)
 * should use this instead of re-parsing the env themselves — avoids the risk
 * of a second parser diverging from the authoritative one.
 */
export function isAdminAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  return ADMIN_ADDRESSES.includes(address.toLowerCase());
}
const ADMIN_ADDRESSES: string[] = (() => {
  const raw = [
    ...(process.env.ADMIN_ADDRESSES ?? '').split(','),
    ...(process.env.ADMIN_WALLET ? [process.env.ADMIN_WALLET] : []),
  ]
    .map((a) => a.trim())
    .filter(Boolean);
  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const addr of raw) {
    const lower = addr.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      unique.push(addr);
    }
  }
  // Validate and checksum each address
  const valid: string[] = [];
  for (const addr of unique) {
    if (!ETH_ADDRESS_RE.test(addr)) {
      console.warn(`[trpc] Invalid admin address ignored: ${addr}`);
      continue;
    }
    try {
      // Checksum via getAddress, then lowercase for consistent comparison
      valid.push(getAddress(addr).toLowerCase());
    } catch {
      console.warn(`[trpc] Failed to checksum admin address: ${addr}`);
    }
  }
  return valid;
})();

/**
 * Enforce API key permissions. JWT users bypass (full access).
 * Use in routes: `protectedProcedure.use(requirePermission('entities.update'))`.
 */
export function requirePermission(permission: string) {
  return t.middleware(({ ctx, next }) => {
    // ctx.user is guaranteed non-null here (chained after protectedProcedure)
    const user = ctx.user as NonNullable<typeof ctx.user>;
    const perms = user.apiKeyPermissions;
    // hasScope handles JWT users (no perms → pass), admin.all, and mcp_server
    // inheritance of all non-admin scopes.
    if (!hasScope(perms, permission)) {
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
  // API-key authenticated requests must NEVER reach admin routes. The
  // mint-time scope check in `apiKeys.ts` already forbids granting
  // `admin.all` to any API key, so this branch is defense-in-depth: any
  // direct-Firestore-inserted or legacy key that somehow carries `admin.all`
  // must still be rejected by the middleware. Admin actions require a
  // freshly-minted session JWT (cookie or bearer on mobile).
  if (ctx.user.apiKeyId) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin routes require a session token, not an API key',
    });
  }
  const rawAddress = ctx.user.address;
  if (!rawAddress) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access requires a wallet address' });
  }
  if (ADMIN_ADDRESSES.length === 0) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Admin access not configured. Set ADMIN_ADDRESSES or ADMIN_WALLET env var.',
    });
  }
  // Normalize via getAddress() for checksummed comparison consistency.
  // Wrap in try/catch: a legacy JWT issued before the canonical sub
  // normalization could carry a malformed address, in which case getAddress
  // throws — we want a clean FORBIDDEN, not an uncaught 500 that leaks the
  // pre-vs-post-check timing distinction to a probing attacker.
  let address: string;
  try {
    address = getAddress(rawAddress).toLowerCase();
  } catch {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  if (!ADMIN_ADDRESSES.includes(address)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});
