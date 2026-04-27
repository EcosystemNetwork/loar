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
import { isAdminAddress } from './trpc';

// ── Chain clients (shared with privateSection.access.ts pattern) ──────
const sepoliaClient = createPublicClient({
  chain: sepolia,
  transport: http(process.env.RPC_URL ?? process.env.PONDER_RPC_URL_2 ?? ''),
});

const baseSepoliaClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL_BASE_SEPOLIA ?? ''),
});

export function getChainClient(chainId?: number) {
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
export async function isUniverseAdmin(
  universeId: string,
  callerAddress: string,
  chainId?: number
): Promise<boolean> {
  const id = universeId.toLowerCase();
  const caller = callerAddress.toLowerCase();

  // Platform-level admin override — addresses listed in ADMIN_ADDRESSES /
  // ADMIN_WALLET get edit access to every universe regardless of creator
  // or Safe membership. Decisions are logged to contentAuditLog by the
  // calling routes so admin actions are traceable.
  if (isAdminAddress(caller)) return true;

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
      // Use explicit chainId if provided, fall back to stored universe chainId, then Sepolia default
      const resolvedChainId = chainId ?? (data.chainId as number | undefined);
      const owners = await getChainClient(resolvedChainId).readContract({
        address: safeAddress,
        abi: SAFE_OWNERS_ABI,
        functionName: 'getOwners',
      });

      return owners.some((o) => o.toLowerCase() === caller);
    } catch (err) {
      // Log the RPC failure explicitly so it's distinguishable from a genuine
      // authorization denial. Returning false here could lock admins out if
      // the RPC is temporarily down.
      console.error(
        `[isUniverseAdmin] Safe getOwners() RPC failed for universe ${id} ` +
          `(safe: ${data.multiSigAddress}, caller: ${callerAddress}). ` +
          `Admin access DENIED due to RPC error — this may be a transient issue:`,
        err instanceof Error ? err.message : err
      );
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

// Minimal Ownable ABI for on-chain cross-checks.
const ABI_OWNABLE = [
  {
    name: 'owner',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const;

/**
 * INF-5 strict variant — verify the caller against the ON-CHAIN owner in
 * addition to the Firestore `creator` field, for universe contracts that
 * expose `owner()`. Use this from tRPC routes that move funds (e.g.
 * `universeTreasury.*`, `universeTeam.addMember`) so that a compromised
 * Firestore does not equal a compromised treasury.
 *
 * Fallback: if the universe has no `contractAddress` on file, OR the on-chain
 * read fails transiently, we defer to the existing `isUniverseAdmin` result.
 * The ceiling for "strict" is still the same auth chain; this call only adds
 * a positive chain confirmation when possible.
 */
export async function isUniverseAdminStrict(
  universeId: string,
  callerAddress: string,
  chainId?: number
): Promise<boolean> {
  const baseline = await isUniverseAdmin(universeId, callerAddress, chainId);
  if (!baseline) return false;

  const doc = await universesCol().doc(universeId.toLowerCase()).get();
  if (!doc.exists) return false;
  const data = doc.data()!;
  const contractAddress = data.contractAddress as string | undefined;
  if (!contractAddress) return baseline;

  // Multi-sig path already walks the chain via `getOwners()` inside
  // `isUniverseAdmin`; no additional read needed.
  if (data.isMultiSig) return baseline;

  try {
    const resolvedChainId = chainId ?? (data.chainId as number | undefined);
    const onchainOwner = (await getChainClient(resolvedChainId).readContract({
      address: contractAddress as `0x${string}`,
      abi: ABI_OWNABLE,
      functionName: 'owner',
    })) as string;
    return onchainOwner.toLowerCase() === callerAddress.toLowerCase();
  } catch (err) {
    // Transient RPC failures: fail CLOSED when the strict path is invoked,
    // because the whole point is defense-in-depth against Firestore lies.
    console.error(
      `[isUniverseAdminStrict] on-chain owner() failed for universe ${universeId} ` +
        `(contract: ${contractAddress}). Refusing strict admin check:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Broader than `isUniverseAdmin` — returns true if the caller is the universe
 * admin (creator or Safe signer) OR an active member of the universe team.
 * This is the chokepoint for "can this viewer see draft (non-canon) episodes
 * and other team-only content?".
 *
 * Returns false when `callerAddress` is undefined (anonymous public viewer).
 */
export async function isUniverseCollaborator(
  universeId: string,
  callerAddress: string | undefined,
  chainId?: number
): Promise<boolean> {
  if (!callerAddress) return false;
  if (await isUniverseAdmin(universeId, callerAddress, chainId)) return true;

  const docId = `${universeId.toLowerCase()}-${callerAddress.toLowerCase()}`;
  const teamDoc = await db.collection('universeTeamMembers').doc(docId).get();
  if (!teamDoc.exists) return false;
  return teamDoc.data()?.status === 'active';
}
