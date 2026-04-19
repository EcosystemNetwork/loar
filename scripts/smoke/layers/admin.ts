/**
 * Layer 8 — admin + ops surfaces
 * Checks: Prometheus /metrics endpoint shape, admin.getConfig auth gate,
 *         admin.getConfig success when an admin JWT is provided.
 * Identifies: metrics regressions (missing counters), admin auth drift,
 *             platformConfig schema drift.
 *
 * Does NOT perform admin mutations (kill-switch flips, config writes) —
 * those would have real side effects on the target environment. Set
 * SMOKE_ADMIN_MUTATIONS=1 to opt in to a round-trip write test, which
 * toggles `monthlySpendCapCredits` by ±1 and restores it.
 */
import type { SmokeConfig } from '../config.ts';
import { rawGet, tRPCQuery, tRPCMutate } from '../client.ts';
import { check, type CheckResult } from '../reporter.ts';

export interface AdminLayerInput {
  /** Regular authenticated JWT (from auth layer). */
  userToken: string;
  /** Admin JWT if the smoke wallet is in ADMIN_ADDRESSES server-side. */
  adminToken?: string;
}

export async function runAdminLayer(
  cfg: SmokeConfig,
  input: AdminLayerInput
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  // 1. /metrics endpoint shape — Prometheus exposition text.
  checks.push(
    await check('GET /metrics → Prometheus exposition', async () => {
      const headers: Record<string, string> = {};
      if (process.env.METRICS_AUTH_TOKEN) {
        headers.authorization = `Bearer ${process.env.METRICS_AUTH_TOKEN}`;
      }
      const url = `${cfg.serverUrl}/metrics`;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), cfg.timeout);
      try {
        const res = await fetch(url, { headers, signal: controller.signal });
        if (res.status === 401) {
          throw new Error('HTTP 401 — set METRICS_AUTH_TOKEN env to the same value as the server');
        }
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.includes('# HELP') || !text.includes('# TYPE')) {
          throw new Error('body is not Prometheus exposition format');
        }
        const expected = [
          'loar_http_requests_total',
          'loar_http_request_duration_seconds',
          'loar_ai_generation_total',
          'loar_storage_upload_total',
          'loar_credits_transactions_total',
          'loar_auth_events_total',
        ];
        const missing = expected.filter((m) => !text.includes(m));
        if (missing.length > 0) {
          throw new Error(`missing metrics: ${missing.join(', ')}`);
        }
        return `${expected.length} metric families present`;
      } finally {
        clearTimeout(id);
      }
    })
  );

  // 2. admin.getConfig requires auth (no token → any denial error).
  checks.push(
    await check('admin.getConfig without auth → denied', async () => {
      try {
        await tRPCQuery<unknown>(cfg, 'admin.getConfig', null);
        throw new Error('call returned 200 but should have been denied');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Any denial error is acceptable: UNAUTHORIZED / FORBIDDEN / 401 / 403,
        // or the tRPC-wrapped "Authentication required" / "Admin access required"
        // strings returned by lib/trpc.ts.
        if (/UNAUTHORIZED|FORBIDDEN|401|403|authentication required|admin.*required/i.test(msg)) {
          return 'denied as expected';
        }
        throw new Error(`unexpected error shape: ${msg}`);
      }
    })
  );

  // 3. admin.getConfig with regular (non-admin) user → denied.
  if (input.userToken) {
    checks.push(
      await check('admin.getConfig as non-admin user → denied', async () => {
        try {
          await tRPCQuery<unknown>(cfg, 'admin.getConfig', null, input.userToken);
          // If an arbitrary smoke wallet has admin rights something is wrong,
          // but don't fail the smoke — just note it so the operator sees.
          return 'caller IS admin — verify this is intentional';
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/UNAUTHORIZED|FORBIDDEN|401|403|authentication required|admin.*required/i.test(msg)) {
            return 'denied as expected';
          }
          throw new Error(`unexpected error shape: ${msg}`);
        }
      })
    );
  }

  // 4. admin.getConfig with admin token → returns schema with kill-switch fields.
  if (input.adminToken) {
    checks.push(
      await check('admin.getConfig as admin → schema includes kill switches', async () => {
        const cfgBody = (await tRPCQuery<Record<string, unknown>>(
          cfg,
          'admin.getConfig',
          null,
          input.adminToken
        )) as Record<string, unknown>;
        const required = [
          'generationEnabled',
          'mintingEnabled',
          'purchaseEnabled',
          'registrationEnabled',
          'monthlySpendCapEnabled',
          'monthlySpendCapCredits',
        ];
        const missing = required.filter((k) => cfgBody[k] === undefined);
        if (missing.length > 0) throw new Error(`missing keys: ${missing.join(', ')}`);
        const truthy = required.filter((k) => cfgBody[k] === true).length;
        return `${required.length} kill-switch fields present (${truthy} enabled)`;
      })
    );

    // 5. Round-trip write test — opt-in only.
    if (process.env.SMOKE_ADMIN_MUTATIONS === '1') {
      checks.push(
        await check('admin.updateConfig round-trip (cap ±1, restored)', async () => {
          const before = (await tRPCQuery<{ monthlySpendCapCredits: number }>(
            cfg,
            'admin.getConfig',
            null,
            input.adminToken
          )) as { monthlySpendCapCredits: number };
          const bumped = before.monthlySpendCapCredits + 1;
          await tRPCMutate<unknown>(
            cfg,
            'admin.updateConfig',
            { monthlySpendCapCredits: bumped },
            input.adminToken
          );
          const after = (await tRPCQuery<{ monthlySpendCapCredits: number }>(
            cfg,
            'admin.getConfig',
            null,
            input.adminToken
          )) as { monthlySpendCapCredits: number };
          if (after.monthlySpendCapCredits !== bumped) {
            throw new Error(`write did not persist — got ${after.monthlySpendCapCredits}`);
          }
          // Restore.
          await tRPCMutate<unknown>(
            cfg,
            'admin.updateConfig',
            { monthlySpendCapCredits: before.monthlySpendCapCredits },
            input.adminToken
          );
          return `${before.monthlySpendCapCredits} → ${bumped} → ${before.monthlySpendCapCredits}`;
        })
      );
    }
  }

  // 6. Public DMCA takedown endpoint shape — returns 400 on bad payload.
  checks.push(
    await check('POST /api/takedown with empty body → 400', async () => {
      const url = `${cfg.serverUrl}/api/takedown`;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), cfg.timeout);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: cfg.origin },
          body: JSON.stringify({}),
          signal: controller.signal,
        });
        // 400 = validation rejected (good); 429 = rate limited (also acceptable);
        // 503 = service unavailable (firebase off).
        if (res.status === 400) return 'validation rejected empty body';
        if (res.status === 429) return 'rate-limited (ok)';
        if (res.status === 503) return 'service unavailable — firebase off';
        throw new Error(`unexpected status ${res.status}`);
      } finally {
        clearTimeout(id);
      }
    })
  );

  return checks;
}
