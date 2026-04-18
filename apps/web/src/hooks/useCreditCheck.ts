/**
 * useCreditCheck — Pre-generation credit validation.
 *
 * Provides:
 *  - `checkCredits(type)`: Returns true if the user can afford the generation,
 *     shows a toast and returns false otherwise.
 *  - `getCost(type)`: Returns the credit cost for a generation type.
 *  - `costs`: Full cost map (loaded from server).
 *  - `balance`: Current credit balance.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { useCallback } from 'react';

export function useCreditCheck() {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();

  const { data: balance } = useQuery({
    queryKey: ['credit-balance'],
    queryFn: () => trpcClient.credits.getBalance.query(),
    enabled: isAuthenticated,
  });

  const { data: costs } = useQuery({
    queryKey: ['generation-costs'],
    queryFn: () => trpcClient.credits.getCosts.query(),
    staleTime: 5 * 60 * 1000,
  });

  const credits = balance?.balance ?? 0;

  /** Get the credit cost for a generation type. Returns 0 if unknown. */
  const getCost = useCallback(
    (generationType: string): number => {
      if (!costs) return 0;
      return (costs as Record<string, number>)[generationType] ?? 0;
    },
    [costs]
  );

  /**
   * Check if the user has enough credits for a generation type.
   * Shows a toast error if insufficient. Returns true if OK to proceed.
   */
  const checkCredits = useCallback(
    (generationType: string, creditOverride?: number): boolean => {
      const cost = creditOverride ?? getCost(generationType);
      if (cost === 0) return true; // unknown cost — let server validate

      if (credits < cost) {
        toast.error(
          `Not enough credits. You need ${cost} credits for this generation but only have ${credits}. Purchase more credits to continue.`
        );
        return false;
      }
      return true;
    },
    [credits, getCost]
  );

  /** Invalidate the credit balance cache (call after spending). */
  const invalidateBalance = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
  }, [queryClient]);

  return {
    credits,
    costs: costs as Record<string, number> | undefined,
    getCost,
    checkCredits,
    invalidateBalance,
    isLoaded: !!costs && balance !== undefined,
  };
}
