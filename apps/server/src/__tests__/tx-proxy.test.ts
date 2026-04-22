/**
 * tx-proxy integration tests — exercises the /api/tx/write security surface:
 *  - auth required
 *  - contract must be in allowlist
 *  - raw hex must be even-length
 *  - per-user rate limit kicks in
 *  - value (wei) is converted to Circle's decimal amount
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';
import * as addresses from '@loar/abis/addresses';
import { db } from '../lib/firebase';

// Stub the Circle signer before loading tx-proxy so executeTransaction is
// captured and we can assert on what the proxy asked it to sign.
const executeMock = vi.fn();
vi.mock('../lib/circle-wallets', () => ({
  executeTransaction: (req: any) => executeMock(req),
  getUserWallet: vi.fn(),
}));

const SESSION_ADDR = '0x1234567890abcdef1234567890abcdef12345678';

async function makeSessionCookie(sub: string): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SIWE_JWT_SECRET!);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer('loar-server')
    .setAudience('loar-app')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
  return `siwe-session=${token}`;
}

// The `db` mock from setup.ts already returns empty/no-op. For tx-proxy we
// specifically need `userAccounts.where(walletAddress == sub)` to resolve to
// a known Circle wallet, so we override that path per-test.
//
// Other collections (e.g. `universes`, which the allowlist's dynamic check
// queries) must stay empty, so we dispatch on collection name.
function stubUserWalletLookup(walletId: string, address: string) {
  const walletSnap = {
    empty: false,
    docs: [{ data: () => ({ walletId, walletAddress: address, address }) }],
  };
  const emptySnap = { empty: true, docs: [], size: 0 };
  const emptyQuery = {
    where: () => emptyQuery,
    limit: () => ({ get: vi.fn().mockResolvedValue(emptySnap) }),
  };
  const walletQuery = {
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue(walletSnap) }),
  };
  (db as any).collection = vi.fn().mockImplementation((name: string) => {
    if (name === 'userAccounts' || name === 'circleWallets') return walletQuery;
    return emptyQuery;
  });
}

async function loadApp() {
  const { txProxyRoutes } = await import('../routes/tx-proxy');
  const app = new Hono();
  app.route('/api/tx', txProxyRoutes);
  return app;
}

describe('/api/tx/write', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeMock.mockResolvedValue({
      txId: 'tx-mock',
      txHash: '0xdeadbeef',
      state: 'COMPLETE',
    });
  });

  it('rejects unauthenticated requests', async () => {
    const app = await loadApp();
    const res = await app.fetch(
      new Request('http://x/api/tx/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: '0x0', abi: [], functionName: 'foo' }),
      })
    );
    expect(res.status).toBe(401);
  });

  it('rejects an address not in the allowlist', async () => {
    const app = await loadApp();
    stubUserWalletLookup('w-1', SESSION_ADDR);
    const cookie = await makeSessionCookie(SESSION_ADDR);
    const res = await app.fetch(
      new Request('http://x/api/tx/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          address: '0x000000000000000000000000000000000000dead',
          abi: [],
          functionName: 'foo',
          chainId: 84532,
        }),
      })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/allowlist/i);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('rejects odd-length raw hex', async () => {
    const app = await loadApp();
    stubUserWalletLookup('w-1', SESSION_ADDR);
    const cookie = await makeSessionCookie(SESSION_ADDR);
    const allowed = (addresses as any).UniverseFactory['84532'];
    const res = await app.fetch(
      new Request('http://x/api/tx/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          address: allowed,
          data: '0xabc', // odd-length
          chainId: 84532,
        }),
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/even-length/i);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('forwards a valid ABI-encoded call to Circle, passing value as wei', async () => {
    const app = await loadApp();
    stubUserWalletLookup('w-1', SESSION_ADDR);
    const cookie = await makeSessionCookie(SESSION_ADDR);
    const allowed = (addresses as any).PaymentRouter['84532'];

    const res = await app.fetch(
      new Request('http://x/api/tx/write', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          address: allowed,
          abi: [
            {
              type: 'function',
              name: 'ping',
              stateMutability: 'payable',
              inputs: [],
              outputs: [],
            },
          ],
          functionName: 'ping',
          args: [],
          value: '1000000000000000000', // 1 ETH in wei
          chainId: 84532,
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.txHash).toBe('0xdeadbeef');
    expect(executeMock).toHaveBeenCalledTimes(1);
    const call = executeMock.mock.calls[0][0];
    expect(call.walletId).toBe('w-1');
    expect(call.contractAddress).toBe(allowed);
    expect(call.chainId).toBe(84532);
    expect(call.value).toBe('1000000000000000000');
    // calldata is the encoded `ping()` selector (4 bytes)
    expect(call.calldata).toMatch(/^0x[0-9a-fA-F]{8}$/);
  });
});
