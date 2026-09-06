/**
 * Unit tests for utils/img-proxy.ts — routes <img> thumbnails through the
 * server resize proxy (GET /api/img). Only IPFS-gateway URLs are proxied
 * (SSRF guard); everything else passes through as the bare resolved URL.
 *
 * SERVER_URL is read from import.meta.env at module load, so the
 * "configured" cases stub the env and re-import a fresh module.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESIZE_WIDTHS, proxiedImage, proxiedSrcSet } from '../img-proxy';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('RESIZE_WIDTHS', () => {
  it('is the fixed ascending rendition ladder', () => {
    expect(RESIZE_WIDTHS).toEqual([320, 480, 640, 960, 1280, 1600]);
  });
});

describe('no VITE_SERVER_URL configured (default test env)', () => {
  it('proxiedImage returns the bare resolved URL', () => {
    const out = proxiedImage('ipfs://QmABC/clip.png');
    expect(out).not.toContain('/api/img');
    expect(out).toContain('QmABC');
  });

  it('proxiedSrcSet returns undefined (nothing to proxy)', () => {
    expect(proxiedSrcSet('ipfs://QmABC/clip.png')).toBeUndefined();
  });

  it('handles null / undefined without throwing', () => {
    expect(() => proxiedImage(null)).not.toThrow();
    expect(() => proxiedImage(undefined)).not.toThrow();
    expect(proxiedSrcSet(null)).toBeUndefined();
  });
});

describe('with VITE_SERVER_URL configured', () => {
  async function freshModule(serverUrl: string) {
    vi.stubEnv('VITE_SERVER_URL', serverUrl);
    vi.resetModules();
    return import('../img-proxy');
  }

  it('points an IPFS gateway URL at /api/img with width + format=auto', async () => {
    const mod = await freshModule('https://srv.example.com/');
    const src = 'https://ipfs.io/ipfs/QmABC/clip.png';
    const out = mod.proxiedImage(src, 480);
    expect(out).toBe(
      `https://srv.example.com/api/img?url=${encodeURIComponent(src)}&w=480&format=auto`
    );
  });

  it('defaults to width 640', async () => {
    const mod = await freshModule('https://srv.example.com');
    expect(mod.proxiedImage('https://ipfs.io/ipfs/QmABC/clip.png')).toContain('&w=640');
  });

  it('builds a full srcset across every rendition width', async () => {
    const mod = await freshModule('https://srv.example.com');
    const src = 'https://ipfs.io/ipfs/QmABC/clip.png';
    const set = mod.proxiedSrcSet(src)!;
    expect(set).toBeDefined();
    const widths = [...set.matchAll(/&w=(\d+) /g)].map((m) => Number(m[1]));
    expect(widths).toEqual([320, 480, 640, 960, 1280, 1600]);
    expect(set.endsWith('1600w')).toBe(true);
  });

  it('does NOT proxy a non-IPFS source (local asset / data URI) — passthrough', async () => {
    const mod = await freshModule('https://srv.example.com');
    expect(mod.proxiedImage('/placeholder.jpg')).toBe('/placeholder.jpg');
    expect(mod.proxiedSrcSet('/placeholder.jpg')).toBeUndefined();
    expect(mod.proxiedImage('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
});
