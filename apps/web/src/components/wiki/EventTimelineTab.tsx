import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { trpcClient } from '@/utils/trpc';
import { Zap, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { WikiEntity } from './types';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface EventTimelineTabProps {
  universeAddress?: string;
}

interface EventEntity extends WikiEntity {
  metadata: Record<string, unknown> & {
    date?: string;
    year?: string | number;
    era?: string;
    location?: string;
  };
}

function eventDateLabel(meta: EventEntity['metadata']): string {
  if (meta.date) return String(meta.date);
  if (meta.year !== undefined) {
    const y = String(meta.year);
    return meta.era ? `${y} ${meta.era}` : y;
  }
  return '—';
}

function sortKey(meta: EventEntity['metadata']): number {
  if (meta.date) {
    const t = new Date(String(meta.date)).getTime();
    if (!Number.isNaN(t)) return t;
  }
  if (meta.year !== undefined) {
    const n = Number(meta.year);
    if (!Number.isNaN(n)) return n * 1_000_000_000;
  }
  return -Infinity;
}

export function EventTimelineTab({ universeAddress }: EventTimelineTabProps) {
  const { data, isLoading } = useQuery({
    queryKey: universeAddress
      ? ['entities', 'list', universeAddress, 'event']
      : ['entities', 'listByKind', 'event'],
    queryFn: () =>
      universeAddress
        ? trpcClient.entities.list.query({ universeAddress, kind: 'event' })
        : trpcClient.entities.listByKind.query({ kind: 'event' }),
  });

  const events = ((data?.entities ?? []) as EventEntity[]).slice();
  events.sort((a, b) => sortKey(b.metadata) - sortKey(a.metadata));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {events.length} event{events.length !== 1 ? 's' : ''}, sorted by in-world date
        </p>
        <Link
          to="/create/$kind"
          params={{ kind: 'event' }}
          search={universeAddress ? { universe: universeAddress } : undefined}
        >
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            New Event
          </Button>
        </Link>
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}

      {!isLoading && events.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Zap className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="mb-2">No events on the timeline yet.</p>
          <p className="text-xs">Create an event with a date or year to see it here.</p>
        </div>
      )}

      <div className="relative">
        <div className="absolute left-[6.5rem] top-0 bottom-0 w-px bg-border" />
        <div className="space-y-3">
          {events.map((e) => (
            <Link
              key={e.id}
              to="/wiki/entity/$id"
              params={{ id: e.id }}
              className="flex gap-4 group"
            >
              <div className="w-24 flex-shrink-0 text-right pt-3">
                <p className="text-sm font-mono font-semibold text-foreground">
                  {eventDateLabel(e.metadata)}
                </p>
              </div>
              <div className="relative flex-shrink-0 pt-3.5">
                <div className="h-3 w-3 rounded-full border-2 border-background bg-amber-400 group-hover:bg-amber-300 group-hover:scale-125 transition-all relative z-10" />
              </div>
              <div className="flex-1 rounded-lg border bg-card p-3 hover:border-amber-400/50 hover:shadow-md transition-all">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{e.name}</p>
                    {e.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                        {e.description}
                      </p>
                    )}
                  </div>
                  {e.imageUrl && (
                    <img
                      src={resolveIpfsUrl(e.imageUrl)}
                      alt=""
                      className="h-12 w-12 rounded object-cover flex-shrink-0"
                    />
                  )}
                </div>
                {e.metadata?.location && (
                  <Badge variant="outline" className="mt-2 text-[10px]">
                    {String(e.metadata.location)}
                  </Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
