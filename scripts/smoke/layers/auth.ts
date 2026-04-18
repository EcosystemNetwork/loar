/**
 * Layer 2 — auth
 * Checks: full SIWE round-trip (nonce → sign → verify → JWT) using the
 * primary smoke-test wallet.
 * Identifies: SIWE_JWT_SECRET misconfiguration, Firebase nonce storage failure,
 *             signature verification bugs.
 *
 * Returns the session JWT so downstream layers can make authenticated calls.
 */
import { privateKeyToAccount } from 'viem/accounts';
import type { SmokeConfig } from '../config.ts';
import { rawGet, rawPost, buildSiweMessage } from '../client.ts';
import { SMOKE_WALLETS } from '../fixtures.ts';
import { check, type CheckResult } from '../reporter.ts';

export interface AuthResult {
  token: string;
  address: string;
  checks: CheckResult[];
}

export async function runAuthLayer(cfg: SmokeConfig): Promise<AuthResult> {
  const checks: CheckResult[] = [];
  let token = '';
  const address = SMOKE_WALLETS.primary.address;
  const account = privateKeyToAccount(SMOKE_WALLETS.primary.privateKey);

  // 1. Fetch nonce
  let nonce = '';
  checks.push(
    await check('GET /auth/nonce → nonce issued', async () => {
      const { status, body } = await rawGet(cfg, '/auth/nonce');
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const b = body as Record<string, unknown>;
      nonce = (b?.nonce as string) ?? '';
      if (!/^[a-f0-9]{64}$/.test(nonce)) {
        throw new Error(`bad nonce format: ${nonce.slice(0, 20)}`);
      }
      return `${nonce.slice(0, 8)}…`;
    })
  );

  if (!nonce) return { token, address, checks };

  // 2. Build and sign SIWE message
  let message = '';
  let signature: `0x${string}` = '0x';

  checks.push(
    await check('Sign SIWE message with smoke-test-1 wallet', async () => {
      message = buildSiweMessage({
        domain: 'localhost',
        address,
        uri: cfg.serverUrl,
        nonce,
        chainId: cfg.chainId,
      });
      signature = await account.signMessage({ message });
      if (!signature.startsWith('0x') || signature.length < 130) {
        throw new Error(`unexpected signature length: ${signature.length}`);
      }
      return `sig ${signature.slice(0, 10)}…`;
    })
  );

  if (!message || signature === '0x') return { token, address, checks };

  // 3. POST /auth/verify → JWT (set as httpOnly cookie siwe-session=<jwt>)
  checks.push(
    await check('POST /auth/verify → JWT issued', async () => {
      const { status, body, setCookie } = await rawPost(cfg, '/auth/verify', {
        message,
        signature,
      });
      if (status !== 200) {
        const msg = (body as Record<string, unknown>)?.error ?? JSON.stringify(body);
        throw new Error(`HTTP ${status}: ${msg}`);
      }
      // Server returns { address, chain, expiresAt } in body and sets the JWT
      // as an httpOnly cookie named `siwe-session`. Extract the JWT for use
      // as a Bearer token on subsequent authenticated requests.
      const cookieMatch = setCookie?.match(/siwe-session=([^;]+)/);
      token = cookieMatch?.[1] ?? '';
      if (!token || token.split('.').length !== 3) {
        throw new Error(`unexpected token format: ${String(token).slice(0, 40)}`);
      }
      // Decode header to confirm HS256
      const [, payloadB64] = token.split('.');
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      if (!payload.sub) throw new Error('JWT missing sub claim');
      return `sub=${payload.sub.slice(0, 10)}… exp=${new Date((payload.exp ?? 0) * 1000).toISOString().slice(0, 10)}`;
    })
  );

  return { token, address, checks };
}
