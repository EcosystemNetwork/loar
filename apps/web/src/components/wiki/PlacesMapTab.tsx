import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { trpcClient } from '@/utils/trpc';
import { MapPin, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { WikiEntity } from './types';

interface PlacesMapTabProps {
  universeAddress?: string;
}

interface PlaceEntity extends WikiEntity {
  metadata: Record<string, unknown> & {
    coordinates?: { x?: number; y?: number; lat?: number; lng?: number };
    region?: string;
    climate?: string;
  };
}

function getXY(meta: PlaceEntity['metadata']): { x: number; y: number } | null {
  const c = meta?.coordinates;
  if (!c || typeof c !== 'object') return null;
  if (typeof c.x === 'number' && typeof c.y === 'number') return { x: c.x, y: c.y };
  if (typeof c.lng === 'number' && typeof c.lat === 'number') {
    // Map lng/lat (-180..180, -90..90) into a 0..1000 grid
    return { x: ((c.lng + 180) / 360) * 1000, y: ((90 - c.lat) / 180) * 1000 };
  }
  return null;
}

export function PlacesMapTab({ universeAddress }: PlacesMapTabProps) {
  const { data, isLoading } = useQuery({
    queryKey: universeAddress
      ? ['entities', 'list', universeAddress, 'place']
      : ['entities', 'listByKind', 'place'],
    queryFn: () =>
      universeAddress
        ? trpcClient.entities.list.query({ universeAddress, kind: 'place' })
        : trpcClient.entities.listByKind.query({ kind: 'place' }),
  });

  const places = (data?.entities ?? []) as PlaceEntity[];
  const placed = places
    .map((p) => ({ p, xy: getXY(p.metadata) }))
    .filter((entry): entry is { p: PlaceEntity; xy: { x: number; y: number } } => !!entry.xy);
  const unplaced = places.filter((p) => !getXY(p.metadata));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {placed.length} mapped · {unplaced.length} without coordinates
        </p>
        <Link
          to="/create/$kind"
          params={{ kind: 'place' }}
          search={universeAddress ? { universe: universeAddress } : undefined}
        >
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            New Place
          </Button>
        </Link>
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}

      {!isLoading && places.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <MapPin className="h-8 w-8 mx-auto mb-3 text-muted-foreground/50" />
          <p className="mb-2">No places yet.</p>
          <p className="text-xs">
            Add <code>coordinates: {`{ x, y }`}</code> or <code>{`{ lat, lng }`}</code> in a place's
            metadata to plot it on the map.
          </p>
        </div>
      )}

      {placed.length > 0 && (
        <div className="relative w-full aspect-[2/1] rounded-lg border bg-gradient-to-br from-emerald-900/20 via-blue-900/20 to-slate-900/40 overflow-hidden">
          <svg
            className="absolute inset-0 w-full h-full pointer-events-none"
            viewBox="0 0 1000 500"
            preserveAspectRatio="none"
          >
            {Array.from({ length: 11 }).map((_, i) => (
              <line
                key={`v-${i}`}
                x1={i * 100}
                y1={0}
                x2={i * 100}
                y2={500}
                stroke="rgba(148,163,184,0.08)"
                strokeWidth={1}
              />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <line
                key={`h-${i}`}
                x1={0}
                y1={i * 100}
                x2={1000}
                y2={i * 100}
                stroke="rgba(148,163,184,0.08)"
                strokeWidth={1}
              />
            ))}
          </svg>
          {placed.map(({ p, xy }) => {
            const left = `${(Math.max(0, Math.min(1000, xy.x)) / 1000) * 100}%`;
            const top = `${(Math.max(0, Math.min(500, xy.y / 2)) / 500) * 100}%`;
            return (
              <Link
                key={p.id}
                to="/wiki/entity/$id"
                params={{ id: p.id }}
                className="absolute -translate-x-1/2 -translate-y-1/2 group"
                style={{ left, top }}
              >
                <div className="relative">
                  <MapPin className="h-5 w-5 text-emerald-400 drop-shadow-md group-hover:scale-150 transition-transform" />
                  <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-0.5 rounded bg-black/80 text-white text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    {p.name}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {unplaced.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 mt-4">Unmapped places</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {unplaced.slice(0, 24).map((p) => (
              <Link
                key={p.id}
                to="/wiki/entity/$id"
                params={{ id: p.id }}
                className="flex items-center gap-2 rounded-md border p-2 hover:bg-muted/50 transition-colors text-sm"
              >
                <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                <span className="truncate">{p.name}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
