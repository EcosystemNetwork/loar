/**
 * Universe Watch Page — Public consumer title page.
 *
 * Netflix-style: hero art + synopsis + episode rail + character grid +
 * token link. The producer/editor canvas lives at /universe/$id; this
 * route is the front-door for viewers and fans.
 */

import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { trpcClient } from '@/utils/trpc';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import {
  ponderGql,
  ponderQueryDefaults,
  type Node as PonderNode,
  type NodeContent as PonderNodeContent,
  type Token as PonderToken,
  type Universe as PonderUniverse,
} from '@/utils/ponder-api';
import { useIsUniverseAdmin } from '@/hooks/useIsUniverseAdmin';
import {
  Play,
  ChevronLeft,
  ChevronRight,
  Wand2,
  Film,
  Users,
  Coins,
  BookOpen,
  Share2,
  Info,
  Loader2,
} from 'lucide-react';

export const Route = createFileRoute('/universe/$id/watch')({
  component: WatchPage,
});

function WatchPage() {
  const { id } = useParams({ from: '/universe/$id/watch' });
  const idLower = id.toLowerCase();
  const navigate = useNavigate();

  // Firestore universe (authoritative metadata)
  const { data: universe, isLoading: universeLoading } = useQuery({
    queryKey: ['universe', 'watch', idLower],
    queryFn: () =>
      trpcClient.universes.get.query({ id: idLower }).then((r: any) => (r?.data ?? r) as any),
  });

  // Ponder enrichment (nodes, token)
  const { data: ponderUniverse } = useQuery({
    queryKey: ['universe', 'watch', 'ponder', idLower],
    queryFn: () =>
      ponderGql<{ universe: PonderUniverse | null }>(`{
        universe(id: "${idLower}") {
          id nodeCount tokenAddress governorAddress name description imageURL
        }
      }`).then((d) => d.universe),
    ...ponderQueryDefaults,
  });

  const { data: nodes } = useQuery({
    queryKey: ['universe', 'watch', 'nodes', idLower],
    queryFn: () =>
      ponderGql<{ nodes: { items: PonderNode[] } }>(`{
        nodes(where: { universeAddress: "${idLower}" }, orderBy: "createdAt", orderDirection: "desc", limit: 50) {
          items { id universeAddress nodeId previousNodeId creator createdAt }
        }
      }`).then((d) => d.nodes.items),
    ...ponderQueryDefaults,
  });

  const { data: nodeContents } = useQuery({
    queryKey: ['universe', 'watch', 'node-contents', idLower],
    queryFn: () =>
      ponderGql<{ nodeContents: { items: PonderNodeContent[] } }>(`{
        nodeContents(limit: 1000) {
          items { id videoLink plot }
        }
      }`).then((d) => d.nodeContents.items),
    ...ponderQueryDefaults,
  });

  const { data: token } = useQuery({
    queryKey: ['universe', 'watch', 'token', idLower],
    queryFn: () =>
      ponderGql<{ tokens: { items: PonderToken[] } }>(`{
        tokens(where: { universeAddress: "${idLower}" }, limit: 1) {
          items { id universeAddress symbol name imageURL }
        }
      }`).then((d) => d.tokens.items[0] ?? null),
    ...ponderQueryDefaults,
  });

  // Admin check so managers can pivot to the editor from here
  const admin = useIsUniverseAdmin(idLower as `0x${string}`);

  // Build episodes
  const episodes = useMemo(() => {
    if (!nodes) return [];
    const contentMap = new Map<string, PonderNodeContent>();
    (nodeContents || []).forEach((c) => contentMap.set(c.id, c));
    return nodes
      .map((n) => {
        const c = contentMap.get(`${n.universeAddress.toLowerCase()}:${n.nodeId}`);
        return {
          ...n,
          videoLink: c?.videoLink,
          plot: c?.plot,
        };
      })
      .filter((n) => n.videoLink || n.plot);
  }, [nodes, nodeContents]);

  if (universeLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!universe) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-lg text-muted-foreground">Universe not found.</p>
        <Button asChild variant="outline">
          <Link to="/">Back to home</Link>
        </Button>
      </div>
    );
  }

  const title = universe.name || ponderUniverse?.name || `Universe ${idLower.slice(0, 8)}`;
  const description = universe.description || ponderUniverse?.description || '';
  const cover =
    universe.image_url || universe.imageURL || ponderUniverse?.imageURL || token?.imageURL;
  const episodeCount = ponderUniverse?.nodeCount ?? episodes.length;
  const firstEpisode = episodes[episodes.length - 1]; // oldest for "Start from episode 1"
  const latestEpisode = episodes[0];

  const handlePlay = () => {
    const ep = firstEpisode || latestEpisode;
    if (!ep) return;
    navigate({
      to: '/event/$universe/$event',
      params: { universe: idLower, event: ep.nodeId.toString() },
    });
  };

  const handleShare = async () => {
    const url = `${window.location.origin}/universe/${idLower}/watch`;
    try {
      if (navigator.share) {
        await navigator.share({ title, text: description, url });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ── Cinematic Hero ─────────────────────────── */}
      <section className="relative h-[75vh] min-h-[500px] max-h-[800px] overflow-hidden">
        {cover ? (
          <img
            src={resolveIpfsUrl(cover)}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-amber-950 via-stone-950 to-stone-950" />
        )}
        {/* Vignettes */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-background/30" />

        <div className="relative h-full flex items-end">
          <div className="w-full max-w-[1440px] mx-auto px-4 md:px-12 pb-20 md:pb-28">
            <div className="max-w-2xl space-y-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-primary/90">
                <Film className="h-3 w-3" />
                Universe
              </div>
              <h1 className="text-4xl md:text-6xl lg:text-7xl font-display italic text-white tracking-tight drop-shadow-lg">
                {title}
              </h1>
              {description && (
                <p className="text-base md:text-lg text-white/80 leading-relaxed max-w-xl line-clamp-3">
                  {description}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {episodeCount > 0 && (
                  <Badge className="bg-white/10 text-white border-0 backdrop-blur-sm">
                    <Film className="h-3 w-3 mr-1" />
                    {episodeCount} episode{episodeCount === 1 ? '' : 's'}
                  </Badge>
                )}
                {token?.symbol && (
                  <Badge className="bg-primary/80 text-white border-0 backdrop-blur-sm">
                    ${token.symbol}
                  </Badge>
                )}
              </div>

              <div className="flex flex-wrap gap-3 pt-4">
                <Button
                  size="lg"
                  className="rounded-full px-7 text-base font-semibold"
                  onClick={handlePlay}
                  disabled={!firstEpisode}
                >
                  <Play className="h-5 w-5 mr-2 fill-current" />
                  {firstEpisode ? 'Start watching' : 'No episodes yet'}
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  className="rounded-full bg-white/10 text-white border border-white/20 hover:bg-white/20 backdrop-blur-sm"
                  onClick={handleShare}
                >
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </Button>
                {admin.isAdmin && !admin.isLoading && (
                  <Button
                    asChild
                    variant="outline"
                    size="lg"
                    className="rounded-full border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    <Link to="/universe/$id" params={{ id: idLower }}>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Open editor
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Episode rail ────────────────────────────── */}
      {episodes.length > 0 && <EpisodeRail universeId={idLower} episodes={episodes} />}

      {/* ── Secondary rows ──────────────────────────── */}
      <div className="max-w-[1440px] mx-auto px-4 md:px-12 pb-20 space-y-12">
        <QuickLinks
          universeId={idLower}
          tokenAddress={token?.id || universe.tokenAddress}
          hasToken={Boolean(token?.symbol)}
        />

        {description && (
          <section>
            <h2 className="text-xl md:text-2xl font-display italic mb-3 flex items-center gap-2">
              <Info className="h-5 w-5 text-primary" />
              About this universe
            </h2>
            <p className="text-sm md:text-base text-muted-foreground leading-relaxed whitespace-pre-wrap max-w-3xl">
              {description}
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────
 * Episode horizontal rail
 * ────────────────────────────────────────── */
function EpisodeRail({
  universeId,
  episodes,
}: {
  universeId: string;
  episodes: Array<PonderNode & { videoLink?: string; plot?: string }>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollL, setCanScrollL] = useState(false);
  const [canScrollR, setCanScrollR] = useState(false);

  const updateScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollL(el.scrollLeft > 4);
    setCanScrollR(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };

  useEffect(() => {
    updateScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScroll, { passive: true });
    window.addEventListener('resize', updateScroll);
    return () => {
      el.removeEventListener('scroll', updateScroll);
      window.removeEventListener('resize', updateScroll);
    };
  }, [episodes.length]);

  const scrollBy = (dx: number) => scrollRef.current?.scrollBy({ left: dx, behavior: 'smooth' });

  // Show in chronological order (oldest first)
  const ordered = [...episodes].sort((a, b) => a.nodeId - b.nodeId);

  return (
    <section className="relative py-10 -mt-10">
      <div className="max-w-[1440px] mx-auto px-4 md:px-12 mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-display italic">Episodes</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{ordered.length} released</p>
        </div>
        <div className="hidden md:flex gap-1">
          <button
            onClick={() => scrollBy(-600)}
            disabled={!canScrollL}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center disabled:opacity-30 hover:bg-white/10 transition-colors"
            aria-label="Scroll left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={() => scrollBy(600)}
            disabled={!canScrollR}
            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center disabled:opacity-30 hover:bg-white/10 transition-colors"
            aria-label="Scroll right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto scroll-smooth snap-x px-4 md:px-12 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {ordered.map((ep, i) => (
          <Link
            key={ep.id}
            to="/event/$universe/$event"
            params={{ universe: universeId, event: ep.nodeId.toString() }}
            className="group flex-shrink-0 w-[280px] md:w-[320px] snap-start"
          >
            <div className="relative aspect-video rounded-xl overflow-hidden bg-muted ring-1 ring-white/5 group-hover:ring-primary/60 transition-all">
              {ep.videoLink ? (
                <video
                  src={resolveIpfsUrl(ep.videoLink)}
                  className="w-full h-full object-cover"
                  muted
                  preload="metadata"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-pink-900/40">
                  <BookOpen className="h-8 w-8 text-white/60" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-lg">
                  <Play className="h-5 w-5 text-primary-foreground fill-primary-foreground ml-0.5" />
                </div>
              </div>
              <div className="absolute top-2 left-2 text-xs font-semibold bg-black/60 text-white px-2 py-0.5 rounded backdrop-blur-sm">
                EP {i + 1}
              </div>
            </div>
            <div className="pt-2">
              <p className="text-sm font-medium text-white group-hover:text-primary transition-colors line-clamp-1">
                {ep.plot ? ep.plot.slice(0, 60) : `Episode ${i + 1}`}
              </p>
              {ep.plot && (
                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{ep.plot}</p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Quick link tiles (Characters, Token, Wiki)
 * ────────────────────────────────────────── */
function QuickLinks({
  universeId,
  tokenAddress,
  hasToken,
}: {
  universeId: string;
  tokenAddress?: string;
  hasToken: boolean;
}) {
  const tiles = [
    {
      to: '/characters/$universeId',
      params: { universeId } as any,
      label: 'Characters',
      subtitle: 'Cast & likeness',
      Icon: Users,
    },
    hasToken && tokenAddress
      ? {
          to: '/tokens/$address',
          params: { address: tokenAddress } as any,
          label: 'Token',
          subtitle: 'Trade & hold',
          Icon: Coins,
        }
      : null,
    {
      to: '/wiki',
      params: undefined,
      label: 'Wiki',
      subtitle: 'Lore, places, events',
      Icon: BookOpen,
    },
  ].filter(Boolean) as Array<{
    to: string;
    params: any;
    label: string;
    subtitle: string;
    Icon: React.ComponentType<{ className?: string }>;
  }>;

  if (tiles.length === 0) return null;

  return (
    <section>
      <h2 className="text-xl md:text-2xl font-display italic mb-4">Explore</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tiles.map(({ to, params, label, subtitle, Icon }) => (
          <Link
            key={label}
            to={to as any}
            params={params}
            className="group flex items-center gap-4 p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-primary/40 hover:bg-white/[0.04] transition-all"
          >
            <div className="w-11 h-11 rounded-lg bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">{label}</p>
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto group-hover:text-primary transition-colors" />
          </Link>
        ))}
      </div>
    </section>
  );
}
