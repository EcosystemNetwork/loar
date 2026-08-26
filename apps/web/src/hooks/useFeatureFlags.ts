/**
 * useFeatureFlags — reads the admin kill switches (`/admin/ops`) so pages
 * can hide UI for a feature that isn't ready yet (testnet launch: credit
 * purchasing, etc) instead of only failing server-side after the user tries.
 *
 * Fails open, same as the server (`isFeatureEnabled` in platformConfig.ts):
 * while loading or on fetch error, every flag reads as enabled so a slow
 * network never hides a working feature.
 */
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export interface FeatureFlags {
  generationEnabled: boolean;
  mintingEnabled: boolean;
  purchaseEnabled: boolean;
  registrationEnabled: boolean;
}

const ALL_ENABLED: FeatureFlags = {
  generationEnabled: true,
  mintingEnabled: true,
  purchaseEnabled: true,
  registrationEnabled: true,
};

export function useFeatureFlags(): FeatureFlags & { isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: () => trpcClient.credits.getFeatureFlags.query(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return {
    generationEnabled: data?.generationEnabled ?? ALL_ENABLED.generationEnabled,
    mintingEnabled: data?.mintingEnabled ?? ALL_ENABLED.mintingEnabled,
    purchaseEnabled: data?.purchaseEnabled ?? ALL_ENABLED.purchaseEnabled,
    registrationEnabled: data?.registrationEnabled ?? ALL_ENABLED.registrationEnabled,
    isLoading,
  };
}
