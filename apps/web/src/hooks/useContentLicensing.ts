/**
 * Content Licensing Hooks
 *
 * TanStack Query hooks for content registration, deals, and browsing.
 * Covers the Firestore-side of content licensing. On-chain interactions
 * use wagmi hooks generated from ContentLicensing.sol ABI.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc } from '../utils/trpc';

/** Register content for sale/rent/license */
export function useRegisterContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contentHash: string;
      contentId: string;
      universeId: string;
      title: string;
      description?: string;
      thumbnailUrl?: string;
      mediaType?: string;
      buyPrice?: string;
      rentPricePerDay?: string;
      licenseFee?: string;
      licenseRoyaltyBps?: number;
      txHash?: string;
    }) => trpc.contentLicensing.register.mutate(input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['contentLicensing', 'universe', variables.universeId],
      });
      queryClient.invalidateQueries({ queryKey: ['contentLicensing', 'creator'] });
    },
  });
}

/** Update pricing for registered content */
export function useUpdatePricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      registrationId: string;
      buyPrice?: string;
      rentPricePerDay?: string;
      licenseFee?: string;
      licenseRoyaltyBps?: number;
    }) => trpc.contentLicensing.updatePricing.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contentLicensing'] });
    },
  });
}

/** Deactivate content from marketplace */
export function useDeactivateContent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (registrationId: string) =>
      trpc.contentLicensing.deactivate.mutate({ registrationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contentLicensing'] });
    },
  });
}

/** Record a deal after on-chain TX */
export function useRecordDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      contentHash: string;
      registrationId: string;
      dealType: 'BUY' | 'RENT' | 'LICENSE';
      pricePaid: string;
      durationDays?: number;
      txHash: string;
    }) => trpc.contentLicensing.recordDeal.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contentLicensing'] });
    },
  });
}

/** Get registration + deals for a content piece */
export function useContentLicensingByContent(contentHash: string | undefined) {
  return useQuery({
    queryKey: ['contentLicensing', 'content', contentHash],
    queryFn: () => (contentHash ? trpc.contentLicensing.getByContent.query({ contentHash }) : null),
    enabled: !!contentHash,
  });
}

/** List licensable content in a universe */
export function useContentByUniverse(
  universeId: string | undefined,
  options?: { dealType?: 'BUY' | 'RENT' | 'LICENSE'; sortBy?: string; limit?: number }
) {
  return useQuery({
    queryKey: ['contentLicensing', 'universe', universeId, options],
    queryFn: () =>
      universeId
        ? trpc.contentLicensing.getByUniverse.query({
            universeId,
            ...options,
          })
        : [],
    enabled: !!universeId,
  });
}

/** Get current user's registered content */
export function useMyRegisteredContent(limit?: number) {
  return useQuery({
    queryKey: ['contentLicensing', 'creator', limit],
    queryFn: () => trpc.contentLicensing.getByCreator.query({ limit: limit || 20 }),
  });
}

/** Get current user's deals (purchases) */
export function useMyDeals(limit?: number) {
  return useQuery({
    queryKey: ['contentLicensing', 'myDeals', limit],
    queryFn: () => trpc.contentLicensing.myDeals.query({ limit: limit || 20 }),
  });
}
