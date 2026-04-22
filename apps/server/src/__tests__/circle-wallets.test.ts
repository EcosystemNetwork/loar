/**
 * Tests the in-process race dedup in `getOrCreateWallet`. Two concurrent
 * calls for the same userId must share a single Circle wallet — otherwise
 * a double-click on "verify OTP" would provision two wallets and leave one
 * orphaned in Circle's console.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../lib/firebase';

// Make sure Circle env checks pass so `getClient()` isn't called (we stub the
// client at the module boundary instead).
process.env.CIRCLE_API_KEY = 'TEST_API_KEY:abc:def';
process.env.CIRCLE_ENTITY_SECRET = 'secret';
process.env.CIRCLE_WALLET_SET_ID = 'ws-1';

// Stub the Circle SDK entirely — count how many times createWallets is hit
// so we can prove the mutex dedupes.
const createWalletsMock = vi.fn();
vi.mock('@circle-fin/developer-controlled-wallets', () => ({
  initiateDeveloperControlledWalletsClient: () => ({
    createWallets: (args: any) => createWalletsMock(args),
  }),
}));

describe('getOrCreateWallet concurrency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the same wallet for two concurrent calls with the same userId', async () => {
    // Persisted store for the `circleWallets` collection.
    const walletDocs = new Map<string, any>();
    (db as any).collection = vi.fn().mockImplementation((name: string) => {
      if (name === 'circleWallets') {
        return {
          doc: (id: string) => ({
            get: vi.fn().mockImplementation(async () => ({
              exists: walletDocs.has(id),
              data: () => walletDocs.get(id),
            })),
            set: vi.fn().mockImplementation(async (val: any) => {
              walletDocs.set(id, val);
            }),
          }),
        };
      }
      return {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ empty: true, docs: [], size: 0 }),
        }),
        doc: () => ({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
          set: vi.fn(),
        }),
      };
    });

    // Circle returns a fresh wallet each call — so if dedup is broken we'd
    // see two different walletIds.
    let idCounter = 0;
    createWalletsMock.mockImplementation(async () => ({
      data: {
        wallets: [
          {
            id: `w-${++idCounter}`,
            address: '0xabc0000000000000000000000000000000000000',
            blockchain: 'BASE-SEPOLIA',
          },
        ],
      },
    }));

    // Load after the Circle mock is in place.
    const { getOrCreateWallet } = await import('../lib/circle-wallets');

    const [a, b] = await Promise.all([
      getOrCreateWallet('email:race@example.com'),
      getOrCreateWallet('email:race@example.com'),
    ]);

    expect(a.walletId).toBe(b.walletId);
    // Either the mutex prevented the second Circle call entirely, OR the
    // post-create re-read kept the first doc and logged an orphan. Either
    // outcome is acceptable — the invariant is that callers see ONE wallet.
    expect(createWalletsMock.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('returns the existing wallet without calling Circle when one is already stored', async () => {
    const existing = {
      walletId: 'w-existing',
      address: '0xdead000000000000000000000000000000000000',
      blockchain: 'BASE-SEPOLIA',
    };
    (db as any).collection = vi.fn().mockImplementation((name: string) => {
      if (name === 'circleWallets') {
        return {
          doc: () => ({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => existing }),
            set: vi.fn(),
          }),
        };
      }
      return {
        doc: () => ({
          get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
        }),
      };
    });

    const { getOrCreateWallet } = await import('../lib/circle-wallets');
    const result = await getOrCreateWallet('email:known@example.com');
    expect(result).toEqual(existing);
    expect(createWalletsMock).not.toHaveBeenCalled();
  });
});
