/**
 * Cast strip — every person in the universe, docked on the editor canvas.
 *
 * Read-only overlay (not React Flow nodes, so it never touches scene layout,
 * selection or the on-chain node graph). Each card shows the character's art
 * and its 3D state (model / rigged), and links to the wiki page and the
 * Character Studio.
 */
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Box, ChevronDown, ChevronUp, PersonStanding, Bone } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { SmartImage } from '@/components/SmartImage';

interface CastEntity {
  id: string;
  name: string;
  imageUrl?: string | null;
  metadata?: Record<string, any> | null;
}

/** 3D state from the same metadata keys Entity3DStudio reads. */
export function castStatus(e: CastEntity): 'rigged' | 'model' | 'art' {
  const md = e.metadata ?? {};
  const puppet = md.puppet as Record<string, any> | undefined;
  if (puppet?.riggedModelUrl && puppet?.rigType) return 'rigged';
  if (puppet?.modelUrl || md.model3d?.glbUrl || md.modelUrl) return 'model';
  return 'art';
}

/** Samples (the NFT base bodies) first, then everyone else, by name. */
export function sortCast<T extends CastEntity>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const sa = a.metadata?.sample ? 0 : 1;
    const sb = b.metadata?.sample ? 0 : 1;
    return sa - sb || a.name.localeCompare(b.name);
  });
}

export function CastStrip({ universeId }: { universeId: string }) {
  const [open, setOpen] = useState(true);
  const { data, isLoading } = useQuery({
    queryKey: ['entities', 'cast', universeId],
    queryFn: () =>
      trpcClient.entities.list.query({ universeAddress: universeId, kind: 'person', limit: 200 }),
    enabled: !!universeId,
    staleTime: 30_000,
  });
  const cast = sortCast(((data?.entities ?? []) as CastEntity[]).filter(Boolean));

  if (!isLoading && cast.length === 0) return null;

  return (
    <div className="pointer-events-auto max-w-[min(56rem,calc(100vw-2rem))] rounded-xl border border-border bg-card/85 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-sm font-medium text-foreground/80 hover:text-foreground"
        aria-expanded={open}
      >
        <PersonStanding className="h-4 w-4 text-primary" />
        Cast
        <span className="text-xs text-muted-foreground tabular-nums">
          {isLoading ? '…' : cast.length}
        </span>
        <Link
          to="/studio/characters"
          search={{ universe: universeId } as never}
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-xs font-normal text-primary hover:underline"
        >
          Character Studio
        </Link>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
      </button>

      {open && (
        <ul className="flex gap-2 overflow-x-auto px-3 pb-3">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-36 w-24 shrink-0 animate-pulse rounded-lg bg-muted" />
            ))}
          {cast.map((e) => {
            const status = castStatus(e);
            return (
              <li key={e.id} className="w-24 shrink-0">
                <Link
                  to="/studio/characters"
                  search={{ universe: universeId, entity: e.id } as never}
                  className="group block overflow-hidden rounded-lg border border-border bg-background/60 hover:border-primary/60"
                  title={`${e.name} — open in Character Studio`}
                >
                  <div className="relative h-28 w-full bg-muted">
                    {e.imageUrl ? (
                      <SmartImage
                        src={e.imageUrl}
                        alt={e.name}
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <PersonStanding className="absolute inset-0 m-auto h-8 w-8 text-muted-foreground" />
                    )}
                    {status !== 'art' && (
                      <span
                        className="absolute right-1 top-1 flex items-center gap-0.5 rounded bg-background/80 px-1 py-0.5 text-[10px] font-medium"
                        title={status === 'rigged' ? 'Rigged 3D character' : '3D model'}
                      >
                        {status === 'rigged' ? (
                          <Bone className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Box className="h-3 w-3 text-sky-400" />
                        )}
                        {status === 'rigged' ? 'Rig' : '3D'}
                      </span>
                    )}
                    {e.metadata?.sample && (
                      <span className="absolute left-1 top-1 rounded bg-amber-500/90 px-1 py-0.5 text-[10px] font-semibold text-background">
                        {String(e.metadata.bodyType ?? 'Sample')}
                      </span>
                    )}
                  </div>
                  <p className="truncate px-1.5 py-1 text-[11px] leading-tight text-foreground/90 group-hover:text-foreground">
                    {e.name}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
