/**
 * Unit tests for resolveActiveGateway() — the gateway-selection logic behind
 * a real production incident (2026-08-25): the deployed web build's
 * `VITE_PINATA_GATEWAY_URL` was set to a schemeless, malformed value
 * (`peach-impressive-moth-978.mypinata.cloud.` — no `https://`, stray
 * trailing dot). Because the old code only bypassed the configured gateway
 * when it successfully parsed AND resolved to a `.mypinata.cloud` host, an
 * *unparseable* value fell through neither check and got used verbatim as
 * `ACTIVE_GATEWAY`. `rewriteBrokenDedicatedGatewayUrl()` then baked that
 * broken string into every `.mypinata.cloud`-hosted video/image URL
 * app-wide, and because the corrupted result no longer parses as a URL at
 * all, `install-ipfs-fallback.ts`'s global onerror rotator couldn't
 * recognize it as a gateway URL to recover from either — so every piece of
 * media on the affected host permanently failed with no diagnostic trail.
 *
 * Confirmed live against production (`loar.fun`) via a headless-browser
 * admin-session check: two universes' ReactFlow timeline editors rendered
 * their full node/edge structure correctly (so this was never a graph-data
 * or pagination problem — see `universeGraphPaging.ts`) but every single
 * node showed the "Add Video" empty-media placeholder; the captured
 * `<source src>` on the failing elements was exactly
 * `peach-impressive-moth-978.mypinata.cloud./ipfs/<cid>/<file>` — no scheme.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveActiveGateway } from '../ipfs-url';

const PUBLIC_GATEWAY = 'https://ipfs.io';

describe('resolveActiveGateway', () => {
  it('bypasses to the public gateway for the exact malformed value seen in production', () => {
    // Missing "https://" and a stray trailing "." after the host — exactly
    // what shipped. `new URL(...)` throws on this; a real bug would use it
    // as a literal string prefix anyway.
    const malformed = 'peach-impressive-moth-978.mypinata.cloud.';
    const result = resolveActiveGateway(malformed, false, PUBLIC_GATEWAY);
    expect(result.activeGateway).toBe(PUBLIC_GATEWAY);
    expect(result.activeHost).toBe('ipfs.io');
  });

  it('never returns a value that fails to parse as an absolute URL', () => {
    const inputs = [
      undefined,
      '',
      '   ',
      'not a url at all',
      'peach-impressive-moth-978.mypinata.cloud.',
      'mypinata.cloud/ipfs', // missing scheme, no trailing dot
      '://broken',
      'https://', // scheme with no host
    ];
    for (const input of inputs) {
      const { activeGateway } = resolveActiveGateway(input, false, PUBLIC_GATEWAY);
      expect(() => new URL(activeGateway)).not.toThrow();
    }
  });

  it('uses a well-formed dedicated .mypinata.cloud gateway config for isDedicatedGateway, but still bypasses it for sync composition', () => {
    const result = resolveActiveGateway(
      'https://peach-impressive-moth-978.mypinata.cloud',
      false,
      PUBLIC_GATEWAY
    );
    expect(result.isDedicatedGateway).toBe(true);
    // Dedicated gateways need a server-signed URL (see resolveIpfsUrlAsync)
    // — synchronous composition always bypasses to the public gateway.
    expect(result.activeGateway).toBe(PUBLIC_GATEWAY);
  });

  it('uses a well-formed non-dedicated gateway config as-is', () => {
    const result = resolveActiveGateway('https://gateway.pinata.cloud', false, PUBLIC_GATEWAY);
    expect(result.isDedicatedGateway).toBe(false);
    expect(result.activeGateway).toBe('https://gateway.pinata.cloud');
    expect(result.activeHost).toBe('gateway.pinata.cloud');
  });

  it('strips a trailing slash from a well-formed configured gateway', () => {
    const result = resolveActiveGateway('https://gateway.pinata.cloud/', false, PUBLIC_GATEWAY);
    expect(result.activeGateway).toBe('https://gateway.pinata.cloud');
  });

  it('falls back to the public gateway when nothing is configured', () => {
    const result = resolveActiveGateway(undefined, false, PUBLIC_GATEWAY);
    expect(result.activeGateway).toBe(PUBLIC_GATEWAY);
    expect(result.activeHost).toBe('ipfs.io');
    expect(result.isDedicatedGateway).toBe(false);
  });

  it('falls back to the public gateway for an empty/whitespace-only configured value', () => {
    expect(resolveActiveGateway('', false, PUBLIC_GATEWAY).activeGateway).toBe(PUBLIC_GATEWAY);
    expect(resolveActiveGateway('   ', false, PUBLIC_GATEWAY).activeGateway).toBe(PUBLIC_GATEWAY);
  });

  it('bypasses a valid, non-dedicated configured gateway when preferPublic is set', () => {
    const result = resolveActiveGateway('https://gateway.pinata.cloud', true, PUBLIC_GATEWAY);
    expect(result.activeGateway).toBe(PUBLIC_GATEWAY);
  });

  it('never throws, regardless of input shape', () => {
    const weirdInputs = [
      'https://',
      'http://',
      '://',
      'https://[',
      'https://exa mple.com',
      'a'.repeat(5000),
    ];
    for (const input of weirdInputs) {
      expect(() => resolveActiveGateway(input, false, PUBLIC_GATEWAY)).not.toThrow();
    }
  });
});

/**
 * Regression coverage for a live-traffic bug (2026-09-04): every public
 * gateway HEAD probe failing (or cooling down) *faster* than our own
 * dedicated-gateway lookup (`resolveIpfsUrlAsync` → `/api/ipfs/resolve`)
 * used to fall back to the unverified public primary (`candidates[0]`)
 * immediately — even though the dedicated lookup was still in flight and,
 * in production, resolves reliably in well under a second. A near-instant
 * rejection (e.g. a CORS/`NotSameOrigin` block) on every public candidate
 * would win that race by default and lock in the one gateway just proven
 * dead, so ModelViewer/SmartImage/etc. loaded the doomed public URL instead
 * of waiting the extra beat for the dedicated one. Console symptom:
 * `ipfs.io` 504s + `gateway.pinata.cloud` 429s alongside
 * `net::ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` on the public candidates,
 * then `TypeError: Failed to fetch` from the GLTF/model loader.
 */
describe('raceIpfsGateways', () => {
  const DEDICATED_URL = 'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmTest123/file.glb';
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SERVER_URL', 'https://api.loar.test');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('waits for an in-flight dedicated-gateway resolve instead of locking in the public primary when every public probe fails fast', async () => {
    global.fetch = vi.fn((input: unknown, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : (input as Request).url;
      if (init?.method === 'HEAD') {
        // Every public gateway probe rejects near-instantly — e.g. exactly
        // what a CORS/NotSameOrigin block looks like from the caller's side.
        return Promise.reject(new Error('blocked'));
      }
      if (href.includes('/api/ipfs/resolve')) {
        // Real round trip to our own server — genuinely takes a beat, but
        // reliably succeeds (this is the case verified live in prod).
        return new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                json: async () => ({ url: DEDICATED_URL, expiresAt: Date.now() + 60_000 }),
              } as Response),
            15
          )
        );
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    }) as unknown as typeof fetch;

    const { raceIpfsGateways, getIpfsUrlCandidates } = await import('../ipfs-url');
    const src = 'ipfs://QmTest123/file.glb';
    const candidates = getIpfsUrlCandidates(src);
    expect(candidates.length).toBeGreaterThan(1);
    const publicPrimary = candidates[0];

    const result = await raceIpfsGateways(src, { timeoutMs: 500 });

    expect(result).toBe(DEDICATED_URL);
    expect(result).not.toBe(publicPrimary);
  });

  it('still falls back to the public primary if the dedicated resolve never lands before the timeout', async () => {
    global.fetch = vi.fn((_input: unknown, init?: RequestInit) => {
      if (init?.method === 'HEAD') return Promise.reject(new Error('blocked'));
      // Dedicated resolve hangs past the race timeout — the overall
      // setTimeout ceiling must still produce a usable result.
      return new Promise(() => {});
    }) as unknown as typeof fetch;

    const { raceIpfsGateways, getIpfsUrlCandidates } = await import('../ipfs-url');
    const src = 'ipfs://QmTest456/file.glb';
    const publicPrimary = getIpfsUrlCandidates(src)[0];

    const result = await raceIpfsGateways(src, { timeoutMs: 50 });

    expect(result).toBe(publicPrimary);
  });
});

/**
 * Coverage for the boot-time dedicated-gateway config (2026-09-05): first
 * paint used to start every asset on `ipfs.io` (the sync default) and only
 * upgrade to the fast dedicated Pinata gateway after a per-CID
 * `/api/ipfs/resolve` round trip or a 2.5s race timeout — which itself falls
 * back to `ipfs.io`. `primeIpfsGatewayConfig` fetches the gateway base +
 * token once per session so `resolveIpfsUrl` / `getIpfsUrlCandidates` can
 * compose the dedicated URL synchronously as the primary.
 */
describe('primeIpfsGatewayConfig / dedicated-gateway primary', () => {
  const originalFetch = global.fetch;
  const CFG = {
    base: 'https://peach-impressive-moth-978.mypinata.cloud',
    host: 'peach-impressive-moth-978.mypinata.cloud',
    token: 'tok_abc123',
    isDedicated: true,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_SERVER_URL', 'https://api.loar.test');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('leaves resolution on the public gateway until the config is primed', async () => {
    const { resolveIpfsUrl, getIpfsUrlCandidates } = await import('../ipfs-url');
    expect(resolveIpfsUrl('ipfs://QmCold/file.png')).toBe('https://ipfs.io/ipfs/QmCold/file.png');
    expect(getIpfsUrlCandidates('ipfs://QmCold/file.png')[0]).toBe(
      'https://ipfs.io/ipfs/QmCold/file.png'
    );
  });

  it('makes the dedicated gateway the sync primary once primed', async () => {
    global.fetch = vi.fn((input: unknown) => {
      const href = typeof input === 'string' ? input : (input as Request).url;
      if (href.includes('/api/ipfs/gateway-config')) {
        return Promise.resolve({ ok: true, json: async () => CFG } as Response);
      }
      return Promise.reject(new Error(`unexpected fetch: ${href}`));
    }) as unknown as typeof fetch;

    const { primeIpfsGatewayConfig, resolveIpfsUrl, getIpfsUrlCandidates } =
      await import('../ipfs-url');
    await primeIpfsGatewayConfig();

    const dedicated =
      'https://peach-impressive-moth-978.mypinata.cloud/ipfs/QmWarm/file.png?pinataGatewayToken=tok_abc123';
    expect(resolveIpfsUrl('ipfs://QmWarm/file.png')).toBe(dedicated);
    expect(resolveIpfsUrl('https://ipfs.io/ipfs/QmWarm/file.png')).toBe(dedicated);

    const candidates = getIpfsUrlCandidates('ipfs://QmWarm/file.png');
    expect(candidates[0]).toBe(dedicated);
    // Public gateways still trail as fallbacks for the onError chain.
    expect(candidates).toContain('https://ipfs.io/ipfs/QmWarm/file.png');
  });

  it('ignores a schemeless / corrupted base from the endpoint (no unparseable URL)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          base: 'peach-impressive-moth-978.mypinata.cloud.',
          host: 'peach-impressive-moth-978.mypinata.cloud',
          token: 't',
          isDedicated: true,
        }),
      } as Response)
    ) as unknown as typeof fetch;

    const { primeIpfsGatewayConfig, resolveIpfsUrl } = await import('../ipfs-url');
    await primeIpfsGatewayConfig();

    const out = resolveIpfsUrl('ipfs://QmBad/file.png');
    expect(out).toBe('https://ipfs.io/ipfs/QmBad/file.png');
    expect(() => new URL(out)).not.toThrow();
  });

  it('does not throw or wedge when the config endpoint is unreachable', async () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const { primeIpfsGatewayConfig, resolveIpfsUrl } = await import('../ipfs-url');
    await expect(primeIpfsGatewayConfig()).resolves.toBeUndefined();
    expect(resolveIpfsUrl('ipfs://QmX/f.png')).toBe('https://ipfs.io/ipfs/QmX/f.png');
  });
});
