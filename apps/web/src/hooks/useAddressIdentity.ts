/**
 * useAddressIdentity — resolve a wallet address to a human display identity.
 *
 * Resolution order (first non-null wins):
 *   1. ENS         — primary name + avatar, reverse-resolved and forward-verified
 *                    server-side (trpc `ens.reverseProfile`, mainnet, cached).
 *   2. Unstoppable — `.crypto/.x/.wallet/…` domain via the server UD proxy.
 *   3. (none)      — caller falls back to a truncated 0x address.
 *
 * ENS wins because its names are forward-verified; UD is a best-effort fallback
 * for the addresses ENS doesn't cover. Both legs are independently cached
 * (10-min) so a screen full of addresses is cheap to render.
 */
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useUnstoppableDomain } from './useUnstoppableDomain';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export type IdentitySource = 'ens' | 'ud' | null;

export interface AddressIdentity {
  /** Display name (ENS or UD), or null when the address has neither. */
  name: string | null;
  /** Avatar URL, or null. */
  avatar: string | null;
  /** Which provider supplied the name. */
  source: IdentitySource;
  isLoading: boolean;
}

export function useAddressIdentity(address: string | undefined): AddressIdentity {
  const valid = !!address && ADDRESS_RE.test(address);

  const ens = useQuery({
    queryKey: ['ens-profile', address?.toLowerCase()],
    queryFn: () => trpcClient.ens.reverseProfile.query({ address: address! }),
    enabled: valid,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Only fall back to UD once ENS has resolved with no name — avoids a second
  // network call for the (common) addresses that do have ENS.
  const ensHasName = !!ens.data?.name;
  const tryUd = valid && ens.isFetched && !ensHasName;
  const ud = useUnstoppableDomain(tryUd ? address : undefined);

  if (ensHasName) {
    return {
      name: ens.data!.name,
      avatar: ens.data!.avatar ?? null,
      source: 'ens',
      isLoading: false,
    };
  }

  if (ud.name) {
    return { name: ud.name, avatar: ud.avatar ?? null, source: 'ud', isLoading: false };
  }

  return { name: null, avatar: null, source: null, isLoading: ens.isLoading || ud.isLoading };
}

/** Short 0x form used when no name resolves. */
export function shortAddress(address: string | undefined, head = 6, tail = 4): string {
  if (!address) return '';
  return address.length > head + tail
    ? `${address.slice(0, head)}…${address.slice(-tail)}`
    : address;
}
