/**
 * Layer 1 — server
 * Checks: health endpoint, root HTTP, CORS, auth nonce endpoint.
 * Identifies: server down, Firebase unreachable, CORS misconfiguration.
 */
import type { SmokeConfig } from '../config.ts';
import { rawGet } from '../client.ts';
import { check, type CheckResult } from '../reporter.ts';

export async function runServerLayer(cfg: SmokeConfig): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // 1. /health → { status: "healthy" | "degraded" }
  results.push(
    await check('/health → healthy', async () => {
      const { status, body } = await rawGet(cfg, '/health');
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const b = body as Record<string, unknown>;
      if (b?.status === 'healthy') return 'healthy';
      if (b?.status === 'degraded') {
        throw new Error('degraded — Firebase unreachable (check FIREBASE_SERVICE_ACCOUNT)');
      }
      throw new Error(`unexpected body: ${JSON.stringify(body).slice(0, 120)}`);
    })
  );

  // 2. Root route HTTP 200
  results.push(
    await check('GET / → 200 OK', async () => {
      const { status } = await rawGet(cfg, '/');
      if (status !== 200) throw new Error(`HTTP ${status} (expected 200)`);
    })
  );

  // 3. CORS header present for a cross-origin request
  results.push(
    await check('CORS header present', async () => {
      const url = `${cfg.serverUrl}/health`;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), cfg.timeout);
      try {
        const res = await fetch(url, {
          headers: { Origin: cfg.origin },
          signal: controller.signal,
        });
        const header = res.headers.get('access-control-allow-origin');
        if (!header)
          throw new Error(
            `access-control-allow-origin header missing for Origin=${cfg.origin} (check CORS_ORIGIN env on server)`
          );
        return header;
      } finally {
        clearTimeout(id);
      }
    })
  );

  // 4. tRPC healthCheck procedure
  results.push(
    await check('tRPC healthCheck → OK', async () => {
      const inputParam = encodeURIComponent(JSON.stringify({ '0': null }));
      const url = `${cfg.serverUrl}/trpc/healthCheck?batch=1&input=${inputParam}`;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), cfg.timeout);
      let json: unknown;
      try {
        const res = await fetch(url, { signal: controller.signal });
        json = await res.json();
      } finally {
        clearTimeout(id);
      }
      const arr = json as Array<{ result?: { data?: unknown } }>;
      const val = arr?.[0]?.result?.data;
      if (val !== 'OK') throw new Error(`expected "OK", got: ${JSON.stringify(val)}`);
      return val;
    })
  );

  // 5. /auth/nonce returns a 64-char hex string
  results.push(
    await check('GET /auth/nonce → 64-char hex nonce', async () => {
      const { status, body } = await rawGet(cfg, '/auth/nonce');
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const b = body as Record<string, unknown>;
      const nonce = (b?.nonce as string) ?? '';
      if (!/^[a-f0-9]{64}$/.test(nonce)) {
        throw new Error(`unexpected nonce format: ${nonce.slice(0, 20)}…`);
      }
      return `${nonce.slice(0, 8)}…`;
    })
  );

  return results;
}
