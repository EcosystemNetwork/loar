import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Film, Play, Plus } from 'lucide-react';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface EpisodesTabProps {
  universeAddress?: string;
}

interface ScopedEpisode {
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

interface FeedEpisode {
  id: string;
  universeId: string;
  title: string;
  description: string;
  clipCount: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  exportUrl: string | null;
  sourceCreator: string | null;
  createdAt: string | null;
  isCanon: boolean;
  universe: { id: string; name: string; imageURL: string; creator: string | null };
}

interface DisplayEpisode {
  id: string;
  title?: string;
  description?: string;
  universeId: string;
  universeName?: string;
  clipCount: number;
  thumbnailUrl?: string | null;
  exportUrl?: string | null;
  ts: number;
}

function tsOfScoped(e: ScopedEpisode): number {
  const v = e.createdAt;
  if (!v) return 0;
  if (typeof v === 'object' && v && '_seconds' in v && typeof v._seconds === 'number') {
    return v._seconds * 1000;
  }
  if (typeof v === 'string') return new Date(v).getTime();
  return 0;
}

export function EpisodesTab({ universeAddress }: EpisodesTabProps) {
  // Per-universe view: single tRPC call, server-paginated.
  const scopedQuery = useQuery({
    queryKey: ['wiki', 'episodes', 'scoped', universeAddress],
    queryFn: () =>
      trpcClient.episodes.list.query({
        universeId: universeAddress!,
        limit: 50,
      }) as Promise<ScopedEpisode[]>,
    enabled: !!universeAddress,
  });

  // Global view: single call to the cross-universe canon feed. Server joins
  // universe metadata and filters hidden/private universes — the previous
  // getAll → fan-out waterfall is gone.
  const feedQuery = useQuery({
    queryKey: ['wiki', 'episodes', 'feed', 50],
    queryFn: () => trpcClient.episodes.feed.query({ limit: 50 }) as Promise<FeedEpisode[]>,
    enabled: !universeAddress,
  });

  const isLoading = universeAddress ? scopedQuery.isLoading : feedQuery.isLoading;

  const display: DisplayEpisode[] = universeAddress
    ? ((scopedQuery.data ?? []) as ScopedEpisode[]).map((ep) => ({
        id: ep.id,
        title: ep.title,
        description: ep.description,
        universeId: ep.universeId,
        clipCount: ep.clipCount ?? ep.clips?.length ?? 0,
        thumbnailUrl: ep.thumbnailUrl ?? null,
        exportUrl: ep.exportUrl ?? null,
        ts: tsOfScoped(ep),
      }))
    : ((feedQuery.data ?? []) as FeedEpisode[]).map((ep) => ({
        id: ep.id,
        title: ep.title,
        description: ep.description,
        universeId: ep.universeId,
        universeName: ep.universe?.name,
        clipCount: ep.clipCount,
        thumbnailUrl: ep.thumbnailUrl,
        exportUrl: ep.exportUrl,
        ts: ep.createdAt ? new Date(ep.createdAt).getTime() : 0,
      }));

  const sorted = [...display].sort((a, b) => b.ts - a.ts);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {sorted.length} episode{sorted.length !== 1 ? 's' : ''}
          {!universeAddress && ' across all universes'}
        </p>
        <Link to="/editor" search={{ video: undefined, image: undefined, audio: undefined }}>
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
          <Link to="/editor" search={{ video: undefined, image: undefined, audio: undefined }}>
            <Button variant="outline">Open Episode Builder</Button>
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sorted.map((ep) => (
          <Card key={ep.id} className="overflow-hidden hover:shadow-lg transition-shadow">
            <div className="aspect-video bg-muted relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <Film className="h-8 w-8 text-muted-foreground/30" />
              </div>
              {ep.thumbnailUrl && (
                <img
                  src={resolveIpfsUrl(ep.thumbnailUrl)}
                  alt={ep.title || ep.id}
                  loading="lazy"
                  decoding="async"
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
                {ep.clipCount} clip{ep.clipCount !== 1 ? 's' : ''}
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
              {!universeAddress && ep.universeName && (
                <Badge variant="outline" className="mt-2 text-[10px]">
                  {ep.universeName}
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
