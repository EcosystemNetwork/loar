/**
 * Admin-only REST endpoints for cost data.
 *
 * Exposes `/api/admin/cost/export.csv` so admins can download the raw ledger
 * in spreadsheet form without going through tRPC batching. Auth piggybacks
 * on the shared SIWE session + ADMIN_ADDRESSES allowlist (same gate as
 * `adminProcedure`).
 */

import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { getAddress } from 'viem';
import { verifyAuth } from '../lib/auth';
import { exportLedgerCsv, withCostScope } from '../services/cost-tracker';

const ETH_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
function loadAdminAddresses(): string[] {
  const raw = [
    ...(process.env.ADMIN_ADDRESSES ?? '').split(','),
    ...(process.env.ADMIN_WALLET ? [process.env.ADMIN_WALLET] : []),
  ]
    .map((a) => a.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const addr of raw) {
    if (!ETH_ADDRESS_RE.test(addr)) continue;
    try {
      const norm = getAddress(addr).toLowerCase();
      if (!seen.has(norm)) {
        seen.add(norm);
        out.push(norm);
      }
    } catch {
      /* skip invalid */
    }
  }
  return out;
}

export const adminCostRoutes = new Hono();

adminCostRoutes.get('/export.csv', async (c) => {
  const cookieToken = getCookie(c, 'siwe-session');
  const user = await verifyAuth(c.req.raw.headers, cookieToken);
  if (!user) return c.json({ code: 'UNAUTHORIZED', message: 'Authentication required' }, 401);
  if (!user.address) {
    return c.json({ code: 'FORBIDDEN', message: 'Admin requires a wallet address' }, 403);
  }
  const admins = loadAdminAddresses();
  if (admins.length === 0) {
    return c.json(
      { code: 'FORBIDDEN', message: 'Admin access not configured (ADMIN_ADDRESSES unset)' },
      403
    );
  }
  const normalized = getAddress(user.address).toLowerCase();
  if (!admins.includes(normalized)) {
    return c.json({ code: 'FORBIDDEN', message: 'Admin access required' }, 403);
  }

  const q = c.req.query();
  const limit = Math.min(Math.max(parseInt(q.limit ?? '500', 10) || 500, 1), 5000);
  const csv = await withCostScope(
    {
      userId: user.uid,
      apiKeyId: user.apiKeyId ?? null,
      aiAgentId: user.aiAgentId ?? null,
      route: 'rest:admin.cost.export',
    },
    () =>
      exportLedgerCsv({
        limit,
        userId: q.userId || undefined,
        apiKeyId: q.apiKeyId || undefined,
        universeAddress: q.universeAddress || undefined,
        provider: q.provider || undefined,
      })
  );
  const stamp = new Date().toISOString().slice(0, 10);
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="loar-cost-ledger-${stamp}.csv"`);
  return c.body(csv);
});
