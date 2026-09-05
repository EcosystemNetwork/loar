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

  it('falls back to the public path-style gateway when nothing is configured', async () => {
    delete process.env.PINATA_GATEWAY_URL;
    delete process.env.PINATA_GATEWAY_TOKEN;

    const json = await (await app().request('/api/ipfs/gateway-config')).json();
    expect(json.base).toBe('https://ipfs.io');
    expect(json.isDedicated).toBe(false);
    expect(json.token).toBe('');
  });
});
