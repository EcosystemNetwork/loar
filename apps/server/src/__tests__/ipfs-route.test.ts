/**
 * /api/ipfs route tests — focuses on `gateway-config`, the endpoint the web
 * client primes once per session so it can compose dedicated-gateway URLs
 * synchronously for first paint (see apps/web/src/utils/ipfs-url.ts
 * `primeIpfsGatewayConfig`). `/resolve` behaviour is covered incidentally.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { ipfsRoutes } from '../routes/ipfs';

function app() {
  const a = new Hono();
  a.route('/api/ipfs', ipfsRoutes);
  return a;
}

const ENV_KEYS = ['PINATA_GATEWAY_URL', 'PINATA_GATEWAY_TOKEN'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]])) as typeof saved;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('GET /api/ipfs/gateway-config', () => {
  it('returns the dedicated gateway base + token when configured', async () => {
    process.env.PINATA_GATEWAY_URL = 'https://peach-impressive-moth-978.mypinata.cloud';
    process.env.PINATA_GATEWAY_TOKEN = 'tok_abc123';

    const res = await app().request('/api/ipfs/gateway-config');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      base: 'https://peach-impressive-moth-978.mypinata.cloud',
      host: 'peach-impressive-moth-978.mypinata.cloud',
      token: 'tok_abc123',
      isDedicated: true,
    });
  });

  it('never leaks a token for a non-dedicated (public) gateway', async () => {
    process.env.PINATA_GATEWAY_URL = 'https://gateway.pinata.cloud';
    process.env.PINATA_GATEWAY_TOKEN = 'tok_should_not_appear';

    const json = await (await app().request('/api/ipfs/gateway-config')).json();
    expect(json.isDedicated).toBe(false);
    expect(json.token).toBe('');
  });

  it('treats a custom domain fronting the dedicated gateway (e.g. media.loar.fun) as dedicated too', async () => {
    // Regression, 2026-09-19: Pinata started refusing to serve content
    // through the bare *.mypinata.cloud subdomain, fixed by pointing
    // PINATA_GATEWAY_URL at a custom domain. isDedicatedGateway() must not
    // be hardcoded to the `.mypinata.cloud` shape, or switching domains
    // silently stops the token from being issued/appended again.
    process.env.PINATA_GATEWAY_URL = 'https://media.loar.fun';
    process.env.PINATA_GATEWAY_TOKEN = 'tok_custom_domain';

    const res = await app().request('/api/ipfs/gateway-config');
    const json = await res.json();
    expect(json).toMatchObject({
      base: 'https://media.loar.fun',
      host: 'media.loar.fun',
      token: 'tok_custom_domain',
      isDedicated: true,
    });

    const resolveJson = await (
      await app().request('/api/ipfs/resolve?url=QmQkCrfsjiPk5vkZPU4XcESetNLDrmLeqjV3SLANYUooyC')
    ).json();
    expect(resolveJson.url).toBe(
      'https://media.loar.fun/ipfs/QmQkCrfsjiPk5vkZPU4XcESetNLDrmLeqjV3SLANYUooyC?pinataGatewayToken=tok_custom_domain'
    );
  });

  it('falls back to the public path-style gateway when nothing is configured', async () => {
    delete process.env.PINATA_GATEWAY_URL;
    delete process.env.PINATA_GATEWAY_TOKEN;

    const json = await (await app().request('/api/ipfs/gateway-config')).json();
    expect(json.base).toBe('https://ipfs.io');
    expect(json.isDedicated).toBe(false);
    expect(json.token).toBe('');
  });
});
