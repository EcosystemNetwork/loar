/**
 * useUnstoppableDomain — Resolve Unstoppable Domains names and avatars
 * for wallet addresses. Replaces ENS resolution (which requires mainnet).
 *
 * The @unstoppabledomains/resolution SDK uses node-fetch internally which
 * crashes in browser builds. We lazy-import it to prevent module-level crashes.
 */
import { useQuery } from '@tanstack/react-query';

/** Cache resolved profiles in memory to avoid repeated lookups */
const profileCache = new Map<string, { name: string | null; avatar: string | null }>();

/** Lazy-loaded Resolution instance — avoids module-level node-fetch crash */
let _resolution: any = null;
async function getResolution() {
  if (!_resolution) {
    try {
      const { default: Resolution } = await import('@unstoppabledomains/resolution');
      _resolution = new Resolution();
    } catch {
      // Package unavailable or failed to load — disable UD resolution
      _resolution = null;
    }
  }
  return _resolution;
}

/**
 * Resolve an Unstoppable Domains reverse record for a wallet address.
 * Returns { name, avatar } or nulls if no domain is registered.
 */
async function resolveUD(address: string): Promise<{ name: string | null; avatar: string | null }> {
  const cached = profileCache.get(address.toLowerCase());
  if (cached) return cached;

  try {
    const resolution = await getResolution();
    if (!resolution) {
      return { name: null, avatar: null };
    }

    // Reverse resolution: address → domain name
    const name = await resolution.reverse(address);

    let avatar: string | null = null;
    if (name) {
      try {
        avatar = await resolution.record(name, 'social.picture.value');
      } catch {
        // No avatar record
      }
    }

    const result = { name, avatar };
    profileCache.set(address.toLowerCase(), result);
    return result;
  } catch {
    const result = { name: null, avatar: null };
    profileCache.set(address.toLowerCase(), result);
    return result;
  }
}

/**
 * React hook to resolve an Unstoppable Domains name for a wallet address.
 */
export function useUnstoppableDomain(address: string | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['ud-domain', address?.toLowerCase()],
    queryFn: () => resolveUD(address!),
    enabled: !!address,
    staleTime: 5 * 60 * 1000,
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
