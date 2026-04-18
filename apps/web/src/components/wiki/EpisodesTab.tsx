import { useQueries, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Film, Play, Plus } from 'lucide-react';

interface EpisodesTabProps {
  universeAddress?: string;
}

interface EpisodeRecord {
  id: string;
  title?: string;
  description?: string;
  universeId: string;
  clipCount?: number;
  clips?: unknown[];
  exportUrl?: string;
  thumbnailUrl?: string;
  createdAt?: string | { _seconds?: number };
}

function tsOf(e: EpisodeRecord): number {
  const v = e.createdAt;
  if (!v) return 0;
  if (typeof v === 'object' && v && '_seconds' in v && typeof v._seconds === 'number') {
    return v._seconds * 1000;
  }
  if (typeof v === 'string') return new Date(v).getTime();
  return 0;
}

export function EpisodesTab({ universeAddress }: EpisodesTabProps) {
  // When scoped to a universe → just call episodes.list once.
  const scopedQuery = useQuery({
    queryKey: ['wiki', 'episodes', universeAddress],
    queryFn: () => trpcClient.episodes.list.query({ universeId: universeAddress!, limit: 50 }),
    enabled: !!universeAddress,
  });

  // When global → fetch a list of universes first, then fan out.
  const universesQuery = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.universes.getAll.query(),
    enabled: !universeAddress,
  });
  const universes = ((universesQuery.data as any)?.data ?? universesQuery.data ?? []) as Array<{
    id: string;
    name?: string;
    image_url?: string;
  }>;
  const publicUniverseIds = universes.map((u) => u.id).slice(0, 20);

  const fanout = useQueries({
    queries: publicUniverseIds.map((id) => ({
      queryKey: ['wiki', 'episodes', id],
      queryFn: () => trpcClient.episodes.list.query({ universeId: id, limit: 5 }),
      enabled: !universeAddress,
    })),
  });

  const isLoading = universeAddress
    ? scopedQuery.isLoading
    : universesQuery.isLoading || fanout.some((q) => q.isLoading);

  const episodes: EpisodeRecord[] = universeAddress
    ? ((scopedQuery.data as EpisodeRecord[]) ?? [])
    : fanout.flatMap((q) => (q.data as EpisodeRecord[] | undefined) ?? []);

  const sorted = [...episodes].sort((a, b) => tsOf(b) - tsOf(a));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {sorted.length} episode{sorted.length !== 1 ? 's' : ''}
          {!universeAddress && ' across all universes'}
        </p>
        <Link to="/editor" search={{ video: undefined, image: undefined }}>
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            New Episode
          </Button>
        </Link>
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}

      {!isLoading && sorted.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Film className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="mb-2">No episodes yet.</p>
          <p className="text-xs mb-4">
            Build episodes from your timeline clips, or generate a full episode from a script.
          </p>
          <Link to="/editor" search={{ video: undefined, image: undefined }}>
            <Button variant="outline">Open Episode Builder</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((ep) => {
          const universeMeta = universes.find((u) => u.id === ep.universeId);
          const clipCount = ep.clipCount ?? ep.clips?.length ?? 0;
          return (
            <Card key={ep.id} className="overflow-hidden hover:shadow-lg transition-shadow">
              <div className="aspect-video bg-muted relative">
                <div className="absolute inset-0 flex items-center justify-center">
                  <Film className="h-8 w-8 text-muted-foreground/30" />
                </div>
                {ep.thumbnailUrl && (
                  <img
                    src={ep.thumbnailUrl}
                    alt={ep.title || ep.id}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                {ep.exportUrl && (
                  <a
                    href={ep.exportUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 hover:opacity-100 transition-opacity"
                  >
                    <Play className="h-12 w-12 text-white" />
                  </a>
                )}
                <Badge className="absolute top-2 left-2 bg-black/60 text-white border-0 text-[10px]">
                  {clipCount} clip{clipCount !== 1 ? 's' : ''}
                </Badge>
              </div>
              <CardContent className="p-3">
                <p className="text-sm font-medium truncate">
                  {ep.title || `Episode ${ep.id.slice(0, 6)}`}
                </p>
                {ep.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                    {ep.description}
                  </p>
                )}
                {!universeAddress && universeMeta?.name && (
                  <Badge variant="outline" className="mt-2 text-[10px]">
                    {universeMeta.name}
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
