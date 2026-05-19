/**
 * wallet-bridge — EVM ↔ Solana identity resolution that keeps `creatorUid`
 * queries finding a user's content regardless of which chain they signed in
 * via.
 *
 * Verifies the four behaviours that matter for production correctness:
 *   1. `recordWalletLink` writes both directions atomically.
 *   2. Malformed addresses are silently dropped (never crash a session-issue path).
 *   3. `lookupEvmForSolana` hits the O(1) walletLinks path when populated.
 *   4. The `circleSolanaWallets` fallback hydrates walletLinks for next time.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../lib/firebase';
import { recordWalletLink, lookupEvmForSolana, lookupSolanaForEvm } from '../lib/wallet-bridge';

const EVM = '0xabcdef0123456789abcdef0123456789abcdef01';
const SOL = 'So11111111111111111111111111111111111111112';

interface WalletLinkDoc {
  evmAddress: string;
  solanaAddress: string;
  source: string;
  linkedAt: Date;
}

interface CircleSolWallet {
  address: string;
  userId: string;
}

function installFirestoreStub() {
  const walletLinks = new Map<string, WalletLinkDoc>();
  const circleSolanaWallets = new Map<string, CircleSolWallet>();

  const batch = {
    set: vi.fn().mockImplementation((ref: any, val: WalletLinkDoc) => {
      walletLinks.set(ref.__key, val);
      return batch;
    }),
    commit: vi.fn().mockResolvedValue(undefined),
  };

  (db as any).batch = vi.fn().mockReturnValue(batch);

  (db as any).collection = vi.fn().mockImplementation((name: string) => {
    if (name === 'walletLinks') {
      return {
        doc: (id: string) => ({
          __key: id,
          get: vi.fn().mockImplementation(async () => ({
            exists: walletLinks.has(id),
            data: () => walletLinks.get(id),
          })),
          set: vi.fn().mockImplementation(async (val: WalletLinkDoc) => {
            walletLinks.set(id, val);
          }),
        }),
      };
    }
    if (name === 'circleSolanaWallets') {
      return {
        where: (field: string, _op: string, value: string) => ({
          limit: () => ({
            get: vi.fn().mockImplementation(async () => {
              const match = Array.from(circleSolanaWallets.values()).find(
                (r) => (r as any)[field] === value
              );
              return match
                ? { empty: false, docs: [{ data: () => match }] }
                : { empty: true, docs: [] };
            }),
          }),
        }),
      };
    }
    // Default: empty collection
    return {
      doc: () => ({
        get: vi.fn().mockResolvedValue({ exists: false, data: () => null }),
        set: vi.fn(),
      }),
      where: () => ({
        limit: () => ({ get: vi.fn().mockResolvedValue({ empty: true, docs: [] }) }),
      }),
    };
  });

  return { walletLinks, circleSolanaWallets };
}

describe('wallet-bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordWalletLink', () => {
    it('writes the same link doc keyed by both EVM and Solana addresses', async () => {
      const { walletLinks } = installFirestoreStub();

      await recordWalletLink({
        evmAddress: EVM,
        solanaAddress: SOL,
        source: 'siws-link',
      });

      expect(walletLinks.has(EVM.toLowerCase())).toBe(true);
      expect(walletLinks.has(SOL)).toBe(true);
      const fromEvm = walletLinks.get(EVM.toLowerCase())!;
      const fromSol = walletLinks.get(SOL)!;
      expect(fromEvm.evmAddress).toBe(EVM.toLowerCase());
      expect(fromEvm.solanaAddress).toBe(SOL);
      expect(fromSol.evmAddress).toBe(EVM.toLowerCase());
      expect(fromSol.solanaAddress).toBe(SOL);
    });

    it('silently drops malformed EVM addresses without throwing', async () => {
      const { walletLinks } = installFirestoreStub();

      await expect(
        recordWalletLink({
          evmAddress: 'platform_bridge_signer_v1',
          solanaAddress: SOL,
          source: 'circle-provision',
        })
      ).resolves.toBeUndefined();

      expect(walletLinks.size).toBe(0);
    });

    it('silently drops malformed Solana addresses without throwing', async () => {
      const { walletLinks } = installFirestoreStub();

      await expect(
        recordWalletLink({
          evmAddress: EVM,
          solanaAddress: 'not-a-real-pubkey',
          source: 'siws-link',
        })
      ).resolves.toBeUndefined();

      expect(walletLinks.size).toBe(0);
    });
  });

  describe('lookupEvmForSolana', () => {
    it('returns null when no link and no Circle wallet exists', async () => {
      installFirestoreStub();
      const result = await lookupEvmForSolana(SOL);
      expect(result).toBeNull();
    });

    it('returns the linked EVM via the O(1) walletLinks path', async () => {
      const { walletLinks } = installFirestoreStub();
      walletLinks.set(SOL, {
        evmAddress: EVM.toLowerCase(),
        solanaAddress: SOL,
        source: 'siws-link',
        linkedAt: new Date(),
      });

      const result = await lookupEvmForSolana(SOL);
      expect(result).toBe(EVM.toLowerCase());
    });

    it('falls back to circleSolanaWallets when no walletLinks entry exists', async () => {
      const { walletLinks, circleSolanaWallets } = installFirestoreStub();
      circleSolanaWallets.set('key', { address: SOL, userId: EVM.toLowerCase() });

      const result = await lookupEvmForSolana(SOL);
      expect(result).toBe(EVM.toLowerCase());

      // Hydration is fire-and-forget; flush microtasks so the batch commits.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(walletLinks.has(SOL)).toBe(true);
    });

    it('rejects malformed Solana addresses up front', async () => {
      installFirestoreStub();
      const result = await lookupEvmForSolana('not-a-pubkey');
      expect(result).toBeNull();
    });
  });

  describe('lookupSolanaForEvm', () => {
    it('returns the linked Solana via the walletLinks path', async () => {
      const { walletLinks } = installFirestoreStub();
      walletLinks.set(EVM.toLowerCase(), {
        evmAddress: EVM.toLowerCase(),
        solanaAddress: SOL,
        source: 'circle-provision',
        linkedAt: new Date(),
      });

      const result = await lookupSolanaForEvm(EVM);
      expect(result).toBe(SOL);
    });

    it('falls back to circleSolanaWallets keyed on userId', async () => {
      const { circleSolanaWallets } = installFirestoreStub();
      circleSolanaWallets.set('key', { address: SOL, userId: EVM.toLowerCase() });

      const result = await lookupSolanaForEvm(EVM);
      expect(result).toBe(SOL);
    });

    it('rejects malformed EVM addresses up front', async () => {
      installFirestoreStub();
      const result = await lookupSolanaForEvm('0xdeadbeef');
      expect(result).toBeNull();
    });
  });
});
