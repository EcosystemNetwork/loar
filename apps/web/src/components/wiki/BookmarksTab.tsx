import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Heart } from 'lucide-react';
import { EntityCard } from './EntityCard';
import type { WikiEntity } from './types';

export function BookmarksTab() {
  const { isAuthenticated } = useWalletAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['wiki', 'bookmarks'],
    queryFn: () => trpcClient.entities.myBookmarks.query({ limit: 50 }),
    enabled: !!isAuthenticated,
  });

  const entities = (data?.entities ?? []) as WikiEntity[];

  if (!isAuthenticated) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Heart className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
        <p className="mb-2">Sign in with your wallet to bookmark entities.</p>
        <p className="text-xs">Bookmarks are saved per-account and stay private.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {entities.length} bookmark{entities.length !== 1 ? 's' : ''}
      </p>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}

      {!isLoading && entities.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Heart className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p>No bookmarks yet.</p>
          <p className="text-xs mt-1">Hover an entity card and tap the heart icon to save it.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {entities.map((e) => (
          <EntityCard key={e.id} entity={e} />
        ))}
      </div>
    </div>
  );
}
