import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueries } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { EntityKind, WikiEntity } from './types';

interface AZIndexTabProps {
  universeAddress?: string;
}

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

const ALPHABET = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function bucketOf(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  if (c >= 'A' && c <= 'Z') return c;
  return '#';
}

export function AZIndexTab({ universeAddress }: AZIndexTabProps) {
  const [search, setSearch] = useState('');

  const queries = useQueries({
    queries: KINDS.map((kind) => ({
      queryKey: universeAddress
        ? ['entities', 'list', universeAddress, kind]
        : ['entities', 'listByKind', kind],
      queryFn: () =>
        universeAddress
          ? trpcClient.entities.list.query({ universeAddress, kind })
          : trpcClient.entities.listByKind.query({ kind }),
      staleTime: 60_000,
    })),
  });

  const isLoading = queries.some((q) => q.isLoading);
  const all: WikiEntity[] = queries.flatMap(
    (q) => (q.data as { entities?: WikiEntity[] } | undefined)?.entities ?? []
  );

  const buckets = useMemo(() => {
    const filtered = search.trim()
      ? all.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()))
      : all;
    const map = new Map<string, WikiEntity[]>();
    for (const e of filtered) {
      const k = bucketOf(e.name);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [all, search]);

  const presentLetters = new Set(buckets.keys());

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter index…"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">{all.length} entries</p>
      </div>

      <div className="flex gap-1 flex-wrap sticky top-0 bg-background/80 backdrop-blur py-2 z-10 border-b">
        {ALPHABET.map((l) => {
          const has = presentLetters.has(l);
          return (
            <a
              key={l}
              href={has ? `#az-${l}` : undefined}
              className={`h-7 w-7 rounded text-xs font-mono font-semibold flex items-center justify-center ${
                has
                  ? 'bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer'
                  : 'text-muted-foreground/40 cursor-default'
              }`}
            >
              {l}
            </a>
          );
        })}
      </div>

      {isLoading && <div className="text-center py-12 text-muted-foreground">Loading…</div>}

      <div className="space-y-6">
        {ALPHABET.filter((l) => buckets.has(l)).map((letter) => (
          <section key={letter} id={`az-${letter}`} className="scroll-mt-20">
            <h3 className="text-2xl font-bold font-mono text-primary mb-2">{letter}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {buckets.get(letter)!.map((e) => (
                <Link
                  key={e.id}
                  to="/wiki/entity/$id"
                  params={{ id: e.id }}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-muted/50 text-sm border-l-2 border-transparent hover:border-primary"
                >
                  <span className="truncate font-medium">{e.name}</span>
                  <span className="text-[10px] text-muted-foreground capitalize flex-shrink-0">
                    {e.kind}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      {!isLoading && all.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p>No entries to index.</p>
        </div>
      )}
    </div>
  );
}
