/**
 * Safe Multi-Sig Admin Check Utility
 *
 * Provides a unified `isUniverseAdmin()` function that recognises
 * both plain EOA creators and Safe multi-sig signers.
 *
 * For multi-sig universes (isMultiSig === true), the function calls
 * `getOwners()` on the Safe contract on-chain to verify the caller
 * is an authorised signer.
 */
import { createPublicClient, http } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { db } from './firebase';

// ── Chain clients (shared with privateSection.access.ts pattern) ──────
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});

const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
});

function getChainClient(chainId?: number) {
  if (chainId === baseSepolia.id) return baseSepoliaClient;
  return sepoliaClient;
}

// Minimal ABI for Gnosis Safe getOwners() — no SDK dependency needed
const SAFE_OWNERS_ABI = [
  {
    name: 'getOwners',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getThreshold',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

const universesCol = () => db.collection('cinematicUniverses');

// ── Public API ────────────────────────────────────────────────────────

/**
 * Check whether `callerAddress` is an admin of the given universe.
 *
 * Fast path: direct match on Firestore `creator` field.
 * Multi-sig path: if the universe doc has `isMultiSig: true`, call the
 * Safe contract's `getOwners()` and check membership.
 */
export async function isUniverseAdmin(universeId: string, callerAddress: string): Promise<boolean> {
  const id = universeId.toLowerCase();
  const caller = callerAddress.toLowerCase();

  const doc = await universesCol().doc(id).get();
  if (!doc.exists) return false;

  const data = doc.data()!;
  const creator = (data.creator as string | undefined)?.toLowerCase();

  // Fast path — single-owner universe
  if (creator === caller) return true;

  // Multi-sig path
  if (data.isMultiSig && data.multiSigAddress) {
    try {
      const safeAddress = (data.multiSigAddress as string).toLowerCase() as `0x${string}`;
      const owners = await getChainClient().readContract({
        address: safeAddress,
        abi: SAFE_OWNERS_ABI,
        functionName: 'getOwners',
      });

      return owners.some((o) => o.toLowerCase() === caller);
    } catch (err) {
      console.error(`[isUniverseAdmin] Safe getOwners() failed for ${id}:`, err);
      return false;
    }
  }

  return false;
}

/**
 * Get Safe info (owners + threshold) for a multi-sig universe.
 * Returns null for non-multi-sig universes or on failure.
 */
export async function getSafeInfo(
  safeAddress: string,
  chainId?: number
): Promise<{ owners: string[]; threshold: number } | null> {
  try {
    const client = getChainClient(chainId);
    const addr = safeAddress.toLowerCase() as `0x${string}`;

    const [owners, threshold] = await Promise.all([
      client.readContract({ address: addr, abi: SAFE_OWNERS_ABI, functionName: 'getOwners' }),
      client.readContract({ address: addr, abi: SAFE_OWNERS_ABI, functionName: 'getThreshold' }),
    ]);

    return {
      owners: owners.map((o) => o.toLowerCase()),
      threshold: Number(threshold),
    };
  } catch (err) {
    console.error(`[getSafeInfo] Failed for ${safeAddress}:`, err);
    return null;
  }
}

/**
 * Backwards-compatible helper — returns the raw creator/admin address.
 */
export async function getUniverseAdminAddress(universeId: string): Promise<string | null> {
  const doc = await universesCol().doc(universeId.toLowerCase()).get();
  if (!doc.exists) return null;
  return (doc.data()?.creator as string | undefined)?.toLowerCase() ?? null;
}
