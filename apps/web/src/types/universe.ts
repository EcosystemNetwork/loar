import { isAddressLikeUniverseId } from '@/lib/utils';

/**
 * Shared Universe type used across sidebar and editor components.
 *
 * Represents the merged view of on-chain + off-chain universe metadata
 * as returned by the server and consumed by the timeline editor UI.
 */
export interface UniverseData {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  portraitImageUrl?: string;

  /** On-chain timeline contract address (0x...) or Firestore doc ID for draft universes */
  address?: string;
  /** ERC-20 governance token address */
  tokenAddress?: string | null;
  /** Governor contract address */
  governanceAddress?: string | null;

  /** True for the default/sandbox universe (no blockchain) */
  isDefault?: boolean;

  /** Universe creator address */
  creator?: string;
  /** Human-readable universe name from on-chain or Firestore */
  universeName?: string;

  /** Access model */
  accessModel?: 'open' | 'subscription' | 'token_gate' | 'both';

  /** Label distinguishing sandbox/play universes from revenue-bearing ones. */
  universeType?: 'fun' | 'monetized';
}

/**
 * Check whether a universe's address looks like a blockchain address —
 * an EVM `0x…` contract address or a Solana base58 PDA — as opposed to a
 * human-readable slug. A bare `startsWith('0x')` check here misclassified
 * every Solana universe as non-blockchain, hiding UniverseSidebar's
 * blockchain-only controls (explorer link, admin panel, publish button) for
 * them. See `isAddressLikeUniverseId` for the EVM/Solana shape check this
 * mirrors.
 */
export function isBlockchainUniverse(u: UniverseData | null | undefined): boolean {
  return !!u?.address && isAddressLikeUniverseId(u.address);
}
