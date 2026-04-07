/**
 * HTTP helpers for smoke tests.
 *
 * tRPCQuery / tRPCMutate — thin wrappers over the tRPC v10 HTTP batch protocol.
 * raw* helpers — direct fetch for REST endpoints (/health, /auth/*).
 * buildSiweMessage — replicated from apps/server/src/lib/siwe.ts (no import needed).
 */
import type { SmokeConfig } from './config.ts';

// ── tRPC HTTP batch helpers ───────────────────────────────────────────────────

/**
 * Call a tRPC query procedure via GET batch (tRPC v10 protocol).
 * procedure: dot-separated path, e.g. "profiles.me" or "healthCheck"
 */
export async function tRPCQuery<T>(
  cfg: SmokeConfig,
  procedure: string,
  input: unknown = null,
  token?: string
): Promise<T> {
  const inputParam = encodeURIComponent(JSON.stringify({ '0': { json: input } }));
  const url = `${cfg.serverUrl}/trpc/${procedure}?batch=1&input=${inputParam}`;

  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    cfg.timeout
  );

  return unwrapBatch<T>(await res.json(), procedure);
}

/**
 * Call a tRPC mutation procedure via POST batch (tRPC v10 protocol).
 */
export async function tRPCMutate<T>(
  cfg: SmokeConfig,
  procedure: string,
  input: unknown = null,
  token?: string
): Promise<T> {
  const url = `${cfg.serverUrl}/trpc/${procedure}?batch=1`;

  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ '0': { json: input } }),
    },
    cfg.timeout
  );

  return unwrapBatch<T>(await res.json(), procedure);
}

function unwrapBatch<T>(json: unknown, procedure: string): T {
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error(
      `tRPC ${procedure}: unexpected response shape — ${JSON.stringify(json).slice(0, 200)}`
    );
  }
  const first = json[0] as Record<string, unknown>;
  if ('error' in first) {
    const err = first.error as Record<string, unknown>;
    const msg = (err?.message as string) ?? JSON.stringify(err);
    throw new Error(`tRPC ${procedure}: ${msg}`);
  }
  const result = first.result as Record<string, unknown> | undefined;
  const data = result?.data as Record<string, unknown> | undefined;
  // tRPC v10 wraps in { json: ... } for superjson transformer
  return (data?.json ?? data) as T;
}

// ── Raw REST helpers ──────────────────────────────────────────────────────────

export async function rawGet(
  cfg: SmokeConfig,
  path: string,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const url = `${cfg.serverUrl}${path}`;
  const res = await fetchWithTimeout(
    url,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    cfg.timeout
  );

  let body: unknown;
  const ct = res.headers.get('content-type') ?? '';
  try {
    body = ct.includes('json') ? await res.json() : await res.text();
  } catch {
    body = null;
  }

  return { status: res.status, body };
}

export async function rawPost(
  cfg: SmokeConfig,
  path: string,
  payload: unknown,
  token?: string
): Promise<{ status: number; body: unknown }> {
  const url = `${cfg.serverUrl}${path}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    },
    cfg.timeout
  );

  let body: unknown;
  const ct = res.headers.get('content-type') ?? '';
  try {
    body = ct.includes('json') ? await res.json() : await res.text();
  } catch {
    body = null;
  }

  return { status: res.status, body };
}

/** GET against the indexer (different base URL). */
export async function indexerGet(
  cfg: SmokeConfig,
  path: string
): Promise<{ status: number; body: unknown }> {
  const url = `${cfg.indexerUrl}${path}`;
  const res = await fetchWithTimeout(url, {}, cfg.timeout);

  let body: unknown;
  const ct = res.headers.get('content-type') ?? '';
  try {
    body = ct.includes('json') ? await res.json() : await res.text();
  } catch {
    body = null;
  }

  return { status: res.status, body };
}

/** POST a GraphQL query to the indexer. */
export async function indexerGraphQL<T>(
  cfg: SmokeConfig,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const url = `${cfg.indexerUrl}/graphql`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    },
    cfg.timeout
  );

  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors?.length) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors[0])}`);
  }
  if (!json.data) throw new Error('GraphQL: no data in response');
  return json.data;
}

// ── SIWE helpers (mirrors apps/server/src/lib/siwe.ts, no server import) ─────

export function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  chainId: number;
  statement?: string;
}): string {
  const now = new Date().toISOString();
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address,
    '',
    params.statement ?? 'Sign in to LOAR',
    '',
    `URI: ${params.uri}`,
    `Version: 1`,
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${now}`,
  ].join('\n');
}

/** Build the message used by universes.create (verified by verifyMessage in the route). */
export function buildUniverseCreateMessage(address: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  return `Create universe as ${address} at ${timestamp}`;
}

// ── Fetch with timeout ────────────────────────────────────────────────────────

function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(id));
}
