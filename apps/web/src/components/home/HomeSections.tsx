import { tokenDescription } from '@/lib/token-metadata';
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
import { HomeEpisodeVideo } from '@/components/home/HomeEpisodeVideo';
import { SmartImage } from '@/components/SmartImage';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';

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
  Box,
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
import type { FirestoreUniverse } from '@/types/firestore';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

/* ──────────────────────────────────────────
 * Utility: horizontal scroll row with arrows
 * ────────────────────────────────────────── */
function ScrollRow({
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
          aria-label="Scroll left"
          className="absolute left-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-r from-background via-background/80 to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronLeft className="h-8 w-8 text-foreground drop-shadow-lg" />
        </button>
      )}

      <div
        ref={ref}
        className={`flex gap-3 overflow-x-auto scrollbar-hide scroll-smooth snap-x snap-proximity scroll-px-4 md:scroll-px-12 px-4 md:px-12 pb-2 ${className}`}
      >
        {children}
      </div>

      {/* Right arrow */}
      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          aria-label="Scroll right"
          className="absolute right-0 top-0 bottom-0 z-10 w-12 bg-gradient-to-l from-background via-background/80 to-transparent flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity"
        >
          <ChevronRight className="h-8 w-8 text-foreground drop-shadow-lg" />
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
    <div className="flex items-end justify-between gap-4 px-4 md:px-12 mb-4 md:mb-5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/20">
          <Icon className="h-4 w-4 text-primary" />
        </span>
        <div className="min-w-0">
          <h2 className="font-lore text-xl md:text-2xl font-semibold tracking-tight text-foreground truncate">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ──────────────────────────────────────────
 * Universe Card — tall portrait (Webtoons feel)
 * ────────────────────────────────────────── */
export function UniverseCard({
  universe,
  className = 'w-[160px] sm:w-[180px] md:w-[200px]',
}: {
  universe: EnrichedUniverse;
  /** Width classes — rows use fixed poster widths, the browse grid passes `w-full`. */
  className?: string;
}) {
  return (
    <Link
      to="/universe/$id/watch"
      params={{ id: universe.id }}
      className={`group block flex-shrink-0 snap-start rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${className}`}
    >
      {/* Tall poster image — prefer dedicated portrait crop */}
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-muted mb-2 ring-1 ring-white/5 group-hover:ring-primary/60 transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-xl group-hover:shadow-primary/20">
        {universe.portraitImageURL || universe.imageURL || universe.tokenData?.imageURL ? (
          <SmartImage
            src={universe.portraitImageURL || universe.imageURL || universe.tokenData?.imageURL}
            alt=""
            sizes="200px"
            className="w-full h-full"
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
      </div>

      {/* Title below card */}
      <h3 className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors px-0.5">
        {universe.name || universe.tokenData?.name || `Universe ${universe.id.slice(0, 8)}`}
      </h3>
      <p className="text-xs text-muted-foreground truncate px-0.5">
        {universe.description ||
          tokenDescription(universe.tokenData?.metadata) ||
          'Explore this universe'}
      </p>
    </Link>
  );
}

/* ──────────────────────────────────────────
 * Wide landscape card for featured row
 * ────────────────────────────────────────── */
function WideCard({ universe }: { universe: EnrichedUniverse }) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate({ to: '/universe/$id/watch', params: { id: universe.id } })}
      className="group flex-shrink-0 w-[320px] md:w-[400px] cursor-pointer"
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-muted ring-1 ring-white/5 group-hover:ring-primary/60 transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-xl group-hover:shadow-primary/20">
        {universe.imageURL || universe.tokenData?.imageURL ? (
          <SmartImage
            src={universe.imageURL || universe.tokenData?.imageURL}
            alt=""
            sizes="(max-width: 768px) 50vw, 320px"
            className="w-full h-full"
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
            {universe.description || tokenDescription(universe.tokenData?.metadata) || ''}
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
 * Hero skeleton shown during initial load
 * ────────────────────────────────────────── */
export function HeroSkeleton() {
  return (
    <div className="relative h-[72svh] min-h-[480px] md:h-[min(80svh,780px)] md:min-h-[560px] bg-gradient-to-b from-primary/5 via-background to-background flex items-end">
      <div className="w-full px-4 md:px-12 pb-10 md:pb-14 max-w-3xl space-y-4 animate-pulse">
        <div className="h-3 w-32 rounded bg-foreground/10" />
        <div className="h-14 sm:h-20 w-3/4 max-w-[28rem] rounded bg-foreground/10" />
        <div className="h-4 w-full max-w-96 rounded bg-foreground/10" />
        <div className="h-4 w-2/3 max-w-72 rounded bg-foreground/10" />
        <div className="flex gap-3 pt-2">
          <div className="h-12 w-36 rounded-full bg-foreground/10" />
          <div className="h-12 w-32 rounded-full bg-foreground/10" />
        </div>
      </div>
    </div>
  );
}

/** How long each featured universe holds the billboard. */
const HERO_SLIDE_MS = 8000;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/* ──────────────────────────────────────────
 * Hero Billboard — full-bleed cinematic slideshow
 *
 * The active slide's progress bar is the timer: its `animationend` advances
 * to the next universe, so hover/focus pauses (animation-play-state) stop the
 * bar and the slideshow together and resume exactly where they left off.
 * ────────────────────────────────────────── */
export function HeroBillboard({
  universes,
  featuredUniverseIds,
}: {
  universes: EnrichedUniverse[];
  /** Admin-curated universe addresses, in order — see `admin/ops` "Featured universes". */
  featuredUniverseIds?: string[];
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const { mintingEnabled } = useFeatureFlags();

  const featured = useMemo(() => {
    const eligible = universes.filter((u) => u.tokenData || u.nodeCount > 0);

    // Admin curation takes priority: pin the picked universes, in order,
    // then fill remaining slots from the automatic pool.
    if (featuredUniverseIds && featuredUniverseIds.length > 0) {
      const byId = new Map(universes.map((u) => [u.id?.toLowerCase(), u]));
      const pinned = featuredUniverseIds
        .map((id) => byId.get(id.toLowerCase()))
        .filter((u): u is EnrichedUniverse => !!u);
      if (pinned.length > 0) {
        const pinnedIds = new Set(pinned.map((u) => u.id.toLowerCase()));
        const rest = (eligible.length > 0 ? eligible : universes).filter(
          (u) => !pinnedIds.has(u.id.toLowerCase())
        );
        return [...pinned, ...rest].slice(0, 5);
      }
    }

    // No admin curation (or none of the pinned universes still exist) —
    // fall back to the automatic heuristic.
    const FEATURED_FIRST = 'space fleet';
    const pool = eligible.length > 0 ? eligible : universes;
    const sorted = [...pool].sort((a, b) => {
      const aHit = a.name?.toLowerCase().trim() === FEATURED_FIRST ? -1 : 0;
      const bHit = b.name?.toLowerCase().trim() === FEATURED_FIRST ? -1 : 0;
      return aHit - bHit;
    });
    return sorted.slice(0, 5);
  }, [universes, featuredUniverseIds]);

  const autoplay = featured.length > 1 && !reducedMotion;
  const advance = () => setCurrentIndex((i) => (i + 1) % featured.length);

  if (featured.length === 0) {
    return (
      <div className="relative h-[52svh] min-h-[360px] max-h-[560px] flex items-center justify-center overflow-hidden bg-gradient-to-b from-primary/15 via-background to-background">
        <div className="text-center px-4">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary mb-4">
            LOAR
          </p>
          <h1 className="font-lore text-4xl sm:text-5xl md:text-7xl font-semibold text-foreground mb-4 tracking-tight text-balance">
            Your universe awaits
          </h1>
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground mb-8 max-w-lg mx-auto">
            Imagine, generate and own story universes with AI.
          </p>
          <Button size="lg" className="rounded-full px-8 text-base" asChild>
            <Link to={mintingEnabled ? '/cinematicUniverseCreate' : '/create'}>
              <Plus className="h-5 w-5 mr-2" />
              {mintingEnabled ? 'Create your first universe' : 'Start creating'}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  // `featured` can shrink under us (data refresh) — never index past the end.
  const activeIndex = currentIndex % featured.length;
  const current = featured[activeIndex];
  const title = current.name || current.tokenData?.name || 'Untitled universe';
  const description = current.description || tokenDescription(current.tokenData?.metadata);
  const symbol = current.tokenData?.symbol;

  const progressStyle = (i: number): React.CSSProperties =>
    i !== activeIndex
      ? { transform: 'scaleX(0)' }
      : autoplay
        ? {
            animation: `hero-progress ${HERO_SLIDE_MS}ms linear forwards`,
            animationPlayState: paused ? 'paused' : 'running',
          }
        : { transform: 'scaleX(1)' };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured universes"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      className="relative isolate h-[72svh] min-h-[480px] md:h-[min(80svh,780px)] md:min-h-[560px] overflow-hidden bg-black"
    >
      {/* Backdrops — crossfade, Ken Burns on the active one */}
      {featured.map((u, i) => (
        <div
          key={u.id}
          aria-hidden
          className="absolute inset-0 transition-opacity duration-1000"
          style={{ opacity: i === activeIndex ? 1 : 0 }}
        >
          {u.imageURL || u.tokenData?.imageURL ? (
            <SmartImage
              src={u.imageURL || u.tokenData?.imageURL}
              alt=""
              sizes="100vw"
              priority={i === activeIndex}
              className="w-full h-full"
              style={{
                transform: 'scale(1.05)',
                animation:
                  i === activeIndex && !reducedMotion
                    ? 'kenburns 14s ease-in-out infinite alternate'
                    : 'none',
              }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-amber-950 via-stone-950 to-black" />
          )}
        </div>
      ))}

      {/* Scrims — always dark so the white type reads in either theme */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/35 to-transparent" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_100%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent_60%)]" />
      {/* Bottom fade into the page — decorative, painted under the content */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex flex-col justify-end px-4 md:px-12 pb-8 md:pb-12">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6 lg:gap-10">
          <div
            key={current.id}
            className="max-w-2xl motion-safe:animate-[hero-copy-in_700ms_cubic-bezier(0.16,1,0.3,1)_both]"
          >
            <div className="flex items-center gap-2.5 mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">
              <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_12px_var(--primary)]" />
              <span className="text-primary">Featured universe</span>
              {current.nodeCount > 0 && (
                <>
                  <span className="text-white/30">/</span>
                  <span>{current.nodeCount} episodes</span>
                </>
              )}
              {current.holderCount > 0 && (
                <>
                  <span className="text-white/30">/</span>
                  <span>{current.holderCount} holders</span>
                </>
              )}
            </div>

            <h1 className="font-lore text-[2.6rem] sm:text-6xl lg:text-7xl font-semibold text-white leading-[0.98] tracking-tight text-balance mb-4 drop-shadow-[0_2px_24px_rgba(0,0,0,0.5)]">
              {title}
            </h1>

            {description && (
              <p className="text-[15px] sm:text-base md:text-lg text-white/75 mb-6 max-w-xl line-clamp-2 md:line-clamp-3 leading-relaxed">
                {description}
              </p>
            )}

            <div className="flex items-center gap-2.5 sm:gap-3 flex-wrap">
              <Button
                size="lg"
                className="h-12 rounded-full px-6 sm:px-7 text-[15px] font-semibold shadow-lg shadow-primary/30"
                asChild
              >
                <Link to="/universe/$id/watch" params={{ id: current.id }}>
                  <Play className="h-4 w-4 mr-2 fill-current" />
                  Watch now
                </Link>
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="h-12 rounded-full px-5 sm:px-6 text-[15px] font-medium text-white bg-white/10 hover:bg-white/20 hover:text-white backdrop-blur-md ring-1 ring-white/15"
                asChild
              >
                <Link to="/wiki" search={{ universe: current.id }}>
                  <BookOpen className="h-4 w-4 mr-2" />
                  Read the wiki
                </Link>
              </Button>
              {symbol && (
                <span className="hidden sm:inline-flex h-12 items-center gap-2 rounded-full px-4 bg-black/30 backdrop-blur-md ring-1 ring-white/10 text-sm">
                  <Zap className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-white">${symbol}</span>
                  {current.swapVolume > 0 && (
                    <span className="text-white/50">
                      Vol {(current.swapVolume / 1e18).toFixed(2)}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Slide picker — thumbnails on desktop, story-style bars on mobile */}
          {featured.length > 1 && (
            <>
              <div
                className="hidden lg:flex gap-3 shrink-0"
                role="tablist"
                aria-label="Choose a featured universe"
              >
                {featured.map((u, i) => (
                  <button
                    key={u.id}
                    role="tab"
                    aria-selected={i === activeIndex}
                    aria-label={u.name || `Featured universe ${i + 1}`}
                    onClick={() => setCurrentIndex(i)}
                    className={`group/thumb w-[132px] xl:w-[156px] text-left transition-opacity focus-visible:outline-none ${
                      i === activeIndex ? 'opacity-100' : 'opacity-55 hover:opacity-90'
                    }`}
                  >
                    <div
                      className={`relative aspect-video overflow-hidden rounded-lg bg-white/5 ring-1 transition-all group-focus-visible/thumb:ring-2 group-focus-visible/thumb:ring-primary ${
                        i === activeIndex ? 'ring-white/60' : 'ring-white/10'
                      }`}
                    >
                      {(u.imageURL || u.tokenData?.imageURL) && (
                        <SmartImage
                          src={u.imageURL || u.tokenData?.imageURL}
                          alt=""
                          sizes="160px"
                          className="w-full h-full"
                        />
                      )}
                    </div>
                    <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-white/15">
                      <div
                        className="h-full w-full origin-left bg-white"
                        style={progressStyle(i)}
                        onAnimationEnd={i === activeIndex ? advance : undefined}
                      />
                    </div>
                    <p className="mt-1.5 truncate text-xs font-medium text-white/85">
                      {u.name || u.tokenData?.name}
                    </p>
                  </button>
                ))}
              </div>

              <div
                className="flex lg:hidden gap-1.5"
                role="tablist"
                aria-label="Choose a featured universe"
              >
                {featured.map((u, i) => (
                  <button
                    key={u.id}
                    role="tab"
                    aria-selected={i === activeIndex}
                    aria-label={u.name || `Featured universe ${i + 1}`}
                    onClick={() => setCurrentIndex(i)}
                    className="flex-1 py-3 -my-3"
                  >
                    <span className="block h-[3px] w-full overflow-hidden rounded-full bg-white/20">
                      <span
                        className="block h-full w-full origin-left bg-white"
                        style={progressStyle(i)}
                        // The other picker is display:none at this breakpoint,
                        // so its animation never runs — no double advance.
                        onAnimationEnd={i === activeIndex ? advance : undefined}
                      />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Live Activity Ticker
 * ────────────────────────────────────────── */
export function ActivityTicker({
  featuredUniverseIds,
}: {
  /** Admin-curated universe addresses, in order — see `admin/ops` "Featured universes". */
  featuredUniverseIds?: string[];
} = {}) {
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

  // The app's own universe records. Ticker entries link to /universe/$id/watch,
  // which resolves ids against these — the indexer also holds test universes
  // and stale addresses from older contract deployments that 404 there.
  // Shares the homepage's cache entry.
  const { data: appUniverses } = useQuery({
    queryKey: ['universes', 'all'],
    queryFn: () => trpcClient.universes.getAll.query().then((r) => r.data as FirestoreUniverse[]),
    staleTime: 30_000,
  });

  const activities = useMemo(() => {
    if (!nodesData || !nodeContentData || !universesData || !appUniverses) {
      return [];
    }

    // Only list universes the app can open, under the app's name for them.
    const appUniverseById = new Map<string, FirestoreUniverse>();
    for (const u of appUniverses) {
      const access = (u as { accessModel?: string }).accessModel;
      if (access === 'private' || access === 'token_gate') continue;
      appUniverseById.set(u.id.toLowerCase(), u);
    }

    const contentMap = new Map<string, NodeContent>();
    nodeContentData.forEach((c) => contentMap.set(c.id, c));

    // Rank all universes (pin admin-curated featured universes first, in
    // order — falling back to the "space fleet" heuristic when none are
    // configured — then score the rest by nodeCount + token presence) and
    // feed the entire ranked list to the marquee. The ticker needs as much
    // content as possible so a single "copy" reliably spans the viewport —
    // otherwise the -50% loop shows a gap.
    const pinnedOrder = new Map((featuredUniverseIds ?? []).map((id, i) => [id.toLowerCase(), i]));
    const isPinned = (u: Universe) =>
      pinnedOrder.size > 0
        ? pinnedOrder.has(u.id.toLowerCase())
        : u.name?.trim().toLowerCase() === 'space fleet';
    const score = (u: Universe) =>
      (u.nodeCount || 0) * 100 +
      (u.tokenAddress && u.tokenAddress !== '0x0000000000000000000000000000000000000000' ? 50 : 0);
    const pinned = universesData.filter(isPinned);
    if (pinnedOrder.size > 0) {
      pinned.sort(
        (a, b) =>
          (pinnedOrder.get(a.id.toLowerCase()) ?? 0) - (pinnedOrder.get(b.id.toLowerCase()) ?? 0)
      );
    }
    const rest = universesData.filter((u) => !isPinned(u)).sort((a, b) => score(b) - score(a));
    const ranked = [...pinned, ...rest].filter((u) => appUniverseById.has(u.id.toLowerCase()));

    // Latest node per universe — drives the action label so each entry reads
    // with its most recent activity instead of a generic "trending".
    const latestNodeByUniverse = new Map<string, Node>();
    for (const n of nodesData) {
      const key = n.universeAddress.toLowerCase();
      const existing = latestNodeByUniverse.get(key);
      if (!existing || n.createdAt > existing.createdAt) {
        latestNodeByUniverse.set(key, n);
      }
    }

    const fromIndexer = ranked.map((u) => {
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
        universeName: appUniverseById.get(key)?.name || u.name || `Universe ${u.id.slice(0, 8)}`,
        action,
        universeId: appUniverseById.get(key)!.id,
        createdAt: recentNode?.createdAt || u.createdAt,
      };
    });

    // App universes the indexer doesn't know (off-chain, Solana, or indexed
    // under an older address) still belong in the ticker; featured ones first.
    const listed = new Set(fromIndexer.map((a) => a.universeId.toLowerCase()));
    const unlisted = [...appUniverseById.values()]
      .filter((u) => !listed.has(u.id.toLowerCase()))
      .sort(
        (a, b) =>
          (pinnedOrder.get(a.id.toLowerCase()) ?? Infinity) -
          (pinnedOrder.get(b.id.toLowerCase()) ?? Infinity)
      )
      .map((u) => ({
        id: u.id,
        universeName: u.name || `Universe ${u.id.slice(0, 8)}`,
        action: 'now streaming',
        universeId: u.id,
        createdAt: '',
      }));

    return [...fromIndexer, ...unlisted];
  }, [nodesData, nodeContentData, universesData, appUniverses, featuredUniverseIds]);

  // Marquee math: the `ticker` keyframe translates from 0 to -50%, so the
  // rendered list must be exactly 2 identical halves — when the first half
  // slides off the left, the second half is already in view. Critically, a
  // single half must be at least as wide as the viewport, otherwise the
  // right edge goes blank during the loop ("runs out"). We over-pad one
  // half to a minimum item count so even with few universes the marquee
  // stays continuous on wide screens.
  const marqueeItems = useMemo(() => {
    if (activities.length === 0) return [];
    const MIN_ITEMS_PER_HALF = 24;
    const repeats = Math.max(1, Math.ceil(MIN_ITEMS_PER_HALF / activities.length));
    const oneHalf = Array.from({ length: repeats }, () => activities).flat();
    return [...oneHalf, ...oneHalf];
  }, [activities]);

  if (activities.length === 0) return null;

  return (
    <div className="border-b border-white/5 bg-white/[0.02] overflow-hidden flex">
      <div className="flex gap-6 px-4 py-2.5 whitespace-nowrap w-max animate-[ticker_60s_linear_infinite] hover:[animation-play-state:paused]">
        {marqueeItems.map((a, i) => (
          <Link
            key={`${a.id}-${i}`}
            to="/universe/$id/watch"
            params={{ id: a.universeId }}
            className="flex items-center gap-2 text-sm flex-shrink-0 hover:text-primary transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="font-medium text-foreground/80">{a.universeName}</span>
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
                    <HomeEpisodeVideo videoUrl={ep.videoUrl} thumbnailUrl={ep.thumbnailUrl} />
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
                  <SmartImage
                    src={ep.universe.imageURL}
                    alt=""
                    className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
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
 * Top 10 — ranked posters with outlined serif numerals (Netflix Top 10)
 * ────────────────────────────────────────── */
export function Top10Strip({ universes }: { universes: EnrichedUniverse[] }) {
  const sorted = useMemo(() => {
    const isPinned = (u: EnrichedUniverse) => u.name?.trim().toLowerCase() === 'space fleet';
    const score = (u: EnrichedUniverse) =>
      (u.nodeCount || 0) * 100 + (u.tokenData ? 50 : 0) + (u.swapVolume || 0) / 1e18;

    const pinned = universes.filter(isPinned);
    const rest = universes.filter((u) => !isPinned(u)).sort((a, b) => score(b) - score(a));

    return [...pinned, ...rest].slice(0, 10);
  }, [universes]);

  if (sorted.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader icon={Flame} title="Top 10 Universes" subtitle="Most active this week" />
      <ScrollRow>
        {sorted.map((u, i) => (
          <div
            key={u.id}
            className="relative flex shrink-0 snap-start items-end pl-[52px] md:pl-[68px]"
          >
            {/* Rank — absolutely positioned so digit width doesn't shift the card */}
            <span
              aria-hidden
              className="absolute left-0 bottom-9 font-lore text-[96px] md:text-[128px] font-semibold leading-[0.8] tracking-tighter select-none pointer-events-none whitespace-nowrap text-transparent"
              style={{
                WebkitTextStroke: '2px color-mix(in oklch, var(--foreground) 38%, transparent)',
              }}
            >
              {i + 1}
            </span>
            <UniverseCard universe={u} className="relative w-[140px] sm:w-[160px] md:w-[180px]" />
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
 * Browse grid — every universe, newest first
 * ────────────────────────────────────────── */
export function AllUniversesRow({ universes }: { universes: EnrichedUniverse[] }) {
  const sorted = useMemo(
    () => [...universes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [universes]
  );

  if (sorted.length === 0) return null;

  return (
    <section id="browse" className="py-8 scroll-mt-20">
      <SectionHeader
        icon={BookOpen}
        title="Browse every universe"
        subtitle={`${sorted.length} ${sorted.length === 1 ? 'world' : 'worlds'} and counting`}
      />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-x-3 gap-y-6 px-4 md:px-12">
        {sorted.map((u) => (
          <UniverseCard key={u.id} universe={u} className="w-full" />
        ))}
      </div>
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
  // 3D content has no image-decodable `mediaUrl` (it's a .glb/.fbx binary) —
  // only ever render `thumbnailUrl` (Meshy's rendered preview) as an <img>.
  // See components/gallery/ContentCard.tsx's `is3D` branch for the pattern
  // this mirrors; falling back to `mediaUrl` here fed a GLB URL straight into
  // SmartImage, which always failed to load and showed "Couldn't load image"
  // for every 3D item that had no thumbnail.
  const is3D = item.mediaType === '3d';

  return (
    <Link
      to="/lineage/$assetId"
      params={{ assetId: item.id }}
      className="group flex-shrink-0 w-[180px] md:w-[200px]"
    >
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-muted mb-2 ring-1 ring-white/5 group-hover:ring-primary/60 transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-xl group-hover:shadow-primary/20">
        {is3D ? (
          item.thumbnailUrl ? (
            <SmartImage
              src={item.thumbnailUrl}
              alt=""
              sizes="(max-width: 768px) 50vw, 320px"
              className="w-full h-full"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center relative">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/15 to-rose-500/15" />
              <Box className="relative h-10 w-10 text-amber-200/70" />
            </div>
          )
        ) : item.thumbnailUrl || item.mediaUrl ? (
          isVideo && item.mediaUrl ? (
            <HomeEpisodeVideo videoUrl={item.mediaUrl} thumbnailUrl={item.thumbnailUrl} />
          ) : (
            <SmartImage
              src={item.thumbnailUrl || item.mediaUrl}
              alt=""
              sizes="(max-width: 768px) 50vw, 320px"
              className="w-full h-full"
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

      <h3 className="font-semibold text-sm text-foreground truncate group-hover:text-primary transition-colors px-0.5">
        {item.title}
      </h3>
      <p className="text-xs text-muted-foreground truncate px-0.5">
        {item.description || 'Community creation'}
      </p>
    </Link>
  );
}

/* ──────────────────────────────────────────
 * Pitch — what LOAR is, for visitors who aren't signed in
 * ────────────────────────────────────────── */
const PITCH_STEPS = [
  {
    icon: Sparkles,
    title: 'Imagine',
    body: 'Describe a world. LOAR drafts its characters, factions, places and lore into a living canon wiki.',
  },
  {
    icon: Tv,
    title: 'Generate',
    body: 'Turn scenes into video episodes with frontier AI models, and branch the story wherever it wants to go.',
  },
  {
    icon: Users,
    title: 'Own it together',
    body: 'Launch a universe token so fans can back the story and vote on what becomes canon.',
  },
] as const;

export function HomePitch({ universes }: { universes: EnrichedUniverse[] }) {
  const { isAuthenticated, sessionReady } = useWalletAuth();
  const { mintingEnabled } = useFeatureFlags();

  const stats = useMemo(() => {
    const episodes = universes.reduce((n, u) => n + (u.nodeCount || 0), 0);
    const creators = new Set(universes.map((u) => u.creator?.toLowerCase()).filter(Boolean)).size;
    return [
      { label: 'universes', value: universes.length },
      { label: 'episodes', value: episodes },
      // A handful of creators undersells the platform — only brag once it's real.
      { label: 'creators', value: creators >= 5 ? creators : 0 },
    ].filter((s) => s.value > 0);
  }, [universes]);

  // Signed-in users already know the pitch — go straight to the content.
  if (!sessionReady || isAuthenticated) return null;

  return (
    <section className="px-4 md:px-12 py-10 md:py-16">
      <div className="grid gap-8 lg:gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:items-center">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-primary mb-3">
            What is LOAR
          </p>
          <h2 className="font-lore text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground leading-[1.05] text-balance">
            An AI studio for story universes you can own.
          </h2>
          <p className="mt-4 text-base md:text-lg text-muted-foreground max-w-lg leading-relaxed">
            Prompt a world into existence, generate its episodes, keep its canon in one place — and
            let the people who love it have a stake in what happens next.
          </p>

          {stats.length > 0 && (
            <dl className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="sr-only">{s.label}</dt>
                  <dd className="font-lore text-3xl font-semibold text-foreground tabular-nums">
                    {s.value.toLocaleString()}
                    <span className="ml-1.5 font-sans text-sm font-normal text-muted-foreground">
                      {s.label}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" className="h-12 rounded-full px-7 font-semibold" asChild>
              <Link to={mintingEnabled ? '/cinematicUniverseCreate' : '/create'}>
                <Plus className="h-4 w-4 mr-2" />
                Start your universe
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-12 rounded-full px-6" asChild>
              <a href="#browse">Browse universes</a>
            </Button>
          </div>
        </div>

        <ol className="grid gap-3 sm:grid-cols-3">
          {PITCH_STEPS.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-4 sm:flex-col sm:gap-0 rounded-2xl border border-border bg-card/60 p-4 sm:p-5 md:p-6"
            >
              <div className="flex shrink-0 items-start justify-between sm:mb-8 md:mb-10">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/25">
                  <step.icon className="h-5 w-5 text-primary" />
                </span>
                <span className="hidden sm:inline font-lore text-sm text-muted-foreground tabular-nums">
                  0{i + 1}
                </span>
              </div>
              <div>
                <h3 className="font-lore text-lg sm:text-xl font-semibold text-foreground mb-1 sm:mb-2">
                  {step.title}
                </h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Closing CTA — poster collage behind a create prompt
 * ────────────────────────────────────────── */
export function CreateBanner({ universes = [] }: { universes?: EnrichedUniverse[] }) {
  const { mintingEnabled } = useFeatureFlags();

  const posters = useMemo(
    () =>
      universes
        .map((u) => u.portraitImageURL || u.imageURL || u.tokenData?.imageURL)
        .filter((src): src is string => !!src)
        .slice(0, 8),
    [universes]
  );

  return (
    <section className="px-4 md:px-12 py-12">
      <div className="relative isolate overflow-hidden rounded-3xl bg-black ring-1 ring-white/10">
        {/* Tilted poster wall */}
        {posters.length >= 4 && (
          <div
            aria-hidden
            className="absolute -right-24 -top-24 md:-right-10 grid w-[720px] grid-cols-4 gap-3 opacity-60 rotate-[-8deg]"
          >
            {posters.map((src, i) => (
              <div
                key={i}
                className={`aspect-[3/4] overflow-hidden rounded-xl ring-1 ring-white/10 ${i % 2 ? 'translate-y-10' : ''}`}
              >
                <SmartImage src={src} alt="" sizes="180px" className="h-full w-full" />
              </div>
            ))}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/85 to-black/20" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_0%_100%,color-mix(in_oklch,var(--primary)_30%,transparent),transparent_55%)]" />

        <div className="relative px-6 py-14 md:px-12 md:py-20 max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-primary mb-3">
            Start creating
          </p>
          <h2 className="font-lore text-3xl md:text-5xl font-semibold tracking-tight text-white leading-[1.05] text-balance">
            Your universe is one prompt away.
          </h2>
          <p className="mt-4 text-white/65 text-base md:text-lg max-w-md">
            Build an AI-powered narrative world, publish episodes, and grow a community around it.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              size="lg"
              className="h-12 rounded-full px-7 font-semibold shadow-lg shadow-primary/30"
              asChild
            >
              <Link to={mintingEnabled ? '/cinematicUniverseCreate' : '/create'}>
                <Plus className="h-4 w-4 mr-2" />
                {mintingEnabled ? 'Create a universe' : 'Start creating'}
              </Link>
            </Button>
            <Button
              size="lg"
              variant="ghost"
              className="h-12 rounded-full px-6 text-white bg-white/10 hover:bg-white/20 hover:text-white ring-1 ring-white/15"
              asChild
            >
              <Link to="/wiki">
                <BookOpen className="h-4 w-4 mr-2" />
                Explore the wiki
              </Link>
            </Button>
          </div>
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
  const inputRef = useRef<HTMLInputElement>(null);

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

  // Focus the input once the overlay mounts. An explicit ref focus (in a
  // microtask after paint) is more reliable than the `autoFocus` attribute,
  // which silently no-ops if focus is contended during the open transition.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Lock background scroll while the overlay is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
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

  // Render in a portal at document.body so the overlay is never a descendant
  // of homepage content that may become inert / pointer-events-none / a new
  // stacking context (e.g. when another modal or dropdown opens). As an inline
  // child it inherited those states and the input could not receive focus or
  // keystrokes — the "can't type in search" bug.
  return createPortal(
    <>
      {/* NOTE: z-[10000] is intentional. A global rule in index.css —
          `[class*='backdrop'] { z-index: 9998 !important }` — accidentally
          matches Tailwind's `backdrop-blur-*` utilities, forcing the backdrop
          div below to z-9998. The panel must sit above that or it gets covered
          (the "blur shows but can't type" bug). */}
      <div className="fixed inset-0 z-[9990] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-0 top-0 z-[10000] flex justify-center pt-20 px-4">
        <div className="w-full max-w-2xl bg-background/95 rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
            <Search className="h-5 w-5 text-muted-foreground flex-shrink-0" />
            <Input
              ref={inputRef}
              type="text"
              placeholder="Search universes, tokens, creators..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
                          <SmartImage
                            src={u.portraitImageURL || u.imageURL || u.tokenData?.imageURL}
                            alt=""
                            sizes="40px"
                            className="w-full h-full"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-white truncate">
                          {u.name || u.tokenData?.name || `Universe ${u.id?.slice(0, 8) ?? ''}`}
                        </div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {u.description ||
                            tokenDescription(u.tokenData?.metadata) ||
                            'No description'}
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
                          <SmartImage
                            src={u.imageURL || u.tokenData?.imageURL}
                            alt=""
                            sizes="32px"
                            className="w-full h-full"
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
    </>,
    document.body
  );
}

/* ──────────────────────────────────────────
 * Continue Watching — non-completed sessions, deduped per episode.
 * Renders nothing for anon / new users (server returns []).
 * ────────────────────────────────────────── */
export function ContinueWatchingRow() {
  const { isAuthenticated, sessionReady } = useWalletAuth();
  const { data: episodes } = useQuery<FeedEpisode[]>({
    queryKey: ['recommendations', 'continueWatching'],
    queryFn: () =>
      trpcClient.recommendations.continueWatching.query({ limit: 12 }) as Promise<FeedEpisode[]>,
    enabled: sessionReady && isAuthenticated,
    staleTime: 60_000,
    retry: false,
    meta: { silent: true },
  });

  if (!episodes || episodes.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader icon={Play} title="Continue Watching" subtitle="Pick up where you left off" />
      <ScrollRow>
        {episodes.map((ep) => {
          const resume =
            (ep as FeedEpisode & { resumePositionSec?: number }).resumePositionSec ?? 0;
          // We don't have duration here — show generous-but-capped progress.
          const progressPct = Math.min(95, Math.max(5, Math.round((resume / 60) * 10)));
          return (
            <Link
              key={ep.id}
              to="/episode/$id"
              params={{ id: ep.id }}
              className="group flex-shrink-0 w-[260px] md:w-[300px]"
            >
              <div className="relative aspect-video rounded-xl overflow-hidden bg-muted mb-2 ring-1 ring-white/5 group-hover:ring-primary/60 transition-all">
                {ep.videoUrl ? (
                  <HomeEpisodeVideo
                    videoUrl={ep.videoUrl}
                    thumbnailUrl={ep.thumbnailUrl}
                    startTime={Math.max(0, resume - 1)}
                    loop={false}
                    hoverPlay={false}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-amber-900/40 to-rose-900/40">
                    <Play className="h-8 w-8 text-white/60" />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
                  <div className="h-full bg-primary" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 pointer-events-none">
                  <Play className="h-8 w-8 text-white fill-white" />
                </div>
              </div>
              <div className="flex gap-2 items-start px-0.5">
                {ep.universe.imageURL ? (
                  <SmartImage
                    src={ep.universe.imageURL}
                    alt=""
                    className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex-shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                    {ep.title}
                  </h4>
                  <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">
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
 * For You — personalized with cold-start fallback to recent canon.
 * Visible to anon users too (anon = pure fallback path).
 * ────────────────────────────────────────── */
export function ForYouRow() {
  const { data: episodes } = useQuery<FeedEpisode[]>({
    queryKey: ['recommendations', 'forMe'],
    queryFn: () => trpcClient.recommendations.forMe.query({ limit: 15 }) as Promise<FeedEpisode[]>,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { silent: true },
  });

  if (!episodes || episodes.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader
        icon={Sparkles}
        title="For You"
        subtitle="Picked from universes you've watched"
      />
      <ScrollRow>
        {episodes.map((ep) => (
          <Link
            key={ep.id}
            to="/episode/$id"
            params={{ id: ep.id }}
            className="group flex-shrink-0 w-[260px] md:w-[300px]"
          >
            <div className="relative aspect-video rounded-xl overflow-hidden bg-muted mb-2 ring-1 ring-white/5 group-hover:ring-primary/60 transition-all">
              {ep.videoUrl ? (
                <HomeEpisodeVideo videoUrl={ep.videoUrl} thumbnailUrl={ep.thumbnailUrl} />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-violet-900/40 to-pink-900/40">
                  <Sparkles className="h-8 w-8 text-white/60" />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 pointer-events-none">
                <Play className="h-8 w-8 text-white fill-white" />
              </div>
            </div>
            <div className="flex gap-2 items-start px-0.5">
              {ep.universe.imageURL ? (
                <SmartImage
                  src={ep.universe.imageURL}
                  alt=""
                  className="w-8 h-8 rounded-full flex-shrink-0 mt-0.5"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                  {ep.title}
                </h4>
                <p className="text-xs text-muted-foreground line-clamp-1 leading-relaxed">
                  {ep.universe.name || 'Untitled universe'}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </ScrollRow>
    </section>
  );
}

/* ──────────────────────────────────────────
 * Main Home Component
 * ────────────────────────────────────────── */
