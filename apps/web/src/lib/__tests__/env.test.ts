/**
 * Unit tests for lib/env.ts — the VITE_ env schema. The tricky parts are
 * the preprocessors: empty strings must become undefined (so unset Vite
 * vars pass `.optional()`), and placeholder / malformed addresses must be
 * dropped rather than failing validation.
 */
import { describe, expect, it, vi } from 'vitest';
import { envSchema } from '../env';

describe('envSchema — optionalString', () => {
  it('accepts a real value', () => {
    const r = envSchema.parse({ VITE_SERVER_URL: 'https://api.example.com' });
    expect(r.VITE_SERVER_URL).toBe('https://api.example.com');
  });

  it('coerces "" to undefined so an unset var still validates', () => {
    const r = envSchema.parse({ VITE_SERVER_URL: '' });
    expect(r.VITE_SERVER_URL).toBeUndefined();
  });

  it('leaves a genuinely absent key undefined', () => {
    expect(envSchema.parse({}).VITE_PONDER_URL).toBeUndefined();
  });
});

describe('envSchema — optionalAddress (VITE_TREASURY_ADDRESS)', () => {
  it('accepts a valid 0x-address', () => {
    const addr = '0x' + 'a'.repeat(40);
    expect(envSchema.parse({ VITE_TREASURY_ADDRESS: addr }).VITE_TREASURY_ADDRESS).toBe(addr);
  });

  it('drops an empty string to undefined', () => {
    expect(envSchema.parse({ VITE_TREASURY_ADDRESS: '' }).VITE_TREASURY_ADDRESS).toBeUndefined();
  });

  it('drops a placeholder like "0x..." to undefined (logs an info, does not throw)', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const r = envSchema.parse({ VITE_TREASURY_ADDRESS: '0x...' });
    expect(r.VITE_TREASURY_ADDRESS).toBeUndefined();
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it('drops a wrong-length hex value to undefined rather than failing', () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    expect(
      envSchema.parse({ VITE_TREASURY_ADDRESS: '0x' + 'a'.repeat(39) }).VITE_TREASURY_ADDRESS
    ).toBeUndefined();
  });
});

describe('envSchema — overall', () => {
  it('safeParse succeeds on a fully-empty env (every field optional)', () => {
    expect(envSchema.safeParse({}).success).toBe(true);
  });

  it('passes through the full public config set', () => {
    const full = {
      VITE_SERVER_URL: 'https://api',
      VITE_PONDER_URL: 'https://ponder',
      VITE_PINATA_GATEWAY_URL: 'https://gw',
      VITE_WALLETCONNECT_PROJECT_ID: 'wc123',
      VITE_FIREBASE_PROJECT_ID: 'proj',
      VITE_POSTHOG_KEY: 'phc_x',
    };
    expect(envSchema.parse(full)).toMatchObject(full);
  });
});
