import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery, useQueries } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Search, UserCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { WikiEntity, EntityKind } from './types';

const KINDS: EntityKind[] = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
];

interface ProfileSummary {
  uid: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
}

export function CreatorsTab() {
  const [search, setSearch] = useState('');

  // Discover public profiles.
  const profilesQuery = useQuery({
    queryKey: ['wiki', 'creators', 'profiles'],
    queryFn: () => trpcClient.profiles.discover.query({ limit: 60 }),
  });
  const profiles = ((profilesQuery.data as any)?.profiles ?? []) as ProfileSummary[];

  // Pull global entity lists once and aggregate counts per creator.
  const entityQueries = useQueries({
    queries: KINDS.map((kind) => ({
      queryKey: ['entities', 'listByKind', kind],
      queryFn: () => trpcClient.entities.listByKind.query({ kind }),
      staleTime: 60_000,
    })),
  });
  const allEntities: WikiEntity[] = entityQueries.flatMap(
    (q) => (q.data as { entities?: WikiEntity[] } | undefined)?.entities ?? []
  );

  const countsByCreator = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of allEntities) {
      if (!e.creator) continue;
      map.set(e.creator, (map.get(e.creator) ?? 0) + 1);
    }
    return map;
  }, [allEntities]);

  const filteredProfiles = profiles
    .filter((p) =>
      search.trim()
        ? (p.displayName ?? '').toLowerCase().includes(search.toLowerCase()) ||
          (p.username ?? '').toLowerCase().includes(search.toLowerCase())
        : true
    )
    .map((p) => ({ ...p, count: countsByCreator.get(p.uid) ?? 0 }))
    .sort((a, b) => b.count - a.count);

  const isLoading = profilesQuery.isLoading || entityQueries.some((q) => q.isLoading);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search creators…"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">{filteredProfiles.length} creators</p>
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}

      {!isLoading && filteredProfiles.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <UserCircle className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p>No public creator profiles yet.</p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredProfiles.map((p) => (
          <Link
            key={p.uid}
            to="/profile/$username"
            params={{ username: p.username ?? p.uid }}
            className="block"
          >
            <Card className="hover:shadow-lg transition-shadow cursor-pointer">
              <CardContent className="flex gap-3 p-4 items-center">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 flex items-center justify-center flex-shrink-0">
                  {p.avatarUrl ? (
                    <img
                      src={p.avatarUrl}
                      alt={p.displayName || p.username}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <UserCircle className="h-7 w-7 text-white/70" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold truncate">
                    {p.displayName || p.username || `${p.uid.slice(0, 6)}…`}
                  </p>
                  {p.username && p.displayName && (
                    <p className="text-xs text-muted-foreground truncate">@{p.username}</p>
                  )}
                  {p.bio && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{p.bio}</p>
                  )}
                  <Badge variant="outline" className="mt-2 text-[10px]">
                    {p.count} {p.count === 1 ? 'entity' : 'entities'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
