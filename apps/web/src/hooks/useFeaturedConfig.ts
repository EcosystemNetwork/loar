/**
 * useFeaturedConfig — the admin-curated featured slots for every page
 * (`/admin/featured`): homepage universes, discover/videos content, the wiki
 * featured entry and the launchpad's featured token.
 *
 * Every field reads as "no curation" (empty) while loading or on error, so
 * each page falls back to its automatic pick instead of waiting on this.
 */
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export const FEATURED_CONFIG_QUERY_KEY = ['universes', 'featured-config'] as const;

export function useFeaturedConfig() {
  const { data, isLoading } = useQuery({
    queryKey: FEATURED_CONFIG_QUERY_KEY,
    queryFn: () => trpcClient.universes.getFeatured.query(),
    staleTime: 60_000,
  });
  return {
    featuredUniverseIds: data?.featuredUniverseIds,
    featuredDiscoverContentIds: data?.featuredDiscoverContentIds ?? [],
    featuredVideoContentIds: data?.featuredVideoContentIds ?? [],
    featuredWikiEntityId: data?.featuredWikiEntityId || undefined,
    featuredTokenAddress: data?.featuredTokenAddress || undefined,
    isLoading,
  };
}
