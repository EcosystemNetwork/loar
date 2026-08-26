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
import { describe, expect, it } from 'vitest';
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
