/**
 * Wiki front page — the hub's default view. Reads like an encyclopedia's main
 * page: a featured entry, what's new, an index of kinds, and a shelf per major
 * kind, instead of opening on a raw media feed.
 */
import { Link } from '@tanstack/react-router';
import { useQueries } from '@tanstack/react-query';
import {
  ArrowRight,
  CalendarDays,
  Film,
  ImageIcon,
  Map as MapIcon,
  Network,
  Plus,
  Sparkles,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SmartImage } from '@/components/SmartImage';
import { cn } from '@/lib/utils';
import { kindIcon, KIND_LABELS, KIND_PLURALS } from './kindMeta';
import { localDayNumber, pickFeatured, recentlyAdded, shelfEntities, toMillis } from './frontPage';
import type { SwitcherUniverse } from './UniverseSwitcher';
import { WIKI_BROWSABLE_KINDS, type EntityKind, type WikiEntity, type WikiTab } from './types';

/** Kinds sampled for the featured / recent pool, in shelf order. */
const FRONT_KINDS: EntityKind[] = ['person', 'place', 'faction', 'lore', 'event', 'thing'];
/** Kinds that get their own shelf (the rest are reachable from the index). */
const SHELF_KINDS: EntityKind[] = ['person', 'place', 'faction', 'lore'];
const SAMPLE_SIZE = 12;
const FRONT_STALE_TIME = 5 * 60 * 1000;

interface WikiFrontPageProps {
  universeAddress: string | undefined;
  universes: SwitcherUniverse[];
  onSelectTab: (tab: WikiTab) => void;
  onSelectUniverse: (universeId: string) => void;
}

export function WikiFrontPage({
  universeAddress,
  universes,
  onSelectTab,
  onSelectUniverse,
}: WikiFrontPageProps) {
  const results = useQueries({
    queries: FRONT_KINDS.map((kind) => ({
      queryKey: ['wiki', 'front', universeAddress ?? 'global', kind],
      queryFn: () =>
        universeAddress
          ? trpcClient.entities.list.query({ universeAddress, kind, limit: SAMPLE_SIZE })
          : trpcClient.entities.listByKind.query({ kind, limit: SAMPLE_SIZE }),
      staleTime: FRONT_STALE_TIME,
    })),
  });

  const isLoading = results.some((r) => r.isLoading);
  // ~70 entities at most — cheap enough to derive on every render.
  const byKind: Partial<Record<EntityKind, WikiEntity[]>> = {};
  FRONT_KINDS.forEach((kind, i) => {
    byKind[kind] = (results[i]?.data?.entities ?? []) as WikiEntity[];
  });
  const pool = FRONT_KINDS.flatMap((k) => byKind[k] ?? []);
  const featured = pickFeatured(pool, localDayNumber());
  const recent = recentlyAdded(pool, 6, featured?.id);

  if (isLoading) return <FrontPageSkeleton />;

  if (pool.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed px-6 py-16 text-center">
        <h2 className="font-lore text-2xl">This archive is still blank</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          No characters, places or lore have been written down yet. Start the canon and it will
          appear here.
        </p>
        <Button asChild className="mt-6">
          <Link to="/create" search={universeAddress ? { universe: universeAddress } : undefined}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Write the first entry
          </Link>
        </Button>
      </div>
    );
  }

  const coverUniverses = universeAddress
    ? []
    : universes.filter((u) => !!u.image_url && !!u.name).slice(0, 8);

  return (
    <div className="space-y-12">
      <div className="grid gap-6 lg:grid-cols-3">
        {featured && <FeaturedEntry entity={featured} />}
        <RecentlyAdded entities={recent} className={featured ? '' : 'lg:col-span-3'} />
      </div>

      <KindIndex onSelectTab={onSelectTab} />

      {SHELF_KINDS.map((kind) => {
        const entities = shelfEntities(byKind[kind] ?? [], 6);
        if (entities.length === 0) return null;
        return (
          <Shelf
            key={kind}
            title={KIND_PLURALS[kind]}
            onSeeAll={() => onSelectTab(kind)}
            seeAllLabel={`All ${KIND_PLURALS[kind].toLowerCase()}`}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {entities.map((e) => (
                <ArchiveTile key={e.id} entity={e} portrait={kind === 'person'} />
              ))}
            </div>
          </Shelf>
        );
      })}

      {coverUniverses.length > 0 && (
        <Shelf title="Universes">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {coverUniverses.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => onSelectUniverse(u.id)}
                className="group relative aspect-[16/9] overflow-hidden rounded-xl border bg-muted text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <SmartImage
                  src={u.image_url}
                  alt=""
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                <span className="absolute inset-x-3 bottom-2.5 font-lore text-lg leading-tight text-white">
                  {u.name}
                </span>
              </button>
            ))}
          </div>
        </Shelf>
      )}

      <ExploreStrip onSelectTab={onSelectTab} />
    </div>
  );
}

function FeaturedEntry({ entity }: { entity: WikiEntity }) {
  const Icon = kindIcon(entity.kind);
  return (
    <article className="group relative overflow-hidden rounded-2xl border bg-card lg:col-span-2">
      <Link
        to="/wiki/entity/$id"
        params={{ id: entity.id }}
        className="grid h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-2"
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-muted sm:aspect-auto sm:min-h-[320px]">
          <SmartImage
            src={entity.imageUrl ?? undefined}
            alt={entity.name}
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        </div>
        <div className="flex flex-col p-6 sm:p-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            Featured entry
          </p>
          <h2 className="mt-3 font-lore text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {entity.name}
          </h2>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {KIND_LABELS[entity.kind] ?? entity.kind}
          </p>
          <p className="mt-4 line-clamp-6 text-sm leading-relaxed text-muted-foreground">
            {entity.description}
          </p>
          <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-medium text-primary">
            Read the entry
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </span>
        </div>
      </Link>
    </article>
  );
}

function RecentlyAdded({ entities, className }: { entities: WikiEntity[]; className?: string }) {
  return (
    <section className={cn('rounded-2xl border bg-card/50 p-5', className)}>
      <h2 className="font-lore text-xl font-semibold">Recently added</h2>
      <ol className="mt-3 divide-y divide-border/60">
        {entities.map((e) => {
          const Icon = kindIcon(e.kind);
          const created = toMillis(e.createdAt);
          return (
            <li key={e.id}>
              <Link
                to="/wiki/entity/$id"
                params={{ id: e.id }}
                className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                  <Icon className="h-4 w-4 text-muted-foreground/50" aria-hidden="true" />
                  {e.imageUrl && (
                    <SmartImage
                      src={e.imageUrl}
                      alt=""
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{e.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {KIND_LABELS[e.kind] ?? e.kind}
                    {created > 0 && ` · ${new Date(created).toLocaleDateString()}`}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function KindIndex({ onSelectTab }: { onSelectTab: (tab: WikiTab) => void }) {
  return (
    <section aria-labelledby="wiki-kind-index">
      <h2 id="wiki-kind-index" className="font-lore text-2xl font-semibold">
        Browse the archive
      </h2>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {WIKI_BROWSABLE_KINDS.map((kind) => {
          const Icon = kindIcon(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onSelectTab(kind)}
              className="flex items-center gap-2.5 rounded-lg border bg-card/40 px-3 py-2.5 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="truncate font-medium">{KIND_PLURALS[kind]}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Shelf({
  title,
  onSeeAll,
  seeAllLabel,
  children,
}: {
  title: string;
  onSeeAll?: () => void;
  seeAllLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3 border-b border-border/60 pb-2">
        <h2 className="font-lore text-2xl font-semibold">{title}</h2>
        {onSeeAll && (
          <button
            type="button"
            onClick={onSeeAll}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {seeAllLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

/** Image-led tile with the name set over the art, like a film-archive card. */
export function ArchiveTile({ entity, portrait }: { entity: WikiEntity; portrait?: boolean }) {
  const Icon = kindIcon(entity.kind);
  return (
    <Link
      to="/wiki/entity/$id"
      params={{ id: entity.id }}
      className={cn(
        'group relative block overflow-hidden rounded-xl border bg-gradient-to-br from-zinc-900 to-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        portrait ? 'aspect-[3/4]' : 'aspect-[4/3]'
      )}
    >
      <Icon
        className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 text-white/15"
        aria-hidden="true"
      />
      {entity.imageUrl && (
        <SmartImage
          src={entity.imageUrl}
          alt=""
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/25 to-transparent" />
      <span className="absolute inset-x-3 bottom-2.5">
        <span className="line-clamp-2 font-lore text-base font-semibold leading-snug text-white">
          {entity.name}
        </span>
      </span>
    </Link>
  );
}

const EXPLORE_LINKS: Array<{
  tab: WikiTab;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { tab: 'episodes', label: 'Episodes', hint: 'Watch the canon unfold', icon: Film },
  { tab: 'event-timeline', label: 'Timeline', hint: 'Events in order', icon: CalendarDays },
  { tab: 'graph', label: 'Graph', hint: 'Who is tied to whom', icon: Network },
  { tab: 'places-map', label: 'Map', hint: 'Where it all happens', icon: MapIcon },
  { tab: 'gallery', label: 'Gallery', hint: 'Every image and clip', icon: ImageIcon },
  { tab: 'ask', label: 'Ask the wiki', hint: 'Answers grounded in canon', icon: Sparkles },
];

function ExploreStrip({ onSelectTab }: { onSelectTab: (tab: WikiTab) => void }) {
  return (
    <section aria-labelledby="wiki-explore">
      <h2 id="wiki-explore" className="font-lore text-2xl font-semibold">
        Other ways in
      </h2>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {EXPLORE_LINKS.map(({ tab, label, hint, icon: Icon }) => (
          <button
            key={tab}
            type="button"
            onClick={() => onSelectTab(tab)}
            className="group flex items-center gap-3 rounded-xl border bg-card/40 p-4 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-xs text-muted-foreground">{hint}</span>
            </span>
            <ArrowRight
              className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </section>
  );
}

function FrontPageSkeleton() {
  return (
    <div className="space-y-12" aria-busy="true" aria-label="Loading the wiki">
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-[320px] rounded-2xl lg:col-span-2" />
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[3/4] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
