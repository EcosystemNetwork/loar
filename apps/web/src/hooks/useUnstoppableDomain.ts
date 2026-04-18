/**
 * useUnstoppableDomain — Resolve Unstoppable Domains names and avatars
 * for wallet addresses via the public UD API.
 *
 * Uses the Unstoppable Domains public HTTP API instead of the SDK to avoid
 * bundling node-fetch, js-sha256, and other Node.js dependencies that crash
 * in browser ES module builds (require('crypto') / require('buffer')).
 */
import { useQuery } from '@tanstack/react-query';

const UD_API = 'https://api.unstoppabledomains.com';

/** Cache resolved profiles in memory to avoid repeated lookups */
const profileCache = new Map<string, { name: string | null; avatar: string | null }>();

/**
 * Resolve an Unstoppable Domains reverse record for a wallet address
 * using the public HTTP API (no SDK needed).
 */
async function resolveUD(address: string): Promise<{ name: string | null; avatar: string | null }> {
  const key = address.toLowerCase();
  const cached = profileCache.get(key);
  if (cached) return cached;

  try {
    const res = await fetch(`${UD_API}/resolve/reverse/${key}`);
    if (!res.ok) {
      const result = { name: null, avatar: null };
      profileCache.set(key, result);
      return result;
    }

    const data = await res.json();
    const name = data?.meta?.domain ?? null;
    const avatar = data?.records?.['social.picture.value'] ?? null;

    const result = { name, avatar };
    profileCache.set(key, result);
    return result;
  } catch {
    const result = { name: null, avatar: null };
    profileCache.set(key, result);
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
