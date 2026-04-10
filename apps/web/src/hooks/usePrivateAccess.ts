/**
 * usePrivateAccess — resolves the connected user's access level
 * for a universe's private section (Creator's Room).
 *
 * Returns the access level (admin/team/holders/none) and the
 * private section config from the server.
 */
import { useQuery } from '@tanstack/react-query';
import { trpc } from '../utils/trpc';
import { useWalletAuth } from '../lib/wallet-auth';

export type AccessLevel = 'admin' | 'team' | 'holders' | 'none';

export interface PrivateSectionConfig {
  universeId: string;
  vaultEnabled: boolean;
  notesEnabled: boolean;
  holderMinPercentage: number;
}

export function usePrivateAccess(universeId: string | undefined) {
  const { isAuthenticated } = useWalletAuth();

  const { data, isLoading } = useQuery(
    trpc.privateSection.getConfig.queryOptions(
      { universeId: universeId ?? '' },
      {
        enabled: !!universeId && isAuthenticated,
        staleTime: 60_000,
      }
    )
  );

  return {
    accessLevel: (data?.accessLevel ?? 'none') as AccessLevel,
    config: (data?.config as PrivateSectionConfig) ?? null,
    isLoading,
    hasAccess: !!data && data.accessLevel !== 'none',
  };
}
