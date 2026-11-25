/**
 * Studio — Producer command center.
 *
 * The creator hub. Lists universes the connected wallet created, with quick
 * entry points into the editor, access settings, analytics, and the public
 * watch page — then every pro tool (Canvas, Notebook, Voice Studio, editors,
 * growth tools) grouped by job. Global nav links here instead of listing
 * tools itself; the tool list comes from `studioToolGroups` in navLinks.
 */

import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth, awaitSessionValidation } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SmartImage } from '@/components/SmartImage';
import {
  ponderGql,
  ponderQueryDefaults,
  type Universe as PonderUniverse,
  type Token as PonderToken,
} from '@/utils/ponder-api';
import type { FirestoreUniverse } from '@/types/firestore';
import { visibleStudioToolGroups } from '@/lib/navLinks';
import {
  Plus,
  Settings,
  BarChart3,
  Eye,
  Film,
  Loader2,
  Wand2,
  Coins,
  Layers,
  GitBranch,
  Sparkles,
  LayoutGrid,
  NotebookPen,
  ListVideo,
  Mic,
  FlaskConical,
  ImageIcon,
  UserRound,
  ScanFace,
  Upload,
  Scissors,
  Eraser,
  Expand,
  SunMedium,
  TrendingUp,
  Megaphone,
  Library,
  ShoppingBag,
  Tv,
  Building2,
  Bot,
  DollarSign,
  ArrowRight,
} from 'lucide-react';

export const Route = createFileRoute('/studio/')({
  // WEB-6: await /auth/me before studio mutations become reachable.
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/studio' } });
    }
    await awaitSessionValidation();
  },
  component: StudioPage,
});

type StudioUniverse = FirestoreUniverse & {
  nodeCount?: number;
  tokenSymbol?: string;
  tokenAddress?: string;
};

function StudioPage() {
  const { address, isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();

  const { data: mine, isLoading } = useQuery({
    queryKey: ['studio', 'universes', address],
    queryFn: () =>
      trpcClient.universes.getByCreator
        .query({ creator: address! })
        .then((r: any) => (r?.data ?? r) as FirestoreUniverse[]),
    enabled: !!address && isAuthenticated,
    staleTime: 15_000,
  });

  const { data: buildable, isLoading: isLoadingBuildable } = useQuery({
    queryKey: ['studio', 'buildable-universes', address],
    queryFn: async () => {
      try {
        return await trpcClient.universes.getEditableByMe.query();
      } catch {
        return await trpcClient.universes.getByCreator.query({ creator: address! });
      }
    },
    enabled: !!address && isAuthenticated,
    staleTime: 30_000,
  });
  const buildableList = ((buildable as any)?.data ?? buildable ?? []) as BuildableUniverse[];

  const ids = useMemo(() => (mine || []).map((u) => u.id.toLowerCase()), [mine]);

  const { data: ponderUniverses } = useQuery({
    queryKey: ['studio', 'ponder-enrich', ids.join(',')],
    queryFn: () =>
      ponderGql<{ universes: { items: PonderUniverse[] } }>(`{
        universes(limit: 200) {
          items { id nodeCount tokenAddress }
        }
      }`).then((d) => d.universes.items),
    ...ponderQueryDefaults,
    enabled: ids.length > 0,
  });

  const { data: tokens } = useQuery({
    queryKey: ['studio', 'tokens', ids.join(',')],
    queryFn: () =>
      ponderGql<{ tokens: { items: PonderToken[] } }>(`{
        tokens(limit: 500) {
          items { id universeAddress symbol name imageURL }
        }
      }`).then((d) => d.tokens.items),
    ...ponderQueryDefaults,
    enabled: ids.length > 0,
  });

  const enriched: StudioUniverse[] = useMemo(() => {
    const byId = new Map<string, PonderUniverse>();
    (ponderUniverses || []).forEach((u) => byId.set(u.id.toLowerCase(), u));
    const tokenById = new Map<string, PonderToken>();
    (tokens || []).forEach((t) => tokenById.set(t.universeAddress.toLowerCase(), t));
    return (mine || []).map((u) => {
      const p = byId.get(u.id.toLowerCase());
      const t = tokenById.get(u.id.toLowerCase());
      return {
        ...u,
        nodeCount: p?.nodeCount ?? 0,
        tokenSymbol: t?.symbol,
        tokenAddress: t?.id || u.tokenAddress,
      };
    });
  }, [mine, ponderUniverses, tokens]);

  if (isAuthenticating || (isAuthenticated && (isLoading || isLoadingBuildable))) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const totalEpisodes = enriched.reduce((sum, u) => sum + (u.nodeCount || 0), 0);
  const tokenized = enriched.filter(
    (u) => u.tokenAddress && u.tokenAddress !== '0x0000000000000000000000000000000000000000'
  ).length;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ────────────────────────────────────── */}
      <div className="border-b border-white/5 bg-gradient-to-b from-primary/5 to-transparent">
        <div className="max-w-[1440px] mx-auto px-4 md:px-8 py-10">
          <div className="flex items-start justify-between gap-6 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-primary/80 mb-2">Studio</p>
              <h1 className="text-3xl md:text-4xl font-display font-semibold text-foreground">
                Your studio
              </h1>
              <p className="text-sm text-muted-foreground mt-2 max-w-xl">
                Your universes and every tool to build them. Open the editor, tune access, track
                revenue, or jump into Canvas, Voice Studio and the editors below.
              </p>
            </div>
            <Button asChild size="lg" className="rounded-full px-6">
              <Link to="/cinematicUniverseCreate">
                <Plus className="h-4 w-4 mr-2" />
                New universe
              </Link>
            </Button>
          </div>

          {enriched.length > 0 && (
            <div className="mt-6 grid grid-cols-3 gap-4 max-w-md">
              <Stat label="Universes" value={enriched.length} icon={Layers} />
              <Stat label="Episodes" value={totalEpisodes} icon={Film} />
              <Stat label="Tokenized" value={tokenized} icon={Coins} />
            </div>
          )}
        </div>
      </div>

      {/* ── Body ──────────────────────────────────────── */}
      <div className="max-w-[1440px] mx-auto px-4 md:px-8 py-8">
        <BuildableUniverses list={buildableList} />
        {enriched.length === 0 ? (
          <EmptyState onCreate={() => navigate({ to: '/cinematicUniverseCreate' })} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {enriched.map((u) => (
              <StudioCard key={u.id} universe={u} />
            ))}
          </div>
        )}
        <StudioTools />
      </div>
    </div>
  );
}

type BuildableUniverse = {
  id: string;
  name?: string;
  description?: string;
  image_url?: string;
  imageURL?: string;
  portrait_image_url?: string;
  isPrivate?: boolean;
  roles?: Array<'creator' | 'safe_signer' | 'team_member'>;
};

/**
 * Universes the caller can author into — creator, Safe multi-sig signer, or
 * team member. Relocated here from the old `/create` hub. Each tile jumps
 * into the generation console scoped to that wiki.
 *
 * `list` is fetched by the parent and folded into its own loading gate so
 * this section is present (or absent) on first paint rather than popping in
 * and pushing the rest of the page down after the main grid has settled.
 */
function BuildableUniverses({ list }: { list: BuildableUniverse[] }) {
  if (list.length === 0) return null;

  const roleLabel = (roles: string[] | undefined): string | null => {
    if (!roles || roles.length === 0) return null;
    if (roles.includes('creator')) return null;
    if (roles.includes('safe_signer')) return 'Multi-sig';
    if (roles.includes('team_member')) return 'Team';
    return null;
  };

  return (
    <div className="mb-10">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Generate into</h2>
          <p className="text-sm text-muted-foreground">
            Universes you own or co-author. Pick one to generate into.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {list.map((u) => {
          const img = u.image_url || u.imageURL || u.portrait_image_url || '';
          const role = roleLabel(u.roles);
          return (
            <div
              key={u.id}
              className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-primary/40 transition-all overflow-hidden"
            >
              <Link
                to="/create"
                search={{ universe: u.id }}
                className="flex items-center gap-3 p-3"
              >
                {img ? (
                  <SmartImage
                    src={img}
                    alt=""
                    sizes="48px"
                    className="h-12 w-12 rounded-lg flex-shrink-0"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-gradient-to-br from-primary/40 to-orange-500/40 flex-shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold truncate">{u.name || 'Untitled universe'}</p>
                    {u.isPrivate && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Private
                      </span>
                    )}
                    {role && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
                        {role}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {u.description || `${u.id.slice(0, 6)}…${u.id.slice(-4)}`}
                  </p>
                </div>
              </Link>
              <div className="flex items-stretch gap-px bg-white/5 border-t border-white/5 text-xs">
                <Link
                  to="/create"
                  search={{ universe: u.id }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  <Sparkles className="h-3 w-3" />
                  Generate
                </Link>
                <Link
                  to="/universe/$id"
                  params={{ id: u.id }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-2 hover:bg-white/10 transition-colors"
                >
                  <GitBranch className="h-3 w-3" />
                  Editor
                </Link>
                <Link
                  to="/universe/$id/gallery"
                  params={{ id: u.id }}
                  className="flex-1 inline-flex items-center justify-center px-2 py-2 hover:bg-white/10 transition-colors"
                >
                  Gallery
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/5 flex items-center justify-center">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold text-foreground tabular-nums">{value}</p>
      </div>
    </div>
  );
}

function StudioCard({ universe: u }: { universe: StudioUniverse }) {
  const cover = u.image_url || u.imageURL;
  const title = u.name || `Universe ${u.id.slice(0, 8)}`;
  const hasToken =
    u.tokenAddress && u.tokenAddress !== '0x0000000000000000000000000000000000000000';

  return (
    <Card className="overflow-hidden group bg-white/[0.02] border-white/5 hover:border-primary/40 transition-all">
      {/* Art — clicking the cover opens the public profile so creators see
          what fans see first. The "Edit" button below jumps into the editor. */}
      <Link to="/universe/$id/profile" params={{ id: u.id }} className="block">
        <div className="relative aspect-video bg-muted overflow-hidden">
          {cover ? (
            <SmartImage
              src={cover}
              alt=""
              className="w-full h-full group-hover:scale-[1.02] transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-amber-900/60 via-stone-900 to-stone-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
          <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between gap-2">
            <h3 className="text-white font-semibold text-base truncate drop-shadow">{title}</h3>
            <div className="flex gap-1 flex-shrink-0">
              {(u.nodeCount ?? 0) > 0 && (
                <Badge className="bg-green-500/90 text-white text-[10px] border-0">
                  {u.nodeCount} EP
                </Badge>
              )}
              {u.tokenSymbol && (
                <Badge className="bg-primary/90 text-white text-[10px] border-0">
                  ${u.tokenSymbol}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </Link>

      {/* Description */}
      {u.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 px-4 pt-3">{u.description}</p>
      )}

      {/* Actions — Open Editor is the primary CTA: full-width, large, primary
          color, so creators can't miss the entry point to the React Flow
          universe canvas. Secondary actions sit below in a compact row. */}
      <div className="p-4 pt-3 space-y-2">
        <Button asChild size="lg" className="w-full gap-2 font-semibold shadow-sm">
          <Link to="/universe/$id" params={{ id: u.id }}>
            <Wand2 className="h-4 w-4" />
            Open Editor
          </Link>
        </Button>
        <div className="grid grid-cols-3 gap-1">
          <Button asChild size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
            <Link to="/universe/$id/watch" params={{ id: u.id }}>
              <Eye className="h-3.5 w-3.5" />
              Watch
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
            <Link to="/analytics/$universeId" params={{ universeId: u.id }}>
              <BarChart3 className="h-3.5 w-3.5" />
              Analytics
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="gap-1.5 text-muted-foreground">
            <Link to="/universe/$id" params={{ id: u.id }} search={{ panel: 'access' } as any}>
              <Settings className="h-3.5 w-3.5" />
              Access
            </Link>
          </Button>
        </div>
      </div>

      {hasToken && (
        <Link
          to="/tokens/$address"
          params={{ address: u.tokenAddress! }}
          className="block border-t border-white/5 px-4 py-2 text-[11px] text-muted-foreground hover:text-primary transition-colors flex items-center justify-between"
        >
          <span className="flex items-center gap-1.5">
            <Coins className="h-3 w-3" />
            Token page
          </span>
          <span className="font-mono">
            {u.tokenAddress!.slice(0, 6)}…{u.tokenAddress!.slice(-4)}
          </span>
        </Link>
      )}
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="text-center py-12 border border-dashed border-border/60 rounded-2xl bg-card/20">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/30 mx-auto flex items-center justify-center mb-4">
        <Plus className="h-6 w-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-2">No universes yet</h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto mb-6">
        Launch your first universe to unlock the timeline editor, token launchpad and revenue tools.
        The tools below work without one.
      </p>
      <Button size="lg" onClick={onCreate} className="rounded-full px-6">
        <Plus className="h-4 w-4 mr-2" />
        Create your first universe
      </Button>
    </div>
  );
}

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  '/canvas': LayoutGrid,
  '/notebook': NotebookPen,
  '/series': ListVideo,
  '/lab/voice-studio': Mic,
  '/lab/zai': FlaskConical,
  '/lab/gpt-image': ImageIcon,
  '/create/persona': UserRound,
  '/create/likeness': ScanFace,
  '/upload': Upload,
  '/editor': Scissors,
  '/edit/inpaint': Eraser,
  '/edit/outpaint': Expand,
  '/relight': SunMedium,
  '/virality': TrendingUp,
  '/marketing': Megaphone,
  '/ad-reference': Library,
  '/sell': ShoppingBag,
  '/adplacements': Tv,
  '/brand/dashboard': Building2,
  '/agents': Bot,
  '/arc': DollarSign,
};

/** Every pro tool, grouped by job. Replaces the old global "More" lab index. */
function StudioTools() {
  const groups = visibleStudioToolGroups();
  return (
    <section className="mt-14" aria-labelledby="studio-tools-heading">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 id="studio-tools-heading" className="text-xl font-semibold tracking-tight">
            Tools
          </h2>
          <p className="text-sm text-muted-foreground">
            Everything beyond the one-prompt{' '}
            <Link to="/create" className="text-primary hover:underline">
              Create
            </Link>{' '}
            console.
          </p>
        </div>
      </div>
      <div className="space-y-8">
        {groups.map((group) => (
          <div key={group.label}>
            <h3 className="mb-3 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
              {group.label}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
              {group.tools.map((tool) => {
                const Icon = TOOL_ICONS[tool.to] ?? Sparkles;
                return (
                  <Link
                    key={tool.to}
                    to={tool.to as any}
                    className="group flex items-start gap-3 rounded-xl border border-border/60 bg-card/40 p-3 transition-colors duration-100 hover:border-primary/40 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{tool.label}</span>
                        {tool.beta && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                            Beta
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-2">
                        {tool.description}
                      </span>
                    </span>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
