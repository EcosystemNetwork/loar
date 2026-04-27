/**
 * Universe Watch Page — Public consumer title page.
 *
 * Netflix-style: hero art + synopsis + episode rail + character grid +
 * token link. The producer/editor canvas lives at /universe/$id; this
 * route is the front-door for viewers and fans.
 */

import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useEffect, useState } from 'react';
import { toast } from 'sonner';
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
  RefreshCw,
  CheckCircle2,
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

  // Fun-mode universes have no Universe.sol contract — their address field is
  // a synthetic placeholder (not a deployed EVM address), so Ponder has no
  // events for them. Read offChainNodes from Firestore instead. Default to
  // on-chain (matches server-side default `universeType: monetized`).
  const isOnChain = (universe as any)?.universeType !== 'fun';

  // Ponder enrichment (nodes, token) — on-chain universes only.
  const { data: ponderUniverse } = useQuery({
    queryKey: ['universe', 'watch', 'ponder', idLower],
    queryFn: () =>
      ponderGql<{ universe: PonderUniverse | null }>(`{
        universe(id: "${idLower}") {
          id nodeCount tokenAddress governorAddress name description imageURL
        }
      }`).then((d) => d.universe),
    ...ponderQueryDefaults,
    enabled: isOnChain,
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
    enabled: isOnChain,
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
    enabled: isOnChain,
  });

  // Off-chain timeline (fun-mode universes). Mirrors createNode shape but
  // lives in Firestore, so the rail can render without a deployed contract.
  const { data: offChainNodes } = useQuery({
    queryKey: ['universe', 'watch', 'off-chain-nodes', idLower],
    queryFn: () =>
      trpcClient.offChainNodes.list.query({ universeId: idLower }) as Promise<{
        nodes: Array<{
          id: string;
          universeId: string;
          nodeId: number;
          creator?: string;
          previousNodeId?: number;
          videoUrl?: string;
          plot?: string;
          title?: string;
          createdAt?: any;
        }>;
        total: number;
      }>,
    enabled: !isOnChain && !universeLoading,
    staleTime: 15_000,
  });

  // Curated Firestore episodes (titles, descriptions, canon status). Merged
  // onto the on-chain node list below so the rail prefers editor-authored
  // metadata when present and falls back to raw plot otherwise.
  const { data: fsEpisodes } = useQuery({
    queryKey: ['universe', 'watch', 'fs-episodes', idLower],
    queryFn: () =>
      trpcClient.episodes.list.query({ universeId: idLower, limit: 50 }) as Promise<
        Array<{
          id: string;
          title?: string;
          description?: string;
          isCanon?: boolean;
          clips?: Array<{ nodeId?: string; videoUrl?: string; label?: string }>;
          clipCount?: number;
          sourceNodeId?: string;
          sourceNodeIds?: string[];
          sourceCreator?: string | null;
        }>
      >,
    staleTime: 15_000,
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

  // Build episodes — merge timeline nodes with curated Firestore episodes,
  // then collapse nodes that belong to the same multi-clip episode into a
  // single rail item. Standalone nodes (no Firestore episode yet) keep one
  // card each. Firestore title/description wins; raw plot is the fallback.
  const episodes = useMemo(() => {
    // Map every node-id covered by a Firestore episode (across all clips,
    // not just the source) so multi-clip episodes resolve from any member.
    const fsByNodeId = new Map<
      string,
      {
        id: string;
        title?: string;
        description?: string;
        isCanon?: boolean;
        clipCount: number;
      }
    >();
    for (const ep of fsEpisodes || []) {
      const ids = new Set<string>();
      for (const id of ep.sourceNodeIds || []) if (id) ids.add(String(id));
      for (const c of ep.clips || []) if (c?.nodeId) ids.add(String(c.nodeId));
      if (ep.sourceNodeId) ids.add(String(ep.sourceNodeId));
      const slim = {
        id: ep.id,
        title: ep.title,
        description: ep.description,
        isCanon: ep.isCanon,
        clipCount: ep.clipCount ?? ep.clips?.length ?? ids.size,
      };
      for (const id of ids) fsByNodeId.set(id, slim);
    }

    let enriched: EpisodeRailItem[];

    if (isOnChain) {
      if (!nodes) return [];
      const contentMap = new Map<string, PonderNodeContent>();
      (nodeContents || []).forEach((c) => contentMap.set(c.id, c));

      enriched = nodes
        .map((n) => {
          const c = contentMap.get(`${n.universeAddress.toLowerCase()}:${n.nodeId}`);
          const fs = fsByNodeId.get(String(n.nodeId));
          return {
            ...n,
            videoLink: c?.videoLink,
            plot: c?.plot,
            fsEpisodeId: fs?.id,
            fsTitle: fs?.title,
            fsDescription: fs?.description,
            fsIsCanon: fs?.isCanon,
            fsClipCount: fs?.clipCount ?? 1,
          };
        })
        .filter((n) => n.videoLink || n.plot);
    } else {
      const ocNodes = offChainNodes?.nodes;
      if (!ocNodes) return [];
      enriched = ocNodes
        .map((n) => {
          const fs = fsByNodeId.get(String(n.nodeId));
          return {
            id: `${idLower}:${n.nodeId}`,
            universeAddress: idLower,
            nodeId: n.nodeId,
            previousNodeId: n.previousNodeId ?? 0,
            creator: n.creator ?? '',
            createdAt: 0,
            videoLink: n.videoUrl,
            plot: n.plot,
            fsEpisodeId: fs?.id,
            fsTitle: fs?.title ?? n.title,
            fsDescription: fs?.description,
            fsIsCanon: fs?.isCanon,
            fsClipCount: fs?.clipCount ?? 1,
          } satisfies EpisodeRailItem;
        })
        .filter((n) => n.videoLink || n.plot);
    }

    // Collapse: one rail item per Firestore episode (its earliest node is
    // the representative), one item per standalone node otherwise.
    const seenEpisodeIds = new Set<string>();
    const collapsed: EpisodeRailItem[] = [];
    // Sort ascending by nodeId so the representative is the chronological
    // start of the episode (matches the order Firestore stores clips in).
    const ascending = [...enriched].sort((a, b) => a.nodeId - b.nodeId);
    for (const item of ascending) {
      if (item.fsEpisodeId) {
        if (seenEpisodeIds.has(item.fsEpisodeId)) continue;
        seenEpisodeIds.add(item.fsEpisodeId);
      }
      collapsed.push(item);
    }
    // Restore the original (descending) order so latest episodes lead.
    return collapsed.sort((a, b) => b.nodeId - a.nodeId);
  }, [isOnChain, nodes, nodeContents, offChainNodes, fsEpisodes, idLower]);

  // Nodes on-chain that have no matching Firestore episode yet — the count
  // drives the admin Sync banner. Fun universes have no on-chain nodes to
  // sync, so the banner is suppressed for them.
  const unsyncedCount = useMemo(() => {
    if (!isOnChain) return 0;
    if (!nodes || !fsEpisodes) return 0;
    const claimed = new Set<string>();
    for (const ep of fsEpisodes) {
      for (const id of ep.sourceNodeIds || []) if (id) claimed.add(String(id));
      for (const c of ep.clips || []) if (c?.nodeId) claimed.add(String(c.nodeId));
      if (ep.sourceNodeId) claimed.add(String(ep.sourceNodeId));
    }
    const contentMap = new Map<string, PonderNodeContent>();
    (nodeContents || []).forEach((c) => contentMap.set(c.id, c));
    return nodes.filter((n) => {
      const c = contentMap.get(`${n.universeAddress.toLowerCase()}:${n.nodeId}`);
      return !!c?.videoLink && !claimed.has(String(n.nodeId));
    }).length;
  }, [isOnChain, nodes, nodeContents, fsEpisodes]);

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
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="rounded-full border-white/20 bg-white/5 text-white hover:bg-white/15 backdrop-blur-sm"
                >
                  <Link to="/universe/$id/profile" params={{ id: idLower }}>
                    <Info className="h-4 w-4 mr-2" />
                    About
                  </Link>
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

      {/* ── Admin sync banner ───────────────────────── */}
      {admin.isAdmin && !admin.isLoading && unsyncedCount > 0 && (
        <SyncEpisodesBanner
          universeId={idLower}
          unsyncedCount={unsyncedCount}
          nodes={nodes || []}
          nodeContents={nodeContents || []}
        />
      )}

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
type EpisodeRailItem = PonderNode & {
  videoLink?: string;
  plot?: string;
  fsEpisodeId?: string;
  fsTitle?: string;
  fsDescription?: string;
  fsIsCanon?: boolean;
  fsClipCount?: number;
};

function shortAddr(addr?: string): string {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function EpisodeCard({
  universeId,
  episode,
  index,
}: {
  universeId: string;
  episode: EpisodeRailItem;
  index: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [posterReady, setPosterReady] = useState(false);

  // Title resolution: curated FS title → first sentence of plot → "Episode N"
  const title = useMemo(() => {
    if (episode.fsTitle) return episode.fsTitle;
    const firstLine = (episode.plot || '').split(/[\n.!?]/)[0]?.trim();
    if (firstLine && firstLine.length > 0) return firstLine.slice(0, 80);
    return `Episode ${index + 1}`;
  }, [episode.fsTitle, episode.plot, index]);

  const description = episode.fsDescription || episode.plot || '';
  const isCurated = !!episode.fsEpisodeId;
  const isCanon = episode.fsIsCanon;

  const videoSrc = episode.videoLink ? resolveIpfsUrl(episode.videoLink) : undefined;

  const onMouseEnter = () => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.play().catch(() => {
      /* autoplay blocked — leave as poster */
    });
  };

  const onMouseLeave = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };

  const fmtDuration = (secs: number): string => {
    if (!Number.isFinite(secs) || secs <= 0) return '';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Multi-clip episodes route to the sequential player; standalone nodes
  // (no Firestore episode yet) keep the per-node /event/ surface so admins
  // can still drill in before backfill runs.
  const linkProps = episode.fsEpisodeId
    ? ({
        to: '/episode/$id' as const,
        params: { id: episode.fsEpisodeId },
      } as const)
    : ({
        to: '/event/$universe/$event' as const,
        params: { universe: universeId, event: episode.nodeId.toString() },
      } as const);

  return (
    <Link
      {...linkProps}
      className="group flex-shrink-0 w-[280px] md:w-[320px] snap-start"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-muted ring-1 ring-white/5 group-hover:ring-primary/60 transition-all">
        {videoSrc ? (
          <video
            ref={videoRef}
            src={videoSrc}
            className="w-full h-full object-cover"
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = (e.currentTarget as HTMLVideoElement).duration;
              if (Number.isFinite(d)) setDuration(d);
            }}
            onLoadedData={() => setPosterReady(true)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-pink-900/40">
            <BookOpen className="h-8 w-8 text-white/60" />
          </div>
        )}

        {/* Shimmer while the first frame is still loading */}
        {videoSrc && !posterReady && (
          <div className="absolute inset-0 bg-gradient-to-br from-stone-900 to-stone-950 animate-pulse" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {/* Centered hover play */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-lg">
            <Play className="h-5 w-5 text-primary-foreground fill-primary-foreground ml-0.5" />
          </div>
        </div>

        {/* Top-left: episode number */}
        <div className="absolute top-2 left-2 text-xs font-semibold bg-black/70 text-white px-2 py-0.5 rounded backdrop-blur-sm">
          EP {String(index + 1).padStart(2, '0')}
        </div>

        {/* Multi-clip pill — surfaces concat episodes */}
        {(episode.fsClipCount ?? 1) > 1 && (
          <div className="absolute top-2 left-14 text-[10px] font-semibold bg-black/70 text-white px-1.5 py-0.5 rounded backdrop-blur-sm flex items-center gap-1">
            <Film className="h-2.5 w-2.5" />
            {episode.fsClipCount} parts
          </div>
        )}

        {/* Top-right: canon badge when curated */}
        {isCurated && isCanon && (
          <div className="absolute top-2 right-2 text-[10px] font-semibold uppercase tracking-wider bg-primary/90 text-primary-foreground px-1.5 py-0.5 rounded backdrop-blur-sm flex items-center gap-1">
            <CheckCircle2 className="h-2.5 w-2.5" />
            Canon
          </div>
        )}

        {/* Bottom-right: duration pill */}
        {duration !== null && (
          <div className="absolute bottom-2 right-2 text-[10px] font-mono bg-black/70 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
            {fmtDuration(duration)}
          </div>
        )}
      </div>

      <div className="pt-2 space-y-0.5">
        <p className="text-sm font-medium text-white group-hover:text-primary transition-colors line-clamp-1">
          {title}
        </p>
        {description && description !== title && (
          <p className="text-xs text-muted-foreground line-clamp-2">{description}</p>
        )}
        {episode.creator && (
          <p className="text-[10px] text-muted-foreground/70 font-mono pt-0.5">
            by {shortAddr(episode.creator)}
          </p>
        )}
      </div>
    </Link>
  );
}

function EpisodeRail({
  universeId,
  episodes,
}: {
  universeId: string;
  episodes: EpisodeRailItem[];
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
  const curatedCount = ordered.filter((e) => e.fsEpisodeId).length;

  return (
    <section className="relative py-10 -mt-10">
      <div className="max-w-[1440px] mx-auto px-4 md:px-12 mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl md:text-2xl font-display italic">Episodes</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {ordered.length} released
            {curatedCount > 0 && curatedCount < ordered.length && (
              <span className="text-muted-foreground/60"> · {curatedCount} curated</span>
            )}
          </p>
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
          <EpisodeCard key={ep.id} universeId={universeId} episode={ep} index={i} />
        ))}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Admin-only sync banner — backfills canon episodes
 * from on-chain video nodes that have no Firestore
 * episode yet. One-click, idempotent.
 * ────────────────────────────────────────── */
function SyncEpisodesBanner({
  universeId,
  unsyncedCount,
  nodes,
  nodeContents,
}: {
  universeId: string;
  unsyncedCount: number;
  nodes: PonderNode[];
  nodeContents: PonderNodeContent[];
}) {
  const qc = useQueryClient();

  const backfill = useMutation({
    mutationFn: async () => {
      const contentMap = new Map<string, PonderNodeContent>();
      nodeContents.forEach((c) => contentMap.set(c.id, c));

      const payload = nodes
        .map((n) => {
          const c = contentMap.get(`${n.universeAddress.toLowerCase()}:${n.nodeId}`);
          if (!c?.videoLink) return null;
          return {
            nodeId: String(n.nodeId),
            videoUrl: resolveIpfsUrl(c.videoLink),
            plot: c.plot || '',
            creator: n.creator,
            createdAt: n.createdAt,
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x);

      if (payload.length === 0) {
        throw new Error('No video nodes with content to sync');
      }

      return trpcClient.episodes.backfillFromNodes.mutate({
        universeId,
        nodes: payload,
      }) as Promise<{
        created: number;
        skipped: number;
        universeType: string;
        autoCanoned: number;
      }>;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['universe', 'watch', 'fs-episodes', universeId] });
      if (res.created > 0) {
        const autoCanon = res.autoCanoned > 0 ? ` (${res.autoCanoned} auto-canoned)` : '';
        toast.success(`Created ${res.created} episode${res.created === 1 ? '' : 's'}${autoCanon}`);
      } else {
        toast.message('All nodes are already synced');
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    },
  });

  return (
    <div className="max-w-[1440px] mx-auto px-4 md:px-12 -mt-8 mb-2 relative z-10">
      <div className="flex items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/[0.08] backdrop-blur-sm px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/40 flex items-center justify-center flex-shrink-0">
            <Film className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">
              {unsyncedCount} on-chain video node{unsyncedCount === 1 ? '' : 's'} not yet listed as
              episodes
            </p>
            <p className="text-xs text-muted-foreground">
              Sync to create curated episode entries viewers can browse.
            </p>
          </div>
        </div>
        <Button
          size="sm"
          className="rounded-full flex-shrink-0"
          onClick={() => backfill.mutate()}
          disabled={backfill.isPending}
        >
          {backfill.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          {backfill.isPending ? 'Syncing…' : 'Sync episodes'}
        </Button>
      </div>
    </div>
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
