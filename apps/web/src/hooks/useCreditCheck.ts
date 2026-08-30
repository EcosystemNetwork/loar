/**
 * useCreditCheck — Pre-generation credit + kill-switch validation.
 *
 * Provides:
 *  - `checkCredits(type)`: Returns true if the user can afford the generation,
 *     shows a toast and returns false otherwise.
 *  - `checkGenerationEnabled()`: Returns true unless an admin has disabled
 *     the "AI generation" switch in /admin/ops, shows a toast and returns
 *     false otherwise. Call alongside `checkCredits` before firing a
 *     generation mutation — short-circuits client-side instead of letting
 *     the request round-trip to the (already-enforced) server guard.
 *  - `getCost(type)`: Returns the credit cost for a generation type.
 *  - `costs`: Full cost map (loaded from server).
 *  - `balance`: Current credit balance.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { toast } from 'sonner';
import { useCallback } from 'react';

export function useCreditCheck() {
  const { isAuthenticated } = useWalletAuth();
  const { generationEnabled } = useFeatureFlags();
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
   * Points no longer gate generation — users bring their own provider keys.
   * Kept as a no-op (always allows) so existing call sites don't need to
   * change; `credits` / `getCost` are still exposed for display.
   */
  const checkCredits = useCallback((_generationType: string, _creditOverride?: number): boolean => {
    return true;
  }, []);

  /**
   * Check if AI generation is currently enabled platform-wide.
   * Shows a toast error if disabled. Returns true if OK to proceed.
   */
  const checkGenerationEnabled = useCallback((): boolean => {
    if (!generationEnabled) {
      toast.error('AI generation is temporarily disabled. Please check back soon.');
      return false;
    }
    return true;
  }, [generationEnabled]);

  /** Invalidate the credit balance cache (call after spending). */
  const invalidateBalance = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
  }, [queryClient]);

  return {
    credits,
    costs: costs as Record<string, number> | undefined,
    getCost,
    checkCredits,
    generationEnabled,
    checkGenerationEnabled,
    invalidateBalance,
    isLoaded: !!costs && balance !== undefined,
  };
}
