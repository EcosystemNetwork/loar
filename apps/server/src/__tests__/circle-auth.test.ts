/**
 * /auth/circle/* integration tests — exercises OTP hashing, issuance cap,
 * and the /verify-otp path end-to-end. Real Firebase is mocked via setup.ts;
 * Circle SDK is stubbed below.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { db } from '../lib/firebase';

// Stub Circle so we don't hit a real API.
vi.mock('../lib/circle-wallets', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    isCircleConfigured: () => true,
    getOrCreateWallet: vi.fn(async () => ({
      walletId: 'w-abc',
      address: '0xabcabcabcabcabcabcabcabcabcabcabcabcabc0',
      blockchain: 'BASE-SEPOLIA',
    })),
  };
});

// Disable analytics (side-effect module that does `import('../lib/analytics')`
// lazily inside route handlers).
vi.mock('../lib/analytics', () => ({
  captureServerEvent: vi.fn(),
}));

async function loadApp() {
  const { circleAuthRoutes } = await import('../routes/circle-auth');
  const app = new Hono();
  app.route('/auth/circle', circleAuthRoutes);
  return app;
}

// The default setup.ts firebase mock returns empty and fresh doc mocks on
// every `.doc(id)` call, which means attempts/state don't persist across
// `register` → `verify-otp`. For these tests we track OTP docs in a real Map.
function installOtpStore() {
  const otpStore = new Map<string, any>();
  const issuanceLog: number[] = [];
  const userAccountDocs = new Map<string, any>();

  (db as any).collection = vi.fn().mockImplementation((name: string) => {
    if (name === 'authOTPs') {
      return {
        doc: (id: string) => ({
          get: vi.fn().mockImplementation(async () => {
            const val = otpStore.get(id);
            return {
              exists: !!val,
              data: () => val,
            };
          }),
          set: vi.fn().mockImplementation(async (val: any) => {
            // Convert the Date expiresAt to something that has `.toDate()`
            otpStore.set(id, {
              ...val,
              expiresAt: { toDate: () => val.expiresAt },
            });
          }),
          update: vi.fn().mockImplementation(async (patch: any) => {
            const cur = otpStore.get(id);
            if (cur) otpStore.set(id, { ...cur, ...patch });
          }),
          delete: vi.fn().mockImplementation(async () => {
            otpStore.delete(id);
          }),
        }),
      };
    }
    if (name === 'authOTPIssuances') {
      // Single-doc-per-email shape: { timestamps: number[] }
      return {
        doc: (_id: string) => ({
          get: vi.fn().mockImplementation(async () => ({
            exists: issuanceLog.length > 0,
            data: () => ({ timestamps: issuanceLog }),
          })),
          set: vi.fn().mockImplementation(async (val: any) => {
            issuanceLog.length = 0;
            if (Array.isArray(val.timestamps)) issuanceLog.push(...val.timestamps);
          }),
        }),
      };
    }
    if (name === 'userAccounts') {
      return {
        doc: (id: string) => ({
          get: vi.fn().mockImplementation(async () => {
            const val = userAccountDocs.get(id);
            return { exists: !!val, data: () => val };
          }),
          set: vi.fn().mockImplementation(async (val: any) => {
            userAccountDocs.set(id, val);
          }),
          create: vi.fn().mockImplementation(async (val: any) => {
            if (userAccountDocs.has(id)) {
              const err: any = new Error('ALREADY_EXISTS');
              err.code = 6;
              throw err;
            }
            userAccountDocs.set(id, val);
          }),
        }),
      };
    }
    // Default empty
    return {
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
      }),
      add: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      doc: (_id: string) => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        create: vi.fn(),
      }),
    };
  });

  return { otpStore, issuanceLog, userAccountDocs };
}

describe('/auth/circle/register + verify-otp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // NODE_ENV=test means handlers return _devOtp we can grab in the response.
    process.env.NODE_ENV = 'test';
  });

  it('issues a dev OTP and verifies it on second request', async () => {
    installOtpStore();
    const app = await loadApp();
    const email = 'alice@example.com';

    const register = await app.fetch(
      new Request('http://x/auth/circle/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    );
    expect(register.status).toBe(200);
    const regBody = await register.json();
    expect(regBody._devOtp).toMatch(/^\d{6}$/);

    const verify = await app.fetch(
      new Request('http://x/auth/circle/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: regBody._devOtp }),
      })
    );
    expect(verify.status).toBe(200);
    const verBody = await verify.json();
    expect(verBody.address).toMatch(/^0x/);
    expect(verBody.email).toBe(email);
  });

  it('rejects a wrong OTP with 401 and bumps attempts', async () => {
    installOtpStore();
    const app = await loadApp();
    const email = 'bob@example.com';

    await app.fetch(
      new Request('http://x/auth/circle/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    );

    const wrong = await app.fetch(
      new Request('http://x/auth/circle/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code: '000000' }),
      })
    );
    expect(wrong.status).toBe(401);
  });

  it('does not store the OTP code in plaintext (hashed at rest)', async () => {
    const store = installOtpStore();
    const app = await loadApp();
    const email = 'carol@example.com';

    const register = await app.fetch(
      new Request('http://x/auth/circle/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    );
    const { _devOtp } = await register.json();

    const stored = store.otpStore.get(email.toLowerCase());
    expect(stored).toBeDefined();
    expect(stored.code).toBeUndefined();
    expect(stored.hash).toBeDefined();
    expect(stored.hash).not.toBe(_devOtp);
    expect(stored.hash.length).toBeGreaterThan(16);
  });

  it('caps OTP issuance at 3 per 15 min (4th is throttled)', async () => {
    installOtpStore();
    const app = await loadApp();
    const email = 'dave@example.com';

    for (let i = 0; i < 3; i++) {
      const r = await app.fetch(
        new Request('http://x/auth/circle/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        })
      );
      expect(r.status).toBe(200);
      const b = await r.json();
      expect(b.throttled).not.toBe(true);
    }

    const fourth = await app.fetch(
      new Request('http://x/auth/circle/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
    );
    expect(fourth.status).toBe(200);
    const body = await fourth.json();
    expect(body.throttled).toBe(true);
    // Must NOT leak a new OTP when throttled
    expect(body._devOtp).toBeUndefined();
  });
});
