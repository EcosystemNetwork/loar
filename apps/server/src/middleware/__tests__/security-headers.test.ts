/**
 * Regression test for a CSP-allowlist-drift bug.
 *
 * The dedicated Pinata gateway domain (peach-impressive-moth-978.mypinata.cloud)
 * became the primary host for node video URLs (see the 2026-09-05 "IPFS
 * first-paint dedicated gateway" work), but the connect-src allowlist that
 * permits the browser to actually fetch from it is declared independently in
 * three places: this middleware (API responses), apps/web/index.html's CSP
 * meta tag (the built SPA shell), and netlify.toml's header (the static
 * hosting layer that actually serves index.html in production). Updating one
 * without the other two silently CSP-blocks every node's video fetch in
 * production while local dev (which reads index.html directly) looks fine —
 * this has already happened twice (fixed in e5cf2470, then drifted again and
 * re-fixed in 945e12e8), and it read to users as "nodes won't populate" even
 * though the underlying node/graph data was always intact.
 *
 * This pins the gateway-domain subset of connect-src so a future gateway
 * addition to only one of the three surfaces fails here instead of failing
 * silently in a user's browser console.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { Hono } from 'hono';
import { securityHeaders } from '../security-headers';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');

/**
 * IPFS/pinning-gateway domains that raceIpfsGateways() (apps/web/src/utils/ipfs-url.ts)
 * and node video URLs can hit directly from the browser. Every surface below
 * must allow all of these in connect-src.
 */
const REQUIRED_GATEWAY_CONNECT_DOMAINS = [
  'https://*.pinata.cloud',
  'https://gateway.pinata.cloud',
  'https://*.mypinata.cloud',
  'https://*.lighthouse.storage',
  'https://w3s.link',
  'https://*.w3s.link',
  'https://ipfs.io',
  'https://dweb.link',
  'https://*.dweb.link',
];

function isGatewayDomain(source: string): boolean {
  return /pinata|lighthouse|w3s\.link|ipfs\.io|dweb\.link/.test(source);
}

function connectSrcSources(csp: string): string[] {
  const match = csp.match(/connect-src\s+([^;]+)/);
  if (!match) throw new Error('connect-src directive not found in CSP string');
  return match[1].trim().split(/\s+/);
}

async function getMiddlewareCsp(): Promise<string> {
  const app = new Hono();
  app.use('*', securityHeaders);
  app.get('/', (c) => c.text('ok'));
  const res = await app.request('/');
  const csp = res.headers.get('Content-Security-Policy');
  if (!csp) throw new Error('securityHeaders middleware did not set a CSP header');
  return csp;
}

function getIndexHtmlCsp(): string {
  const html = readFileSync(path.join(REPO_ROOT, 'apps/web/index.html'), 'utf-8');
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  if (!match) throw new Error('CSP meta tag not found in apps/web/index.html');
  return match[1];
}

function getNetlifyTomlCsp(): string {
  const toml = readFileSync(path.join(REPO_ROOT, 'netlify.toml'), 'utf-8');
  const match = toml.match(/Content-Security-Policy\s*=\s*"([^"]+)"/);
  if (!match) throw new Error('Content-Security-Policy not found in netlify.toml');
  return match[1];
}

describe('CSP gateway allowlist stays in sync across all three declaration sites', () => {
  it('security-headers.ts middleware connect-src allows every required gateway domain', async () => {
    const sources = connectSrcSources(await getMiddlewareCsp());
    for (const domain of REQUIRED_GATEWAY_CONNECT_DOMAINS) {
      expect(sources).toContain(domain);
    }
  });

  it("apps/web/index.html's CSP meta tag connect-src allows every required gateway domain", () => {
    const sources = connectSrcSources(getIndexHtmlCsp());
    for (const domain of REQUIRED_GATEWAY_CONNECT_DOMAINS) {
      expect(sources).toContain(domain);
    }
  });

  it("netlify.toml's CSP header connect-src allows every required gateway domain", () => {
    const sources = connectSrcSources(getNetlifyTomlCsp());
    for (const domain of REQUIRED_GATEWAY_CONNECT_DOMAINS) {
      expect(sources).toContain(domain);
    }
  });

  it('all three surfaces declare exactly the same gateway-domain connect-src set', async () => {
    const middlewareGateways = connectSrcSources(await getMiddlewareCsp())
      .filter(isGatewayDomain)
      .sort();
    const indexHtmlGateways = connectSrcSources(getIndexHtmlCsp()).filter(isGatewayDomain).sort();
    const netlifyGateways = connectSrcSources(getNetlifyTomlCsp()).filter(isGatewayDomain).sort();

    expect(indexHtmlGateways).toEqual(middlewareGateways);
    expect(netlifyGateways).toEqual(middlewareGateways);
  });
});
