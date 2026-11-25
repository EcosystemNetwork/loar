/**
 * Product vocabulary guard. One word per concept, everywhere:
 *
 *   Credits — the usage balance (`userCredits`, /credits, generation costs)
 *   Points  — the activity score on /points-leaderboard (`userPoints`)
 *   $LOAR   — the token
 *   Sign in — the auth action (email/social; the wallet comes with the account)
 *
 * Scans UI source so a stray "Connect your wallet" or "N points" on a
 * credit amount fails CI instead of shipping.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { vocab } from '../web3-vocab';

const SRC = resolve(__dirname, '../..');

function uiFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : uiFiles(p);
    return /\.tsx$/.test(name) ? [p] : [];
  });
}

/** Non-comment lines matching `re`, as "file:line". */
function offenders(re: RegExp, allow: string[] = []): string[] {
  const out: string[] = [];
  for (const file of uiFiles()) {
    const rel = relative(SRC, file);
    if (allow.includes(rel)) continue;
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
        if (re.test(line)) out.push(`${rel}:${i + 1}`);
      });
  }
  return out;
}

describe('product vocabulary', () => {
  it('auth gates say "Sign in", not "Connect your wallet"', () => {
    // SIWE is a genuine wallet-signature flow for third-party OAuth clients.
    expect(offenders(/connect (your|an \w+) wallet/i, ['routes/oauth/siwe.tsx'])).toEqual([]);
  });

  it('credit amounts are never labelled points', () => {
    expect(offenders(/credit\w*[^\n]{0,40}\b(points?|pts)\b/i)).toEqual([]);
  });

  it('the token is never relabelled as credits', () => {
    for (const key of ['token', 'tokens', 'token-balance', 'staking'] as const) {
      expect(vocab(key, false)).not.toMatch(/credit/i);
    }
  });
});
