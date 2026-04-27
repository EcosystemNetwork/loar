import type { EnrichedUniverse } from './types';
/**
 * Home / Landing Page — Netflix × Webtoons hybrid
 *
 * Full-bleed hero billboard, horizontal scroll content rows,
 * tall portrait cards, genre discovery, dark cinematic vibe.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

import {
  Play,
  Plus,
  Search,
  TrendingUp,
  Users,
  ChevronLeft,
  ChevronRight,
  Flame,
  Sparkles,
  Clock,
  Star,
  X,
  Tv,
  BookOpen,
  Zap,
  Eye,
} from 'lucide-react';
import { LoarIcon } from '@/components/loar-icons';
import { GettingStartedPopup } from '@/components/GettingStartedBanner';
import { useQuery } from '@tanstack/react-query';
import {
  ponderGql,
  ponderQueryDefaults,
  type Universe,
  type Token,
  type Node,
  type NodeContent,
  type Swap,
  type TokenHolder,
} from '@/utils/ponder-api';
import { trpc, trpcClient } from '@/utils/trpc';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';

/* ──────────────────────────────────────────
 * Utility: horizontal scroll row with arrows
 * ────────────────────────────────────────── */
export function ScrollRow({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    if (!ref.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = ref.current;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 4);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = ref.current;
    if (el) {
      el.addEventListener('scroll', checkScroll, { passive: true });
      const ro = new ResizeObserver(checkScroll);
      ro.observe(el);
      return () => {
        el.removeEventListener('scroll', checkScroll);
        ro.disconnect();
      };
    }
  }, [checkScroll, children]);

  const scroll = (dir: 'left' | 'right') => {
    if (!ref.current) return;
    const amount = ref.current.clientWidth * 0.75;
    ref.current.scrollBy({
      left: dir === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  };

  return (
    <div className="group/row relative">
      {/* Left arrow */}
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-r from-background via-background/80 to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronLeft className="h-8 w-8 text-white drop-shadow-lg" />
        </button>
      )}

      <div
        ref={ref}
        className={`flex gap-3 overflow-x-auto scrollbar-hide scroll-smooth px-4 md:px-12 ${className}`}
      >
        {children}
      </div>

      {/* Right arrow */}
      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-l from-background via-background/80 to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronRight className="h-8 w-8 text-white drop-shadow-lg" />
        </button>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────
 * Section header with optional "See All" link
 * ────────────────────────────────────────── */
export function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between px-4 md:px-12 mb-5">
      <div className="flex items-baseline gap-3">
        <Icon className="h-5 w-5 text-primary self-center" />
        <div>
          <h2 className="text-xl md:text-2xl font-display italic text-foreground">{title}</h2>
          {subtitle && (
            <p className="text-xs text-muted-foreground font-light mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ──────────────────────────────────────────
 * Universe Card — tall portrait (Webtoons feel)
 * ────────────────────────────────────────── */
export function UniverseCard({ universe }: { universe: EnrichedUniverse }) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate({ to: '/universe/$id/watch', params: { id: universe.id } })}
      className="group flex-shrink-0 w-[180px] md:w-[200px] cursor-pointer"
    >
      {/* Tall poster image — prefer dedicated portrait crop */}
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-muted mb-2 ring-1 ring-white/5 group-hover:ring-primary/60 transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-xl group-hover:shadow-primary/20">
        {universe.portraitImageURL || universe.imageURL || universe.tokenData?.imageURL ? (
          <img
            src={resolveIpfsUrl(
              universe.portraitImageURL || universe.imageURL || universe.tokenData?.imageURL
            )}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-amber-900/80 via-stone-900 to-stone-950" />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

        {/* Hover play indicator */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <Play className="h-4 w-4 text-primary-foreground fill-primary-foreground ml-0.5" />
          </div>
        </div>

        {/* Bottom info overlay */}
        <div className="absolute bottom-0 left-0 right-0 p-3">
          {/* Badges */}
          <div className="flex gap-1.5 mb-2 flex-wrap">
            {universe.nodeCount > 0 && (
              <span className="text-[10px] font-semibold bg-green-500/90 text-white px-1.5 py-0.5 rounded">
                {universe.nodeCount} EP
              </span>
            )}
            {universe.tokenData && universe.tokenData.symbol && (
              <span className="text-[10px] font-semibold bg-primary/90 text-white px-1.5 py-0.5 rounded">
                ${universe.tokenData.symbol}
              </span>
            )}
            {universe.holderCount > 0 && (
              <span className="text-[10px] font-semibold bg-purple-500/90 text-white px-1.5 py-0.5 rounded">
                <Users className="inline h-2.5 w-2.5 mr-0.5" />
                {universe.holderCount}
              </span>
            )}
          </div>
        </div>

        {/* Top-right rank/new badge */}
        {universe._rank !== undefined && universe._rank < 3 && (
          <div className="absolute top-2 left-2">
            <span className="text-3xl font-black text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
              {universe._rank + 1}
            </span>
          </div>
        )}
      </div>

      {/* Title below card */}
      <h3 className="font-semibold text-sm text-white truncate group-hover:text-primary transition-colors px-0.5">
        {universe.name || universe.tokenData?.name || `Universe ${universe.id.slice(0, 8)}`}
      </h3>
      <p className="text-xs text-muted-foreground truncate px-0.5">
        {universe.description || universe.tokenData?.metadata || 'Explore this universe'}
      </p>
    </div>
  );
}

/* ──────────────────────────────────────────
 * Wide landscape card for featured row
 * ────────────────────────────────────────── */
export function WideCard({ universe }: { universe: EnrichedUniverse }) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate({ to: '/universe/$id/watch', params: { id: universe.id } })}
      className="group flex-shrink-0 w-[320px] md:w-[400px] cursor-pointer"
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-muted ring-1 ring-white/5 group-hover:ring-primary/60 transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-xl group-hover:shadow-primary/20">
        {universe.imageURL || universe.tokenData?.imageURL ? (
          <img
            src={resolveIpfsUrl(universe.imageURL || universe.tokenData?.imageURL)}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-amber-900/80 via-stone-900 to-stone-950" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

        {/* Hover play */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
            <Play className="h-5 w-5 text-primary-foreground fill-primary-foreground ml-0.5" />
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="font-bold text-white text-base mb-1 truncate">
            {universe.name || universe.tokenData?.name || `Universe ${universe.id.slice(0, 8)}`}
          </h3>
          <p className="text-xs text-white/70 line-clamp-2 leading-relaxed mb-2">
            {universe.description || universe.tokenData?.metadata || ''}
          </p>
          <div className="flex gap-2">
            {universe.nodeCount > 0 && (
              <Badge className="bg-white/20 text-white text-[10px] backdrop-blur-sm border-0">
                {universe.nodeCount} Episodes
              </Badge>
            )}
            {universe.holderCount > 0 && (
              <Badge className="bg-white/20 text-white text-[10px] backdrop-blur-sm border-0">
                {universe.holderCount} Fans
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────
 * Indexer offline / stale banner
 * ────────────────────────────────────────── */
export function IndexerBanner() {
  return (
    <div className="bg-amber-950/40 border-b border-amber-800/40 px-4 md:px-12 py-2 flex items-center gap-2.5 text-sm">
      <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
      <span className="text-amber-200/80">
        Blockchain indexer is offline — on-chain universe data is unavailable
      </span>
    </div>
  );
}

/* ──────────────────────────────────────────
 * Hero skeleton shown during initial load
 * ────────────────────────────────────────── */
export function HeroSkeleton() {
  return (
    <div className="relative h-[70vh] min-h-[440px] md:min-h-[500px] max-h-[800px] bg-gradient-to-b from-primary/5 via-background to-background flex items-end">
      <div className="w-full px-4 md:px-12 pb-32 md:pb-32 max-w-3xl space-y-4 animate-pulse">
        <div className="h-4 w-24 rounded bg-white/10" />
        <div className="h-12 sm:h-14 w-3/4 max-w-80 rounded bg-white/10" />
        <div className="h-4 w-full max-w-96 rounded bg-white/10" />
        <div className="h-4 w-2/3 max-w-72 rounded bg-white/10" />
        <div className="flex gap-3 pt-2">
          <div className="h-11 w-32 rounded-full bg-white/10" />
          <div className="h-11 w-28 rounded-full bg-white/10" />
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────
 * Hero Billboard (Netflix-style)
 * ────────────────────────────────────────── */
export function HeroBillboard({ universes }: { universes: EnrichedUniverse[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const navigate = useNavigate();
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const featured = useMemo(() => {
    const FEATURED_FIRST = 'space fleet';
    const eligible = universes.filter((u) => u.tokenData || u.nodeCount > 0);
    const pool = eligible.length > 0 ? eligible : universes;
    const sorted = [...pool].sort((a, b) => {
      const aHit = a.name?.toLowerCase().trim() === FEATURED_FIRST ? -1 : 0;
      const bHit = b.name?.toLowerCase().trim() === FEATURED_FIRST ? -1 : 0;
      return aHit - bHit;
    });
    return sorted.slice(0, 5);
  }, [universes]);

  // Auto-advance every 8 seconds
  useEffect(() => {
    if (featured.length <= 1) return;
    intervalRef.current = setInterval(() => {
      setCurrentIndex((i) => (i + 1) % featured.length);
    }, 8000);
    return () => clearInterval(intervalRef.current);
  }, [featured.length]);

  const goTo = (i: number) => {
    setCurrentIndex(i);
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % featured.length);
    }, 8000);
  };

  if (featured.length === 0) {
    return (
      <div className="relative h-[70vh] min-h-[440px] md:min-h-[500px] max-h-[800px] flex items-center justify-center bg-gradient-to-b from-primary/10 via-background to-background">
        <div className="text-center px-4">
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-display italic text-white mb-4 tracking-tight">
            Your universe awaits
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-white/60 mb-8 max-w-lg mx-auto px-4 font-light">
            Create, own, and trade narrative universes on-chain
          </p>
          <Button
            size="lg"
            className="rounded-full px-8 text-base"
            onClick={() => navigate({ to: '/cinematicUniverseCreate' })}
          >
            <Plus className="h-5 w-5 mr-2" />
            Create Your First Universe
          </Button>
        </div>
      </div>
    );
  }

  const current = featured[currentIndex];
  if (!current) return null;

  return (
    <div className="relative h-[70vh] min-h-[440px] md:min-h-[500px] max-h-[800px] overflow-hidden">
      {/* Background image with Ken Burns effect */}
      {featured.map((u, i) => (
        <div
          key={u.id}
          className="absolute inset-0 transition-opacity duration-1000"
          style={{ opacity: i === currentIndex ? 1 : 0 }}
        >
          {u.imageURL || u.tokenData?.imageURL ? (
            <img
              src={resolveIpfsUrl(u.imageURL || u.tokenData?.imageURL)}
              alt=""
              className="w-full h-full object-cover scale-105"
              style={{
                animation:
                  i === currentIndex ? 'kenburns 12s ease-in-out infinite alternate' : 'none',
              }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-amber-950 via-stone-950 to-stone-950" />
          )}
        </div>
      ))}

      {/* Vignette overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex items-end">
        <div className="w-full px-4 md:px-12 pb-32 md:pb-32 max-w-3xl">
          {/* Badges */}
          <div className="flex items-center gap-2 mb-3 md:mb-4 flex-wrap">
            <Badge className="bg-primary text-white border-0 text-xs">
              <Sparkles className="h-3 w-3 mr-1" />
              Featured
            </Badge>
            {current.nodeCount > 0 && (
              <Badge className="bg-white/15 text-white border-0 backdrop-blur-sm text-xs">
                {current.nodeCount} Episodes
              </Badge>
            )}
            {current.holderCount > 0 && (
              <Badge className="bg-white/15 text-white border-0 backdrop-blur-sm text-xs">
                <Users className="h-3 w-3 mr-1" />
                {current.holderCount} Holders
              </Badge>
            )}
          </div>

          {/* Title */}
          <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-display italic text-white mb-3 md:mb-4 leading-[1.1]">
            {current.name || current.tokenData?.name}
          </h1>

          {/* Description */}
          <p className="text-sm sm:text-base md:text-lg text-white/50 mb-5 md:mb-6 max-w-xl line-clamp-2 sm:line-clamp-3 leading-relaxed font-light">
            {current.description || current.tokenData?.metadata}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <Button
              size="lg"
              className="px-5 sm:px-6 bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
              onClick={() => navigate({ to: '/universe/$id/watch', params: { id: current.id } })}
            >
              <Play className="h-4 w-4 mr-2 fill-current" />
              Explore
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="px-5 sm:px-6 text-white/80 hover:text-white hover:bg-white/10 font-medium"
              onClick={() => navigate({ to: '/universe/$id/watch', params: { id: current.id } })}
            >
              <BookOpen className="h-4 w-4 mr-2" />
              Details
            </Button>
            {current.tokenData && (
              <div className="hidden sm:flex items-center gap-2 ml-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm border border-white/10">
                <Zap className="h-4 w-4 text-primary" />
                <span className="text-white font-bold">${current.tokenData.symbol}</span>
                {current.swapVolume > 0 && (
                  <span className="text-white/50 text-sm">
                    Vol ${(current.swapVolume / 1e18).toFixed(2)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Dot indicators — sit above the mobile bottom nav */}
      {featured.length > 1 && (
        <div className="absolute bottom-20 md:bottom-8 left-4 md:left-12 flex gap-2 z-10">
          {featured.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Show featured universe ${i + 1}`}
              className={`h-1 rounded-full transition-all duration-500 ${
                i === currentIndex ? 'bg-white w-8' : 'bg-white/30 w-4 hover:bg-white/60'
              }`}
            />
          ))}
        </div>
      )}

      {/* Bottom fade into content */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />
    </div>
  );
}

/* ──────────────────────────────────────────
 * Live Activity Ticker
 * ────────────────────────────────────────── */
export function ActivityTicker() {
  const { data: nodesData } = useQuery({
    queryKey: ['ponder', 'nodes', 'recent-20'],
    queryFn: () =>
      ponderGql<{ nodes: { items: Node[] } }>(`{
        nodes(orderBy: "createdAt", orderDirection: "desc", limit: 20) {
          items { id universeAddress nodeId previousNodeId creator createdAt }
        }
      }`).then((d) => d.nodes.items),
    ...ponderQueryDefaults,
  });

  const { data: nodeContentData } = useQuery({
    queryKey: ['ponder', 'nodeContents'],
    queryFn: () =>
      ponderGql<{ nodeContents: { items: NodeContent[] } }>(`{
        nodeContents(limit: 1000) {
          items { id videoLink plot }
        }
      }`).then((d) => d.nodeContents.items),
    ...ponderQueryDefaults,
  });

  const { data: universesData } = useQuery({
    queryKey: ['ponder', 'universes', 'all'],
    queryFn: () =>
      ponderGql<{ universes: { items: Universe[] } }>(`{
        universes(limit: 1000) {
          items { id universeId creator createdAt name description imageURL tokenAddress governorAddress nodeCount }
        }
      }`).then((d) => d.universes.items),
    ...ponderQueryDefaults,
  });

  const activities = useMemo(() => {
    if (!nodesData || !nodeContentData || !universesData) {
      return [];
    }

    const contentMap = new Map<string, NodeContent>();
    nodeContentData.forEach((c) => contentMap.set(c.id, c));

    // Mirror Top10Strip ranking so the ticker surfaces the same 10 universes:
    // pin "space fleet" first, then sort by nodeCount + token presence.
    const isPinned = (u: Universe) => u.name?.trim().toLowerCase() === 'space fleet';
    const score = (u: Universe) =>
      (u.nodeCount || 0) * 100 +
      (u.tokenAddress && u.tokenAddress !== '0x0000000000000000000000000000000000000000' ? 50 : 0);
    const pinned = universesData.filter(isPinned);
    const rest = universesData.filter((u) => !isPinned(u)).sort((a, b) => score(b) - score(a));
    const topTen = [...pinned, ...rest].slice(0, 10);

    // Latest node per universe — drives the action label so each top-10 entry
    // reads with its most recent activity instead of a generic "trending".
    const latestNodeByUniverse = new Map<string, Node>();
    for (const n of nodesData) {
      const key = n.universeAddress.toLowerCase();
      const existing = latestNodeByUniverse.get(key);
      if (!existing || n.createdAt > existing.createdAt) {
        latestNodeByUniverse.set(key, n);
      }
    }

    return topTen.map((u) => {
      const key = u.id.toLowerCase();
      const recentNode = latestNodeByUniverse.get(key);
      let action: string;
      if (recentNode) {
        const content = contentMap.get(`${key}:${recentNode.nodeId}`);
        action = content?.plot ? 'new episode' : 'minted a node';
      } else if ((u.nodeCount || 0) > 0) {
        action = `${u.nodeCount} episodes`;
      } else {
        action = 'launched';
      }
      return {
        id: u.id,
        universeName: u.name || `Universe ${u.id.slice(0, 8)}`,
        action,
        universeId: u.id,
        createdAt: recentNode?.createdAt || u.createdAt,
      };
    });
  }, [nodesData, nodeContentData, universesData]);

  // Marquee math: the `ticker` keyframe translates from 0 to -50%, so we
  // render exactly 2 copies of the activity list side-by-side. As the first
  // copy slides off the left, the second arrives in view — and since both
  // halves are identical, the seam is invisible. If activity is too short
  // for a full screen width the user sees the loop, but it still flows.
  const marqueeItems = useMemo(() => {
    if (activities.length === 0) return [];
    return [...activities, ...activities];
  }, [activities]);

  if (activities.length === 0) return null;

  return (
    <div className="border-b border-white/5 bg-white/[0.02] overflow-hidden flex">
      <div className="flex gap-6 px-4 py-2.5 whitespace-nowrap w-max animate-[ticker_40s_linear_infinite] hover:[animation-play-state:paused]">
        {marqueeItems.map((a, i) => (
          <Link
            key={`${a.id}-${i}`}
            to="/universe/$id/watch"
            params={{ id: a.universeId }}
            className="flex items-center gap-2 text-sm flex-shrink-0 hover:text-primary transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="font-medium text-white/80">{a.universeName}</span>
            <span className="text-muted-foreground">{a.action}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────
 * Recent Episodes Row — curated canon episodes from Firestore (cross-universe)
 *
 * Pulls from `episodes.feed`, which surfaces multi-clip episodes built by
 * grouping consecutive on-chain video nodes per creator. Falls back to nothing
 * when no canon episodes exist yet — universes with raw nodes are still shown
 * via the universe-card rails below.
 * ────────────────────────────────────────── */
type FeedEpisode = {
  id: string;
  universeId: string;
  title: string;
  description: string;
  clipCount: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  sourceCreator: string | null;
  createdAt: string | null;
  isCanon: boolean;
  universe: { id: string; name: string; imageURL: string; creator: string | null };
};

export function RecentEpisodes() {
  const { data: episodes } = useQuery<FeedEpisode[]>({
    queryKey: ['episodes', 'feed', 20],
    queryFn: () => trpcClient.episodes.feed.query({ limit: 20 }) as Promise<FeedEpisode[]>,
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  });

  if (!episodes || episodes.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader
        icon={Clock}
        title="New Episodes"
        subtitle="Latest canon from across the multiverse"
      />
      <ScrollRow>
        {episodes.map((ep) => {
          const ts = ep.createdAt ? new Date(ep.createdAt).getTime() : 0;
          return (
            <Link
              key={ep.id}
              to="/episode/$id"
              params={{ id: ep.id }}
              className="group flex-shrink-0 w-[260px] md:w-[300px]"
            >
              {/* Video thumbnail */}
              <div className="relative aspect-video rounded-xl overflow-hidden bg-muted mb-2 ring-1 ring-white/5 group-hover:ring-primary/60 transition-all">
                {ep.videoUrl ? (
                  <>
                    <video
                      src={`${resolveIpfsUrl(ep.videoUrl)}#t=0.1`}
                      poster={resolveIpfsUrl(ep.thumbnailUrl) || undefined}
                      className="w-full h-full object-cover"
                      muted
                      loop
                      playsInline
                      preload="metadata"
                      onMouseEnter={(e) => {
                        const p = e.currentTarget.play();
                        if (p) p.catch(() => {});
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.pause();
                        e.currentTarget.currentTime = 0;
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 pointer-events-none">
                      <Play className="h-8 w-8 text-white fill-white" />
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-pink-900/40">
                    <BookOpen className="h-8 w-8 text-white/60" />
                  </div>
                )}

                {/* Clip-count pill (top-left) — surfaces concat episodes */}
                {ep.clipCount > 1 && (
                  <div className="absolute top-2 left-2 px-2 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[10px] text-white font-semibold flex items-center gap-1">
                    <Tv className="h-3 w-3" />
                    {ep.clipCount} parts
                  </div>
                )}

                {/* Timestamp (top-right) */}
                {ts > 0 && (
                  <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[10px] text-white font-medium">
                    {new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex gap-2 items-start px-0.5">
                {ep.universe.imageURL ? (
                  <img
                    src={resolveIpfsUrl(ep.universe.imageURL)}
                    alt=""
                    loading="lazy"
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-white truncate group-hover:text-primary transition-colors">
                    {ep.title}
                  </h4>
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {ep.universe.name || 'Untitled universe'}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </ScrollRow>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Top 10 Strip — numbered cards (Netflix Top 10)
 * ────────────────────────────────────────── */
export function Top10Strip({ universes }: { universes: EnrichedUniverse[] }) {
  const sorted = useMemo(() => {
    const isPinned = (u: EnrichedUniverse) => u.name?.trim().toLowerCase() === 'space fleet';
    const score = (u: EnrichedUniverse) =>
      (u.nodeCount || 0) * 100 + (u.tokenData ? 50 : 0) + (u.swapVolume || 0) / 1e18;

    const pinned = universes.filter(isPinned);
    const rest = universes.filter((u) => !isPinned(u)).sort((a, b) => score(b) - score(a));

    return [...pinned, ...rest].slice(0, 10).map((u, i) => ({ ...u, _rank: i }));
  }, [universes]);

  if (sorted.length === 0) return null;

  return (
    <section className="pt-20 pb-6">
      <SectionHeader icon={Flame} title="Top 10 Universes" subtitle="Most active this week" />
      <ScrollRow>
        {sorted.map((u) => (
          <div
            key={u.id}
            className="flex-shrink-0 relative flex items-end pt-4 pl-[60px] md:pl-[75px]"
          >
            {/* Large rank number — absolutely positioned so digit width doesn't shift the card */}
            <span
              className="absolute left-0 bottom-0 text-[100px] md:text-[120px] font-black leading-[0.85] select-none pointer-events-none whitespace-nowrap"
              style={{
                WebkitTextStroke: '2px rgba(255,255,255,0.3)',
                color: 'transparent',
              }}
            >
              {u._rank + 1}
            </span>
            <UniverseCard universe={u} />
          </div>
        ))}
      </ScrollRow>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Token-Powered Universes Row
 * ────────────────────────────────────────── */
export function TokenPoweredRow({ universes }: { universes: EnrichedUniverse[] }) {
  const withTokens = universes.filter((u) => u.tokenData);
  if (withTokens.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader
        icon={Zap}
        title="Token-Powered"
        subtitle="Universes with tradable governance tokens"
      />
      <ScrollRow>
        {withTokens.map((u) => (
          <UniverseCard key={u.id} universe={u} />
        ))}
      </ScrollRow>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Trending Now — wide landscape cards
 * ────────────────────────────────────────── */
export function TrendingRow({ universes }: { universes: EnrichedUniverse[] }) {
  const trending = useMemo(() => {
    return [...universes]
      .filter((u) => u.swapVolume > 0 || u.nodeCount > 0)
      .sort((a, b) => {
        const aAct = (a.swapVolume || 0) + (a.nodeCount || 0) * 1e18;
        const bAct = (b.swapVolume || 0) + (b.nodeCount || 0) * 1e18;
        return bAct - aAct;
      })
      .slice(0, 8);
  }, [universes]);

  if (trending.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader icon={TrendingUp} title="Trending Now" subtitle="Buzzing with activity" />
      <ScrollRow>
        {trending.map((u) => (
          <WideCard key={u.id} universe={u} />
        ))}
      </ScrollRow>
    </section>
  );
}

/* ──────────────────────────────────────────
 * New Arrivals Row
 * ────────────────────────────────────────── */
export function NewArrivalsRow({ universes }: { universes: EnrichedUniverse[] }) {
  const newest = universes.slice(0, 10); // already sorted by createdAt desc
  if (newest.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader
        icon={Sparkles}
        title="New Arrivals"
        subtitle="Fresh universes just launched"
      />
      <ScrollRow>
        {newest.map((u) => (
          <UniverseCard key={u.id} universe={u} />
        ))}
      </ScrollRow>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Most Episodes Row
 * ────────────────────────────────────────── */
export function MostEpisodesRow({ universes }: { universes: EnrichedUniverse[] }) {
  // Rank by real canon-episode count so multi-clip episodes count once each.
  // Falls back gracefully to nodeCount if the server query is unavailable.
  const { data: topData } = useQuery<Array<{ universeId: string; count: number }>>({
    queryKey: ['episodes', 'top-universes', 15],
    queryFn: () =>
      trpcClient.episodes.topUniverses.query({ limit: 15 }) as Promise<
        Array<{ universeId: string; count: number }>
      >,
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  });

  const byEpisodes = useMemo(() => {
    if (topData && topData.length > 0) {
      const uniMap = new Map<string, EnrichedUniverse>();
      universes.forEach((u) => uniMap.set(u.id.toLowerCase(), u));
      const ordered = topData
        .map((t) => uniMap.get(t.universeId.toLowerCase()))
        .filter((u): u is EnrichedUniverse => !!u);
      if (ordered.length > 0) return ordered.slice(0, 10);
    }
    // Fallback: nodeCount-based rank when no canon episodes exist yet.
    return [...universes]
      .filter((u) => u.nodeCount > 0)
      .sort((a, b) => (b.nodeCount || 0) - (a.nodeCount || 0))
      .slice(0, 10);
  }, [universes, topData]);

  if (byEpisodes.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader icon={Tv} title="Binge-Worthy" subtitle="Universes with the most episodes" />
      <ScrollRow>
        {byEpisodes.map((u) => (
          <UniverseCard key={u.id} universe={u} />
        ))}
      </ScrollRow>
    </section>
  );
}

/* ──────────────────────────────────────────
 * All Universes — every universe, newest first
 * ────────────────────────────────────────── */
export function AllUniversesRow({ universes }: { universes: EnrichedUniverse[] }) {
  const sorted = useMemo(
    () => [...universes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [universes]
  );

  if (sorted.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader
        icon={BookOpen}
        title="All Universes"
        subtitle={`Browse every universe (${sorted.length})`}
      />
      <ScrollRow>
        {sorted.map((u) => (
          <UniverseCard key={u.id} universe={u} />
        ))}
      </ScrollRow>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Community Creations — published off-chain content
 * ────────────────────────────────────────── */
export function CommunityCreations() {
  const { data } = useQuery({
    queryKey: ['content', 'feed', 'landing'],
    queryFn: () => trpcClient.content.feed.query({ limit: 20 }),
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  });

  const items = data?.items;
  if (!items?.length) return null;

  return (
    <section className="py-6">
      <SectionHeader
        icon={Sparkles}
        title="Community Creations"
        subtitle="Published by creators"
        action={
          <Link to="/discover">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-white"
            >
              See All
            </Button>
          </Link>
        }
      />
      <ScrollRow>
        {items.map((item: any) => (
          <ContentCard key={item.id} item={item} />
        ))}
      </ScrollRow>
    </section>
  );
}

export function ContentCard({ item }: { item: any }) {
  const isVideo = item.mediaType === 'ai-video' || item.mediaType === 'video';

  return (
    <Link
      to="/lineage/$assetId"
      params={{ assetId: item.id }}
      className="group flex-shrink-0 w-[180px] md:w-[200px]"
    >
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-muted mb-2 ring-1 ring-white/5 group-hover:ring-primary/60 transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-xl group-hover:shadow-primary/20">
        {item.thumbnailUrl || item.mediaUrl ? (
          isVideo && item.mediaUrl ? (
            <video
              src={`${resolveIpfsUrl(item.mediaUrl)}#t=0.1`}
              poster={resolveIpfsUrl(item.thumbnailUrl) || undefined}
              className="w-full h-full object-cover"
              muted
              loop
              playsInline
              preload="metadata"
              onMouseEnter={(e) => {
                const p = e.currentTarget.play();
                if (p) p.catch(() => {});
              }}
              onMouseLeave={(e) => {
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
              }}
            />
          ) : (
            <img
              src={resolveIpfsUrl(item.thumbnailUrl || item.mediaUrl)}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          )
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-amber-900/80 via-stone-900 to-stone-950" />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

        {/* Hover play for videos */}
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
            <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
              <Play className="h-5 w-5 text-white fill-white ml-0.5" />
            </div>
          </div>
        )}

        {/* Bottom badges */}
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <div className="flex gap-1.5 mb-1 flex-wrap">
            <span className="text-[10px] font-semibold bg-primary/90 text-white px-1.5 py-0.5 rounded capitalize">
              {item.mediaType?.replace('-', ' ') || 'Content'}
            </span>
            {item.classification === 'original' && (
              <span className="text-[10px] font-semibold bg-green-500/90 text-white px-1.5 py-0.5 rounded">
                Original
              </span>
            )}
            {(item.views ?? 0) > 0 && (
              <span className="text-[10px] font-semibold bg-white/20 text-white px-1.5 py-0.5 rounded">
                <Eye className="inline h-2.5 w-2.5 mr-0.5" />
                {item.views}
              </span>
            )}
          </div>
        </div>
      </div>

      <h3 className="font-semibold text-sm text-white truncate group-hover:text-primary transition-colors px-0.5">
        {item.title}
      </h3>
      <p className="text-xs text-muted-foreground truncate px-0.5">
        {item.description || 'Community creation'}
      </p>
    </Link>
  );
}

/* ──────────────────────────────────────────
 * CTA Banner
 * ────────────────────────────────────────── */
export function CreateBanner() {
  const navigate = useNavigate();

  return (
    <section className="px-4 md:px-12 py-12">
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-primary/20 via-purple-500/20 to-pink-500/20 border border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(var(--primary),0.15),transparent_70%)]" />
        <div className="relative px-6 md:px-8 py-10 md:py-16 flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
          <div>
            <h2 className="text-2xl md:text-3xl lg:text-4xl font-black text-white mb-2">
              Start Your Universe
            </h2>
            <p className="text-white/60 text-base md:text-lg max-w-md">
              Create AI-powered narrative worlds. Launch tokens. Build community.
            </p>
          </div>
          <Button
            size="lg"
            className="rounded-full px-8 text-base font-bold"
            onClick={() => navigate({ to: '/cinematicUniverseCreate' })}
          >
            <Plus className="h-5 w-5 mr-2" />
            Create Universe
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Search Overlay
 * ────────────────────────────────────────── */
export function SearchOverlay({
  open,
  onClose,
  universes,
}: {
  open: boolean;
  onClose: () => void;
  universes: EnrichedUniverse[];
}) {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    if (!query) return [];
    const q = query.toLowerCase();
    return universes.filter((u: EnrichedUniverse) => {
      const name = u.name?.toLowerCase() || '';
      const tokenName = u.tokenData?.name?.toLowerCase() || '';
      const tokenSymbol = u.tokenData?.symbol?.toLowerCase() || '';
      const description = u.description?.toLowerCase() || '';
      const address = u.id?.toLowerCase() || '';
      return (
        name.includes(q) ||
        tokenName.includes(q) ||
        tokenSymbol.includes(q) ||
        description.includes(q) ||
        address.includes(q)
      );
    });
  }, [universes, query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 top-0 z-[101] flex justify-center pt-20 px-4">
        <div className="w-full max-w-2xl bg-background/95 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
            <Search className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            <Input
              type="text"
              placeholder="Search universes, tokens, creators..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              className="flex-1 bg-transparent border-0 focus-visible:ring-0 text-base placeholder:text-muted-foreground/50"
            />
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {query ? (
              filtered.length > 0 ? (
                <div className="p-2">
                  {filtered.slice(0, 8).map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        navigate({ to: '/universe/$id/watch', params: { id: u.id } });
                        onClose();
                      }}
                      className="w-full p-3 rounded-xl hover:bg-white/5 transition-colors text-left flex items-center gap-3"
                    >
                      <div className="w-10 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br from-indigo-600 to-purple-600">
                        {(u.portraitImageURL || u.imageURL || u.tokenData?.imageURL) && (
                          <img
                            src={resolveIpfsUrl(
                              u.portraitImageURL || u.imageURL || u.tokenData?.imageURL
                            )}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-white truncate">
                          {u.name || u.tokenData?.name || `Universe ${u.id?.slice(0, 8) ?? ''}`}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {u.description || u.tokenData?.metadata || 'No description'}
                        </div>
                      </div>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {u.nodeCount > 0 && (
                          <span className="text-[10px] bg-white/10 text-white/70 px-1.5 py-0.5 rounded">
                            {u.nodeCount} EP
                          </span>
                        )}
                        {u.tokenData && (
                          <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">
                            ${u.tokenData.symbol}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center text-muted-foreground">
                  No universes found for "{query}"
                </div>
              )
            ) : (
              <div className="p-4">
                <p className="text-xs text-muted-foreground px-2 mb-3 flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5" />
                  Trending
                </p>
                {universes
                  .filter((u) => u.tokenData || u.nodeCount > 0)
                  .slice(0, 5)
                  .map((u) => (
                    <button
                      key={u.id}
                      onClick={() => {
                        navigate({ to: '/universe/$id/watch', params: { id: u.id } });
                        onClose();
                      }}
                      className="w-full p-2.5 rounded-lg hover:bg-white/5 transition-colors text-left flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br from-indigo-600 to-purple-600">
                        {(u.imageURL || u.tokenData?.imageURL) && (
                          <img
                            src={resolveIpfsUrl(u.imageURL || u.tokenData?.imageURL)}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <span className="text-sm font-medium text-white truncate">
                        {u.name || u.tokenData?.name || `Universe ${u.id?.slice(0, 8) ?? ''}`}
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/* ──────────────────────────────────────────
 * Main Home Component
 * ────────────────────────────────────────── */
