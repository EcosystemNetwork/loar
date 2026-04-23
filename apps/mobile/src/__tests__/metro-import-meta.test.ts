/**
 * WEB-10: guardrail for the Hermes `import.meta` shim.
 *
 * `metro.config.js` rewrites `import.meta.<x>` → `(undefined)` at bundle time,
 * but only for an explicit allowlist of packages. If a new thirdweb release
 * adds a new parent path (or a user `pnpm add`s a web-first dep that happens
 * to be imported), the shim silently skips that module and the app crashes
 * on Hermes at first runtime access.
 *
 * This test reads `metro.config.js`, extracts the allowlist, and cross-checks
 * against the set of thirdweb / crypto-wallet packages we actually import.
 * If a known consumer isn't covered, fail the build instead of waiting for
 * the crash report.
 *
 * Intentionally a unit test, not an e2e bundle-and-boot test — the full
 * bundle takes several minutes and is already covered by the EAS build
 * step. What we want here is a 50ms signal that the allowlist is honest.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

function readAllowlist(): string[] {
  const metroPath = path.resolve(__dirname, '../../metro.config.js');
  const src = readFileSync(metroPath, 'utf8');
  const match = src.match(/IMPORT_META_ALLOWLIST\s*=\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error('Could not find IMPORT_META_ALLOWLIST in metro.config.js');
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

describe('metro import.meta shim', () => {
  const allowlist = readAllowlist();

  // Known consumers — packages we actually depend on (transitively or
  // directly) that are documented to use `import.meta`. Extend when a new
  // thirdweb-style dep arrives.
  const REQUIRED_COVERAGE: Array<[name: string, matches: string[]]> = [
    ['thirdweb', ['thirdweb']],
    ['@thirdweb-dev', ['@thirdweb-dev', 'thirdweb']],
    ['viem/kzg', ['viem/utils/kzg']],
    ['ox (viem v2 internal)', ['ox']],
    ['brotli_wasm', ['brotli']],
    ['zustand', ['zustand']],
    ['redux-devtools-extension', ['redux-devtools-extension']],
  ];

  for (const [label, needles] of REQUIRED_COVERAGE) {
    test(`${label} covered by allowlist`, () => {
      const covered = needles.some((needle) => allowlist.includes(needle));
      expect(covered).toBe(true);
    });
  }

  test('allowlist contains only lowercase, path-safe strings', () => {
    for (const entry of allowlist) {
      expect(entry).toMatch(/^[@a-z0-9._/-]+$/);
      expect(entry.length).toBeLessThan(128);
    }
  });

  test('allowlist has no duplicates', () => {
    expect(new Set(allowlist).size).toBe(allowlist.length);
  });
});
