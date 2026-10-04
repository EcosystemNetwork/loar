/**
 * Admin Featured — one place to curate what every public page spotlights.
 *
 * Each slot is a field on `platformConfig` (written via `admin.updateConfig`,
 * audited server-side, read publicly through `universes.getFeatured`):
 *
 *   Home      hero billboard + activity ticker  → featuredUniverseIds
 *   Discover  front of the trending row         → featuredDiscoverContentIds
 *   Videos    "Featured" row atop the page      → featuredVideoContentIds
 *   Wiki      front page featured entry         → featuredWikiEntityId
 *   Tokens    hero (replaces King of the Hill)  → featuredTokenAddress
 *
 * Empty slot = that page keeps its automatic pick. Public pages cache the
 * config for up to ~60s server-side, so a save can take a minute to show.
 */
import { createFileRoute, redirect, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Coins,
  Compass,
  ExternalLink,
  Film,
  Home,
  Loader2,
  Save,
  Star,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SmartImage } from '@/components/SmartImage';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useTokenListData } from '@/hooks/useTokens';
import { FEATURED_CONFIG_QUERY_KEY } from '@/hooks/useFeaturedConfig';

export const Route = createFileRoute('/admin/featured')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/featured' } });
    }
  },
  component: FeaturedAdmin,
});

/** What a picker row shows for one id. */
interface PickItem {
  id: string;
  title: string;
  subtitle?: string;
  thumb?: string | null;
}

type ListField = 'featuredUniverseIds' | 'featuredDiscoverContentIds' | 'featuredVideoContentIds';
type SingleField = 'featuredWikiEntityId' | 'featuredTokenAddress';
type AdminConfig = Awaited<ReturnType<typeof trpcClient.admin.getConfig.query>>;

const VIDEO_MEDIA_TYPES = new Set(['video', 'ai-video']);

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/**
 * Draft + save for one featured slot. Single-value fields are edited as a
 * 0-or-1 list and written back as a string ('' = automatic).
 */
function useSlotDraft(cfg: AdminConfig, field: ListField | SingleField, label: string) {
  const queryClient = useQueryClient();
  const single = field === 'featuredWikiEntityId' || field === 'featuredTokenAddress';
  const raw = cfg[field] as string[] | string | undefined;
  const saved = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const [draft, setDraft] = useState<string[] | null>(null);
  const current = draft ?? saved;

  const mutation = useMutation({
    mutationFn: (ids: string[]) =>
      trpcClient.admin.updateConfig.mutate({ [field]: single ? (ids[0] ?? '') : ids }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-config'] });
      queryClient.invalidateQueries({ queryKey: FEATURED_CONFIG_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ['discover-trending'] });
      queryClient.invalidateQueries({ queryKey: ['videos-featured'] });
      toast.success(`${label} updated — live on the site within ~60s`);
      setDraft(null);
    },
    onError: (err: Error) => toast.error(`Update failed: ${err.message}`),
  });

  return {
    current,
    setDraft,
    dirty: draft !== null && JSON.stringify(draft) !== JSON.stringify(saved),
    save: () => mutation.mutate(current),
    saving: mutation.isPending,
  };
}

function FeaturedAdmin() {
  const { isAuthenticated, address } = useWalletAuth();

  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());

  const { data: cfg, isLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => trpcClient.admin.getConfig.query(),
    enabled: isAuthenticated && isAdmin,
  });

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto p-8">
        <p className="text-muted-foreground">Please sign in to access the admin panel.</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-8">
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p>
              Your wallet is not in <code className="mx-1">VITE_ADMIN_ADDRESSES</code>. Access
              denied.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !cfg) {
    return (
      <div className="container mx-auto p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 p-4 pb-bottom-nav sm:p-8 md:pb-12">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Star className="h-7 w-7" /> Featured content
        </h1>
        <p className="mt-1 text-muted-foreground">
          Choose what each page spotlights. Leave a slot empty and that page picks automatically.
          Changes reach the live site within about a minute.
        </p>
      </div>

      <HomeUniversesSlot cfg={cfg} />
      <ContentSlot
        cfg={cfg}
        field="featuredDiscoverContentIds"
        max={6}
        icon={<Compass className="h-5 w-5" />}
        title="Discover: trending row"
        page="/discover"
        description="Pinned, in order, ahead of the trending row at the top of Discover and marked “Featured”. Six cards show, so pins push trending items out."
        emptyText="Nothing pinned. The row shows pure trending."
      />
      <ContentSlot
        cfg={cfg}
        field="featuredVideoContentIds"
        max={12}
        videosOnly
        icon={<Film className="h-5 w-5" />}
        title="Videos: featured row"
        page="/videos"
        description="A “Featured” row at the top of the Videos page, in this order. It's hidden while empty or while a visitor is searching."
        emptyText="Nothing pinned. The Featured row is hidden."
      />
      <WikiEntitySlot cfg={cfg} />
      <TokenSlot cfg={cfg} />
    </div>
  );
}

/* ─── Slots ──────────────────────────────────────────────────── */

type AdminUniverseRow = { id: string; name?: string; image_url?: string };

function HomeUniversesSlot({ cfg }: { cfg: AdminConfig }) {
  const slot = useSlotDraft(cfg, 'featuredUniverseIds', 'Homepage universes');
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-universes'],
    queryFn: () => trpcClient.universes.adminList.query(),
  });
  const universes = useMemo(() => (data?.data ?? []) as AdminUniverseRow[], [data]);
  const toItem = (u: AdminUniverseRow): PickItem => ({
    id: u.id,
    title: u.name || 'Unnamed universe',
    subtitle: u.id,
    thumb: u.image_url,
  });
  const byId = useMemo(() => new Map(universes.map((u) => [u.id.toLowerCase(), u])), [universes]);

  const term = search.trim().toLowerCase();
  const results = term
    ? universes
        .filter((u) => u.name?.toLowerCase().includes(term) || u.id.toLowerCase().includes(term))
        .slice(0, 8)
        .map(toItem)
    : [];

  return (
    <PinnedPicker
      {...slot}
      icon={<Home className="h-5 w-5" />}
      title="Homepage: hero & activity ticker"
      page="/"
      description="These universes lead the homepage hero billboard and the scrolling activity ticker, in this order."
      emptyText="Nothing pinned. Ranked automatically by node count and token presence."
      max={10}
      resolve={(id) => {
        const u = byId.get(id.toLowerCase());
        return u ? toItem(u) : undefined;
      }}
      resolving={isLoading}
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search universes by name or address…"
      results={results}
      searching={false}
    />
  );
}

function ContentSlot({
  cfg,
  field,
  max,
  videosOnly,
  ...copy
}: {
  cfg: AdminConfig;
  field: 'featuredDiscoverContentIds' | 'featuredVideoContentIds';
  max: number;
  videosOnly?: boolean;
  icon: ReactNode;
  title: string;
  page: string;
  description: string;
  emptyText: string;
}) {
  const slot = useSlotDraft(cfg, field, copy.title);
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());

  const toItem = (c: any): PickItem => ({
    id: c.contentId || c.id,
    title: c.title || 'Untitled',
    subtitle: [c.mediaType, c.contentId || c.id].filter(Boolean).join(' · '),
    thumb: c.thumbnailUrl || (c.mediaType?.includes('image') ? c.mediaUrl : null),
  });

  // Resolved the same way the public slot resolves them, so anything missing
  // here (private / moderated / deleted) is also missing on the live page.
  const preview = useQuery({
    queryKey: ['admin-featured-preview', slot.current],
    queryFn: () => trpcClient.feed.previewPinned.query({ ids: slot.current }),
    enabled: slot.current.length > 0,
    placeholderData: (prev) => prev,
  });
  const byId = useMemo(
    () => new Map((preview.data?.items ?? []).map((c: any) => [c.contentId || c.id, c])),
    [preview.data]
  );

  const searchQuery = useQuery({
    queryKey: ['admin-featured-content-search', term],
    queryFn: () => trpcClient.content.feed.query({ search: term, limit: 30 }),
    enabled: term.length > 1,
  });
  const results = (searchQuery.data?.items ?? [])
    .filter((c: any) => !videosOnly || VIDEO_MEDIA_TYPES.has(c.mediaType))
    .slice(0, 8)
    .map(toItem);

  return (
    <PinnedPicker
      {...slot}
      {...copy}
      max={max}
      resolve={(id) => {
        const c = byId.get(id);
        return c ? toItem(c) : undefined;
      }}
      resolving={preview.isLoading}
      search={search}
      onSearch={setSearch}
      searchPlaceholder={videosOnly ? 'Search videos by title…' : 'Search content by title…'}
      results={results}
      searching={searchQuery.isFetching}
    />
  );
}

function WikiEntitySlot({ cfg }: { cfg: AdminConfig }) {
  const slot = useSlotDraft(cfg, 'featuredWikiEntityId', 'Wiki featured entry');
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim());
  const pinnedId = slot.current[0];

  const toItem = (e: any): PickItem => ({
    id: e.id,
    title: e.name || 'Untitled entry',
    subtitle: [e.kind, e.universeAddress].filter(Boolean).join(' · '),
    thumb: e.imageUrl,
  });

  const pinned = useQuery({
    queryKey: ['admin-featured-entity', pinnedId],
    queryFn: () => trpcClient.entities.get.query({ entityId: pinnedId! }),
    enabled: !!pinnedId,
    retry: false,
  });

  const searchQuery = useQuery({
    queryKey: ['admin-featured-entity-search', term],
    queryFn: () => trpcClient.entities.search.query({ query: term, limit: 8 }),
    enabled: term.length > 1,
  });
  const results = (searchQuery.data?.entities ?? []).map(toItem);

  return (
    <PinnedPicker
      {...slot}
      icon={<BookOpen className="h-5 w-5" />}
      title="Wiki: featured entry"
      page="/wiki"
      description="Replaces the daily-rotating featured entry on the wiki front page. Inside a single universe's wiki it only applies when the entry belongs to that universe."
      emptyText="Nothing pinned. Rotates daily through entries with art."
      max={1}
      resolve={(id) => (pinned.data && pinned.data.id === id ? toItem(pinned.data) : undefined)}
      resolving={pinned.isLoading}
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search wiki entries…"
      results={results}
      searching={searchQuery.isFetching}
    />
  );
}

function TokenSlot({ cfg }: { cfg: AdminConfig }) {
  const slot = useSlotDraft(cfg, 'featuredTokenAddress', 'Featured token');
  const [search, setSearch] = useState('');
  const { data: tokens, isLoading } = useTokenListData();

  const toItem = (t: (typeof tokens)[number]): PickItem => ({
    id: t.id,
    title: `${t.name} ($${t.symbol})`,
    subtitle: `${t.stage} · ${t.id}`,
    thumb: t.imageURL,
  });
  const byId = useMemo(() => new Map(tokens.map((t) => [t.id.toLowerCase(), t])), [tokens]);

  const term = search.trim().toLowerCase();
  const results = term
    ? tokens
        .filter(
          (t) =>
            t.name.toLowerCase().includes(term) ||
            t.symbol.toLowerCase().includes(term) ||
            t.id.toLowerCase().includes(term)
        )
        .slice(0, 8)
        .map(toItem)
    : [];

  return (
    <PinnedPicker
      {...slot}
      icon={<Coins className="h-5 w-5" />}
      title="Tokens: launchpad hero"
      page="/tokens"
      description="Takes the hero spot at the top of the launchpad, labelled “Featured”, in place of King of the Hill."
      emptyText="Nothing pinned. King of the Hill (highest market cap still on its bonding curve)."
      max={1}
      resolve={(id) => {
        const t = byId.get(id.toLowerCase());
        return t ? toItem(t) : undefined;
      }}
      resolving={isLoading}
      search={search}
      onSearch={setSearch}
      searchPlaceholder="Search tokens by name, symbol or address…"
      results={results}
      searching={false}
    />
  );
}

/* ─── Shared picker ──────────────────────────────────────────── */

function PinnedPicker({
  icon,
  title,
  page,
  description,
  emptyText,
  max,
  current,
  setDraft,
  dirty,
  save,
  saving,
  resolve,
  resolving,
  search,
  onSearch,
  searchPlaceholder,
  results,
  searching,
}: {
  icon: ReactNode;
  title: string;
  page: string;
  description: string;
  emptyText: string;
  max: number;
  current: string[];
  setDraft: (ids: string[]) => void;
  dirty: boolean;
  save: () => void;
  saving: boolean;
  resolve: (id: string) => PickItem | undefined;
  resolving: boolean;
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder: string;
  results: PickItem[];
  searching: boolean;
}) {
  const single = max === 1;
  const has = (id: string) => current.some((x) => x.toLowerCase() === id.toLowerCase());
  const freshResults = results.filter((r) => !has(r.id));

  function add(id: string) {
    if (single) {
      setDraft([id]);
    } else if (current.length >= max) {
      toast.error(`Maximum ${max} pinned items`);
      return;
    } else {
      setDraft([...current, id]);
    }
    onSearch('');
  }
  function remove(id: string) {
    setDraft(current.filter((x) => x.toLowerCase() !== id.toLowerCase()));
  }
  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= current.length) return;
    const next = [...current];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-3 text-lg">
          <span className="flex items-center gap-2">
            {icon} {title}
          </span>
          <Link
            to={page as any}
            target="_blank"
            className="flex items-center gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
          >
            View page <ExternalLink className="h-3 w-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{description}</p>

        {current.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{emptyText}</p>
        ) : (
          <ol className="space-y-2">
            {current.map((id, i) => {
              const item = resolve(id);
              return (
                <li key={id} className="flex items-center gap-3 rounded-md border p-2.5">
                  {!single && (
                    <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground">
                      {i + 1}
                    </span>
                  )}
                  <Thumb src={item?.thumb} />
                  <div className="min-w-0 flex-1">
                    {item ? (
                      <div className="truncate font-medium">{item.title}</div>
                    ) : resolving ? (
                      <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                    ) : (
                      <div className="flex items-center gap-1.5 font-medium text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Unavailable: private, moderated or deleted. It won't show.
                      </div>
                    )}
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {item?.subtitle ?? id}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!single && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => move(i, -1)}
                          disabled={i === 0}
                          aria-label="Move up"
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => move(i, 1)}
                          disabled={i === current.length - 1}
                          aria-label="Move down"
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => remove(id)}
                      aria-label="Remove"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <div className="relative">
          <Label htmlFor={`search-${title}`}>
            {single ? (current.length ? 'Replace with…' : 'Pick one') : 'Add'}
            {!single && (
              <span className="ml-1 text-muted-foreground">
                ({current.length}/{max})
              </span>
            )}
          </Label>
          <div className="relative">
            <Input
              id={`search-${title}`}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => onSearch(e.target.value)}
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>
          {search.trim() && freshResults.length > 0 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
              {freshResults.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => add(r.id)}
                >
                  <Thumb src={r.thumb} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.title}</span>
                    {r.subtitle && (
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {r.subtitle}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save
        </Button>
      </CardContent>
    </Card>
  );
}

function Thumb({ src }: { src?: string | null }) {
  return (
    <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
      {src && <SmartImage src={src} alt="" className="h-full w-full object-cover" />}
    </div>
  );
}
