/**
 * useUnstoppableDomain — Resolve Unstoppable Domains names and avatars
 * for wallet addresses through our server proxy.
 *
 * The browser cannot call api.unstoppabledomains.com directly: the endpoint
 * requires bearer auth and returns no CORS headers. The server route at
 * /api/ud/reverse/:address holds the API key and exposes a same-origin
 * lookup the UI can use safely.
 */
import { useQuery } from '@tanstack/react-query';

const SERVER_URL =
  (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

interface UDProfile {
  name: string | null;
  avatar: string | null;
}

async function resolveUD(address: string): Promise<UDProfile> {
  const key = address.toLowerCase();
  if (!ADDRESS_RE.test(key)) return { name: null, avatar: null };

  try {
    const res = await fetch(`${SERVER_URL}/api/ud/reverse/${key}`, {
      credentials: 'include',
    });
    if (!res.ok) return { name: null, avatar: null };
    const data = (await res.json()) as Partial<UDProfile>;
    return { name: data?.name ?? null, avatar: data?.avatar ?? null };
  } catch {
    return { name: null, avatar: null };
  }
}

export function useUnstoppableDomain(address: string | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: ['ud-domain', address?.toLowerCase()],
    queryFn: () => resolveUD(address!),
    enabled: !!address && ADDRESS_RE.test(address ?? ''),
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  return {
    name: data?.name ?? null,
    avatar: data?.avatar ?? null,
    isLoading,
  };
}

/** Format a display name — shows UD domain if available, otherwise truncated address. */
export function formatDisplayName(
  address: string | undefined,
  udName: string | null | undefined
): string {
  if (udName) return udName;
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
