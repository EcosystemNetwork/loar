/**
 * Listing hooks — Mobile commerce browse, buy, sell flows
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export function useListingsBrowse(filters: {
  universeId?: string;
  productType?: string;
  rightsLane?: string;
  search?: string;
  sortBy?: 'newest' | 'price_asc' | 'price_desc' | 'popular';
  limit?: number;
} = {}) {
  return useQuery({
    queryKey: ['listings-browse', filters],
    queryFn: () => trpcClient.listings.browse.query(filters as any),
  });
}

export function useListing(listingId: string) {
  return useQuery({
    queryKey: ['listing', listingId],
    queryFn: () => trpcClient.listings.get.query({ listingId }),
    enabled: !!listingId,
  });
}

export function useMyListings(status: 'ALL' | 'ACTIVE' | 'DRAFT' | 'SOLD_OUT' | 'DELISTED' = 'ALL') {
  return useQuery({
    queryKey: ['my-listings', status],
    queryFn: () => trpcClient.listings.myListings.query({ status }),
  });
}

export function useCreateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.listings.create.mutate>[0]) =>
      trpcClient.listings.create.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-listings'] }),
  });
}

export function useUpdateListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.listings.update.mutate>[0]) =>
      trpcClient.listings.update.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-listings'] });
      qc.invalidateQueries({ queryKey: ['listing'] });
    },
  });
}

export function useDelistListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) => trpcClient.listings.delist.mutate({ listingId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-listings'] }),
  });
}

export function usePurchaseListing() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof trpcClient.listings.purchase.mutate>[0]) =>
      trpcClient.listings.purchase.mutate(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['listings-browse'] });
      qc.invalidateQueries({ queryKey: ['listing'] });
    },
  });
}

export function useOrder(orderId: string) {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => trpcClient.listings.getOrder.query({ orderId }),
    enabled: !!orderId,
  });
}

export function useSellerStats() {
  return useQuery({
    queryKey: ['seller-stats'],
    queryFn: () => trpcClient.listings.sellerStats.query(),
  });
}

export function useUniverseStorefront(universeId: string) {
  return useQuery({
    queryKey: ['universe-storefront', universeId],
    queryFn: () => trpcClient.listings.universeStorefront.query({ universeId }),
    enabled: !!universeId,
  });
}
