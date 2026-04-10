/**
 * Private Section — Access Resolution
 *
 * Determines a user's access level to a universe's private section
 * by checking (in order): creator → team membership → token holdings.
 *
 * Used by all privateSection procedures to gate reads and writes.
 */
import { db } from '../../lib/firebase';
import { createPublicClient, http, erc20Abi } from 'viem';
import { sepolia, baseSepolia } from 'viem/chains';
import { isUniverseAdmin } from '../../lib/safe-admin';

export type AccessLevel = 'admin' | 'team' | 'holders' | 'none';

// ── Chain clients for on-chain token balance checks ─────────────────
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

// ── Firestore helpers ───────────────────────────────────────────────

const universesCol = () => db.collection('cinematicUniverses');
const teamCol = () => db.collection('universeTeamMembers');
const configCol = () => db.collection('privateSectionConfig');

export interface PrivateSectionConfig {
  universeId: string;
  vaultEnabled: boolean;
  notesEnabled: boolean;
  holderMinPercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Resolve the caller's access level for a universe's private section.
 *
 * Priority:
 *   1. Universe creator → 'admin'
 *   2. Active team member with admin role → 'admin'
 *   3. Active team member (contributor/moderator) → 'team'
 *   4. Token holder above threshold → 'holders'
 *   5. Everyone else → 'none'
 */
export async function resolveAccessLevel(
  universeId: string,
  userUid: string,
  userAddress?: string
): Promise<AccessLevel> {
  const id = universeId.toLowerCase();
  const uid = userUid.toLowerCase();

  // 1. Check if caller is universe admin (supports Safe multi-sig signers)
  const universeDoc = await universesCol().doc(id).get();
  if (!universeDoc.exists) return 'none';

  const universeData = universeDoc.data();
  if (await isUniverseAdmin(id, uid)) return 'admin';

  // 2. Check team membership
  const teamDocId = `${id}-${uid}`;
  const teamDoc = await teamCol().doc(teamDocId).get();
  if (teamDoc.exists) {
    const teamData = teamDoc.data();
    if (teamData?.status === 'active') {
      if (teamData.role === 'admin') return 'admin';
      return 'team'; // contributor or moderator
    }
  }

  // Determine access model — universe owner can set: open | subscription | token_gate | both
  const accessModel = (universeData?.accessModel as string) || 'open';

  // Open access — everyone gets holder-level access
  if (accessModel === 'open') return 'holders';

  // 3. Check subscription (when model is subscription or both)
  if (accessModel === 'subscription' || accessModel === 'both') {
    try {
      const subDoc = await db.collection('subscriptions').doc(`${uid}-${id}`).get();
      if (subDoc.exists) {
        const subData = subDoc.data()!;
        const expiresAt = subData.expiresAt?.toDate?.() || new Date(0);
        if (expiresAt > new Date()) return 'holders';
      }
    } catch (err) {
      console.error('[resolveAccessLevel] Subscription check failed:', err);
    }
  }

  // 4. Check token holdings against configured threshold (when model is token_gate or both)
  if (accessModel === 'token_gate' || accessModel === 'both') {
    const address = userAddress?.toLowerCase();
    if (address) {
      const tokenAddress = universeData?.tokenAddress;
      if (tokenAddress && tokenAddress !== '0x0000000000000000000000000000000000000000') {
        try {
          const configDoc = await configCol().doc(id).get();
          const config = configDoc.data();
          const minPercentage = config?.holderMinPercentage ?? 1;

          const client = getChainClient();

          const [balance, totalSupply] = await Promise.all([
            client.readContract({
              address: tokenAddress as `0x${string}`,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address as `0x${string}`],
            }),
            client.readContract({
              address: tokenAddress as `0x${string}`,
              abi: erc20Abi,
              functionName: 'totalSupply',
            }),
          ]);

          if (totalSupply > 0n) {
            const ownershipPct = Number((balance * 10000n) / totalSupply) / 100;
            if (ownershipPct >= minPercentage) return 'holders';
          }
        } catch (err) {
          console.error('[resolveAccessLevel] Token balance check failed:', err);
        }
      }
    }
  }

  return 'none';
}

/**
 * Check if an access level meets the minimum required tier.
 * Tier hierarchy: admin > team > holders > none
 */
export function meetsAccessTier(
  userLevel: AccessLevel,
  requiredTier: 'admin' | 'team' | 'holders'
): boolean {
  const hierarchy: Record<AccessLevel, number> = {
    admin: 3,
    team: 2,
    holders: 1,
    none: 0,
  };
  return hierarchy[userLevel] >= hierarchy[requiredTier];
}
