/**
 * useUnstoppableDomain — Resolve Unstoppable Domains names and avatars
 * for wallet addresses. Replaces ENS resolution (which requires mainnet).
 *
 * Supports .crypto, .nft, .x, .wallet, .bitcoin, .dao, .888, .zil, etc.
 */
import { useQuery } from '@tanstack/react-query';
import Resolution from '@unstoppabledomains/resolution';

// Singleton — no API key needed for basic resolution (uses public UNS contracts)
const resolution = new Resolution();

/** Cache resolved profiles in memory to avoid repeated lookups */
const profileCache = new Map<string, { name: string | null; avatar: string | null }>();

/**
 * Resolve an Unstoppable Domains reverse record for a wallet address.
 * Returns { name, avatar } or nulls if no domain is registered.
 */
async function resolveUD(address: string): Promise<{ name: string | null; avatar: string | null }> {
  const cached = profileCache.get(address.toLowerCase());
  if (cached) return cached;

  try {
    // Reverse resolution: address → domain name
    const name = await resolution.reverse(address);

    let avatar: string | null = null;
    if (name) {
      try {
        // Try to get avatar/profile picture from domain records
        avatar = await resolution.record(name, 'social.picture.value');
      } catch {
        // No avatar record — that's fine
      }
    }

    const result = { name, avatar };
    profileCache.set(address.toLowerCase(), result);
    return result;
  } catch {
    // No UD domain for this address
    const result = { name: null, avatar: null };
    profileCache.set(address.toLowerCase(), result);
    return result;
  }
}

/**
 * React hook to resolve an Unstoppable Domains name for a wallet address.
 *
 * @param address - Ethereum address to resolve
 * @returns { name, avatar, isLoading } — name is the UD domain or null
 */
export function useUnstoppableDomain(address: string | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['ud-domain', address?.toLowerCase()],
    queryFn: () => resolveUD(address!),
    enabled: !!address,
    staleTime: 5 * 60 * 1000, // cache 5 minutes
    retry: false,
    refetchOnWindowFocus: false,
  });

  return {
    name: data?.name ?? null,
    avatar: data?.avatar ?? null,
    isLoading,
  };
}

/**
 * Format a display name — shows UD domain if available, otherwise truncated address.
 */
export function formatDisplayName(
  address: string | undefined,
  udName: string | null | undefined
): string {
  if (udName) return udName;
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
