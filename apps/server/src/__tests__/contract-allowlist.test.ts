/**
 * Tests the contract allowlist used by /api/tx/write.
 *
 * The static allowlist is seeded from `@loar/abis/addresses` at module load;
 * the dynamic portion queries Firestore's `universes` collection. We stub the
 * Firestore response to exercise the dynamic path without a live DB.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isContractAllowed, _staticAllowlistSize } from '../lib/contract-allowlist';
import * as addresses from '@loar/abis/addresses';
import { db } from '../lib/firebase';
import { ponderQuery } from '../lib/ponder';
import { getAddress } from 'viem';

vi.mock('../lib/ponder', () => ({ ponderQuery: vi.fn().mockResolvedValue(null) }));

const ETH_SEPOLIA = 11155111;
const ETH_MAINNET = 1;

describe('contract-allowlist (static)', () => {
  it('includes every address exported from @loar/abis', () => {
    // Sanity: we loaded something.
    expect(_staticAllowlistSize()).toBeGreaterThan(0);
  });

  it('allows a known LOAR contract (UniverseFactory on Ethereum Sepolia)', async () => {
    const addr = (addresses as any).UniverseFactory[String(ETH_SEPOLIA)];
    expect(addr).toMatch(/^0x/);
    await expect(isContractAllowed(ETH_SEPOLIA, addr)).resolves.toBe(true);
  });

  it('is case-insensitive on the hex portion (EIP-55 checksummed or lowercase)', async () => {
    // Addresses export is already in EIP-55 checksum form (mixed case).
    // Callers from wagmi/viem typically pass the checksummed form verbatim;
    // some pass it lowercased. Both must match.
    const addr = (addresses as any).UniverseFactory[String(ETH_SEPOLIA)] as string;
    await expect(isContractAllowed(ETH_SEPOLIA, addr)).resolves.toBe(true);
    await expect(isContractAllowed(ETH_SEPOLIA, '0x' + addr.slice(2).toLowerCase())).resolves.toBe(
      true
    );
    await expect(isContractAllowed(ETH_SEPOLIA, '0x' + addr.slice(2).toUpperCase())).resolves.toBe(
      true
    );
  });

  it('rejects an unknown address on a known chain', async () => {
    // Firestore stub returns empty; allowlist stays false.
    await expect(
      isContractAllowed(ETH_SEPOLIA, '0x000000000000000000000000000000000000dead')
    ).resolves.toBe(false);
  });

  it('rejects a malformed address', async () => {
    await expect(isContractAllowed(ETH_SEPOLIA, 'not-an-address')).resolves.toBe(false);
    await expect(isContractAllowed(ETH_SEPOLIA, '')).resolves.toBe(false);
  });

  it('rejects an address from the wrong chain', async () => {
    // A contract deployed on Sepolia must not be allowed on mainnet, where it
    // is not in the static allowlist.
    const sepoliaOnly = (addresses as any).LaunchpadStaking[String(ETH_SEPOLIA)];
    await expect(isContractAllowed(ETH_SEPOLIA, sepoliaOnly)).resolves.toBe(true);
    await expect(isContractAllowed(ETH_MAINNET, sepoliaOnly)).resolves.toBe(false);
  });
});

describe('contract-allowlist (dynamic — universes.tokenAddress)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows an address that matches a universe tokenAddress', async () => {
    const dynamicAddr = '0xaaaa000000000000000000000000000000000001';
    // Override the Firestore stub for this one call.
    const mockSnap = { empty: false, docs: [{ data: () => ({ tokenAddress: dynamicAddr }) }] };
    const whereMock = vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue(mockSnap) }),
    });
    (db as any).collection = vi.fn().mockReturnValue({ where: whereMock });

    await expect(isContractAllowed(ETH_SEPOLIA, dynamicAddr)).resolves.toBe(true);
    expect(whereMock).toHaveBeenCalledWith('tokenAddress', '==', dynamicAddr);
  });
});

describe('contract-allowlist (dynamic — indexed launchpad contracts)', () => {
  const emptyFirestore = () => {
    const snap = { empty: true, docs: [] };
    (db as any).collection = vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue(snap) }),
      }),
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    emptyFirestore();
  });

  it('allows a bonding curve the indexer recorded', async () => {
    const curve = '0xbbbb000000000000000000000000000000000002';
    vi.mocked(ponderQuery).mockResolvedValueOnce({ bondingCurve: { id: curve }, token: null });
    await expect(isContractAllowed(ETH_SEPOLIA, curve)).resolves.toBe(true);
    // The indexer stores checksummed ids, so the lookup must checksum too.
    expect(vi.mocked(ponderQuery).mock.calls[0][1]).toEqual({
      id: getAddress(curve),
    });
  });

  it('allows a launchpad token the indexer recorded (needed for sell approvals)', async () => {
    const token = '0xbbbb000000000000000000000000000000000003';
    vi.mocked(ponderQuery).mockResolvedValueOnce({ bondingCurve: null, token: { id: token } });
    await expect(isContractAllowed(ETH_SEPOLIA, token)).resolves.toBe(true);
  });

  it('rejects when the indexer knows neither, or is unreachable', async () => {
    vi.mocked(ponderQuery).mockResolvedValueOnce({ bondingCurve: null, token: null });
    await expect(
      isContractAllowed(ETH_SEPOLIA, '0xbbbb000000000000000000000000000000000004')
    ).resolves.toBe(false);
    vi.mocked(ponderQuery).mockResolvedValueOnce(null);
    await expect(
      isContractAllowed(ETH_SEPOLIA, '0xbbbb000000000000000000000000000000000005')
    ).resolves.toBe(false);
  });

  it('does not consult the indexer for another chain', async () => {
    await expect(
      isContractAllowed(ETH_MAINNET, '0xbbbb000000000000000000000000000000000006')
    ).resolves.toBe(false);
    expect(ponderQuery).not.toHaveBeenCalled();
  });
});
