/**
 * Gallery & Discovery Hooks
 *
 * TanStack Query hooks for browsing content, trending, featured,
 * creator portfolios, and commissions.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '../utils/trpc';

/** Browse content with filters */
export function useGalleryBrowse(options: {
  universeId?: string;
  creatorUid?: string;
  mediaType?: 'video' | 'image' | 'audio' | '3d' | 'all';
  sortBy?: 'newest' | 'trending' | 'price_asc' | 'price_desc';
  limit?: number;
  cursor?: string;
}) {
  return useQuery({
    queryKey: ['gallery', 'browse', options],
    queryFn: () => trpcClient.gallery.browse.query(options),
  });
}

/** Get trending content */
export function useGalleryTrending(universeId?: string, limit?: number) {
  return useQuery({
    queryKey: ['gallery', 'trending', universeId, limit],
    queryFn: () => trpcClient.gallery.trending.query({ universeId, limit }),
  });
}

/** Get featured content for a universe */
export function useGalleryFeatured(universeId: string | undefined) {
  return useQuery({
    queryKey: ['gallery', 'featured', universeId],
    queryFn: () => (universeId ? trpcClient.gallery.featured.query({ universeId }) : []),
    enabled: !!universeId,
  });
}

/** Set featured content (universe admin) */
export function useSetFeatured() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { universeId: string; contentIds: string[]; expiresAt?: Date }) =>
      trpcClient.gallery.setFeatured.mutate(input),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['gallery', 'featured', variables.universeId] });
    },
  });
}

/** Get a creator's portfolio */
export function useCreatorPortfolio(creatorUid: string | undefined, limit?: number) {
  return useQuery({
    queryKey: ['gallery', 'portfolio', creatorUid, limit],
    queryFn: () =>
      creatorUid ? trpcClient.gallery.creatorPortfolio.query({ creatorUid, limit }) : null,
    enabled: !!creatorUid,
  });
}

/** Send a commission request */
export function useRequestCommission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      toUid: string;
      message: string;
      mediaType: string;
      budget?: string;
      universeId?: string;
    }) => trpcClient.gallery.requestCommission.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', 'commissions'] });
    },
  });
}

/** Get my commission requests */
export function useMyCommissions(direction: 'received' | 'sent' = 'received', limit?: number) {
  return useQuery({
    queryKey: ['gallery', 'commissions', direction, limit],
    queryFn: () => trpcClient.gallery.myCommissions.query({ direction, limit }),
  });
}

/** Respond to a commission request */
export function useRespondToCommission() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { commissionId: string; accept: boolean; responseMessage?: string }) =>
      trpcClient.gallery.respondToCommission.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery', 'commissions'] });
    },
  });
}
