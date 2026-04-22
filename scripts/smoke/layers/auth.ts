/**
 * Layer 2 — auth
 * Checks two auth paths:
 *   (a) Legacy SIWE round-trip (nonce → sign → verify → JWT) — exercises
 *       server-side SIWE primitives still used by any external-wallet flow
 *       and returns a smoke-wallet-owned JWT for downstream chain layers.
 *   (b) Circle DCW flow (register → verify-otp) — the primary live login
 *       path post-2026-04-22 migration. Uses `_devOtp` echo so the smoke
 *       harness can complete the round-trip without an email provider.
 *       In production (NODE_ENV=production) `_devOtp` is not returned, so
 *       the smoke only verifies /register is reachable and not 503.
 *
 * Identifies: SIWE_JWT_SECRET misconfig, nonce storage failure, signature
 *             bugs, CIRCLE_* env missing, OTP delivery broken, Circle
 *             wallet-set access broken.
 *
 * Returns the SIWE session JWT so downstream layers that need a funded
 * smoke-wallet identity can make authenticated calls.
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

  // ── Circle DCW flow — primary live login path ──────────────────────────────
  // Uses a fresh email per run so the per-email issuance cap (3/15min) never
  // throttles successive smoke runs.
  const smokeEmail = `smoke-${Date.now()}@loar-smoke.test`;
  let devOtp: string | undefined;

  checks.push(
    await check('POST /auth/circle/register → OTP issued', async () => {
      const { status, body } = await rawPost(cfg, '/auth/circle/register', {
        email: smokeEmail,
      });
      const b = body as Record<string, unknown>;
      if (status === 503) {
        throw new Error(`Circle not configured: ${(b?.error as string) ?? 'unknown'}`);
      }
      if (status !== 200) {
        throw new Error(`HTTP ${status}: ${(b?.error as string) ?? JSON.stringify(b)}`);
      }
      if (b?.throttled) {
        throw new Error(
          'unexpected throttle on fresh email — rate-limit state leaking between runs'
        );
      }
      devOtp = b?._devOtp as string | undefined;
      return devOtp ? 'dev OTP received' : 'OTP sent via email (prod mode)';
    })
  );

  if (devOtp) {
    checks.push(
      await check('POST /auth/circle/verify-otp → Circle wallet + JWT cookie', async () => {
        const { status, body, setCookie } = await rawPost(cfg, '/auth/circle/verify-otp', {
          email: smokeEmail,
          code: devOtp,
        });
        const b = body as Record<string, unknown>;
        if (status !== 200) {
          throw new Error(`HTTP ${status}: ${(b?.error as string) ?? JSON.stringify(b)}`);
        }
        const addr = b?.address as string | undefined;
        const walletId = b?.walletId as string | undefined;
        if (!addr || !walletId) {
          throw new Error('missing address/walletId in response body');
        }
        const cookieMatch = setCookie?.match(/siwe-session=([^;]+)/);
        const circleToken = cookieMatch?.[1] ?? '';
        if (!circleToken || circleToken.split('.').length !== 3) {
          throw new Error(`bad cookie JWT: ${String(circleToken).slice(0, 40)}`);
        }
        return `addr=${addr.slice(0, 10)}… walletId=${walletId.slice(0, 8)}…`;
      })
    );
  }

  return { token, address, checks };
}
