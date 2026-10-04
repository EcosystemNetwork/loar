/**
 * Layout pieces for the wiki entity article: a full-bleed key-art hero, a
 * Fandom-style infobox, and serif section headings for the article body.
 */
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { SmartImage } from '@/components/SmartImage';
import { cn } from '@/lib/utils';
import { characterChips } from './CharacterHero';
import { kindIcon, KIND_LABELS, KIND_PLURALS } from './kindMeta';
import { buildWikiSearch } from './nav';
import type { EntityKind } from './types';

interface ArticleEntity {
  id: string;
  name: string;
  kind: string;
  imageUrl?: string | null;
  universeAddress?: string | null;
  parentId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function ArticleSection({
  id,
  title,
  count,
  action,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-24">
      <div className="mb-4 flex items-end justify-between gap-3 border-b border-border/70 pb-2">
        <h2 id={`${id}-heading`} className="font-lore text-2xl font-semibold tracking-tight">
          {title}
          {count !== undefined && count > 0 && (
            <span className="ml-2 align-middle font-sans text-sm font-normal text-muted-foreground">
              {count}
            </span>
          )}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EntityArticleHero({
  entity,
  imageUrl,
  universeName,
  actions,
}: {
  entity: ArticleEntity;
  /** Already protocol-checked image URL. */
  imageUrl: string | undefined;
  universeName: string | undefined;
  actions: React.ReactNode;
}) {
  const Icon = kindIcon(entity.kind);
  const universe = entity.universeAddress ?? undefined;
  const chips = entity.kind === 'person' ? characterChips(entity.metadata) : [];

  const { data: parent } = useQuery({
    queryKey: ['entity', entity.parentId],
    queryFn: () => trpcClient.entities.get.query({ entityId: entity.parentId! }),
    enabled: !!entity.parentId,
  });

  return (
    <header className="relative isolate overflow-hidden border-b border-border/60">
      {imageUrl ? (
        <SmartImage
          src={imageUrl}
          alt=""
          decoding="async"
          className="absolute inset-0 -z-20 h-full w-full object-cover object-[center_30%] opacity-70 md:opacity-50"
        />
      ) : (
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(ellipse_at_top_right,var(--color-primary)_0%,transparent_60%)] opacity-15" />
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-background via-background/70 to-background/10" />
      <div className="absolute inset-0 -z-10 hidden bg-gradient-to-r from-background/85 via-background/30 to-transparent md:block" />

      <div className="container mx-auto flex min-h-[320px] max-w-6xl flex-col px-4 pb-8 pt-5 md:min-h-[440px] md:pb-10 md:pt-8">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <li>
              <Link
                to="/wiki"
                search={buildWikiSearch('home', undefined)}
                className="hover:text-foreground"
              >
                Wiki
              </Link>
            </li>
            {universe && (
              <>
                <Crumb />
                <li className="max-w-[12rem] truncate">
                  <Link
                    to="/wiki"
                    search={buildWikiSearch('home', universe)}
                    className="hover:text-foreground"
                  >
                    {universeName ?? 'Universe'}
                  </Link>
                </li>
              </>
            )}
            {entity.kind in KIND_PLURALS && (
              <>
                <Crumb />
                <li>
                  <Link
                    to="/wiki"
                    search={buildWikiSearch(entity.kind as EntityKind, universe)}
                    className="hover:text-foreground"
                  >
                    {KIND_PLURALS[entity.kind]}
                  </Link>
                </li>
              </>
            )}
            {parent && (
              <>
                <Crumb />
                <li className="max-w-[12rem] truncate">
                  <Link
                    to="/wiki/entity/$id"
                    params={{ id: parent.id }}
                    className="hover:text-foreground"
                  >
                    {parent.name}
                  </Link>
                </li>
              </>
            )}
          </ol>
        </nav>

        <div className="mt-auto pt-28 md:pt-40">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {KIND_LABELS[entity.kind] ?? entity.kind}
          </p>
          <h1 className="mt-2 max-w-4xl break-words font-lore text-4xl font-semibold leading-[1.05] tracking-tight drop-shadow-sm sm:text-5xl md:text-6xl">
            {entity.name}
          </h1>
          {chips.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2" aria-label="Character summary">
              {chips.map((c) => (
                <li
                  key={c.label}
                  className="rounded-full border border-border/70 bg-background/60 px-3 py-1 text-xs backdrop-blur"
                >
                  <span className="text-muted-foreground">{c.label}</span>{' '}
                  <span className="font-medium">{c.value}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      </div>
    </header>
  );
}

function Crumb() {
  return (
    <li aria-hidden="true">
      <ChevronRight className="h-3 w-3" />
    </li>
  );
}

export interface InfoboxRow {
  label: string;
  value: React.ReactNode;
}

export function EntityInfobox({
  entity,
  imageUrl,
  rows,
  children,
}: {
  entity: ArticleEntity;
  imageUrl: string | undefined;
  rows: InfoboxRow[];
  children?: React.ReactNode;
}) {
  const Icon = kindIcon(entity.kind);
  const portrait = entity.kind === 'person';
  return (
    <div className="overflow-hidden rounded-xl border bg-card/70 shadow-sm">
      <div className="border-b bg-muted/40 px-4 py-3 text-center">
        <p className="font-lore text-lg font-semibold leading-tight">{entity.name}</p>
      </div>
      {/* The hero already shows the art on small screens. */}
      <div
        className={cn(
          'relative hidden w-full overflow-hidden bg-muted lg:block',
          portrait ? 'aspect-[3/4]' : 'aspect-[4/3]'
        )}
      >
        {imageUrl ? (
          <SmartImage src={imageUrl} alt={entity.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2">
            <Icon className="h-12 w-12 text-muted-foreground/25" aria-hidden="true" />
            <span className="text-xs text-muted-foreground/60">No image yet</span>
          </div>
        )}
      </div>
      <dl className="divide-y divide-border/60 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 px-4 py-2.5">
            <dt className="text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 break-words">{r.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}
