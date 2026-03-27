/**
 * Home / Landing Page — Netflix × Webtoons hybrid
 *
 * Full-bleed hero billboard, horizontal scroll content rows,
 * tall portrait cards, genre discovery, dark cinematic vibe.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

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
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import {
  ponderGql,
  type Universe,
  type Token,
  type Node,
  type NodeContent,
  type Swap,
  type TokenHolder,
} from '@/utils/ponder-api';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';

export const Route = createFileRoute('/')({
  component: HomeComponent,
});

/* ──────────────────────────────────────────
 * Curated placeholder universes
 * Shown when indexer has no data yet
 * ────────────────────────────────────────── */
const PLACEHOLDER_UNIVERSES = [
  {
    id: 'placeholder-neon-genesis',
    name: 'Neon Genesis',
    description:
      "In a rain-soaked megacity, rogue AI awakens inside a dead hacker's neural implant. A street medic must decide: destroy it or let it rewrite humanity.",
    imageURL: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&h=600&fit=crop',
    nodeCount: 24,
    tokenData: { symbol: 'NEON', name: 'Neon Genesis Token', imageURL: '', metadata: '' },
    swapVolume: 4.2e18,
    holderCount: 312,
    _genre: 'Cyberpunk',
  },
  {
    id: 'placeholder-wyrdwood',
    name: 'The Wyrdwood Chronicles',
    description:
      'An ancient forest is waking up — and it remembers everything. Follow three bloodlines bound by a pact older than language itself.',
    imageURL: 'https://images.unsplash.com/photo-1518562180175-34a163b1a9a6?w=800&h=600&fit=crop',
    nodeCount: 18,
    tokenData: { symbol: 'WYRD', name: 'Wyrdwood Token', imageURL: '', metadata: '' },
    swapVolume: 1.8e18,
    holderCount: 187,
    _genre: 'Dark Fantasy',
  },
  {
    id: 'placeholder-orbit',
    name: 'Orbit Zero',
    description:
      'The last colony ship has 40 days of oxygen. The captain is hiding something. The AI navigator just locked everyone out of the bridge.',
    imageURL: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=800&h=600&fit=crop',
    nodeCount: 31,
    tokenData: { symbol: 'ORBT', name: 'Orbit Zero Token', imageURL: '', metadata: '' },
    swapVolume: 6.1e18,
    holderCount: 524,
    _genre: 'Sci-Fi Thriller',
  },
  {
    id: 'placeholder-jade-empire',
    name: 'Jade Empire: Shattered Dynasties',
    description:
      "Warring kingdoms. Forbidden martial arts. A peasant girl discovers she's the reincarnation of the empire's most feared warlord.",
    imageURL: 'https://images.unsplash.com/photo-1535930749574-1399327ce78f?w=800&h=600&fit=crop',
    nodeCount: 42,
    tokenData: { symbol: 'JADE', name: 'Jade Empire Token', imageURL: '', metadata: '' },
    swapVolume: 8.3e18,
    holderCount: 891,
    _genre: 'Wuxia',
  },
  {
    id: 'placeholder-bloom',
    name: 'BLOOM',
    description:
      'A solarpunk utopia where flowers are currency, memories are compostable, and the biggest crime is forgetting to dream.',
    imageURL: 'https://images.unsplash.com/photo-1490750967868-88aa4f44baee?w=800&h=600&fit=crop',
    nodeCount: 15,
    tokenData: { symbol: 'BLOOM', name: 'Bloom Token', imageURL: '', metadata: '' },
    swapVolume: 2.5e18,
    holderCount: 203,
    _genre: 'Solarpunk',
  },
  {
    id: 'placeholder-void-divers',
    name: 'Void Divers',
    description:
      "Deep-sea explorers discover a trench that doesn't appear on any map. At the bottom, something is broadcasting coordinates to a star that went dark 10,000 years ago.",
    imageURL: 'https://images.unsplash.com/photo-1551244072-5d12893278ab?w=800&h=600&fit=crop',
    nodeCount: 27,
    tokenData: { symbol: 'VOID', name: 'Void Divers Token', imageURL: '', metadata: '' },
    swapVolume: 3.7e18,
    holderCount: 445,
    _genre: 'Cosmic Horror',
  },
  {
    id: 'placeholder-ferro',
    name: 'Ferro City Blues',
    description:
      'Jazz clubs, flying cars, and a private detective who can taste lies. Noir reimagined in a retro-future where the mob runs the weather.',
    imageURL: 'https://images.unsplash.com/photo-1514539079130-25950c84af65?w=800&h=600&fit=crop',
    nodeCount: 20,
    tokenData: { symbol: 'FERRO', name: 'Ferro Token', imageURL: '', metadata: '' },
    swapVolume: 1.2e18,
    holderCount: 156,
    _genre: 'Neo-Noir',
  },
  {
    id: 'placeholder-mythic',
    name: 'Mythic Protocol',
    description:
      "Gods are real — they're just running out of believers. A mythology professor accidentally becomes the host for a dying trickster god.",
    imageURL: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=800&h=600&fit=crop',
    nodeCount: 36,
    tokenData: { symbol: 'MYTH', name: 'Mythic Token', imageURL: '', metadata: '' },
    swapVolume: 5.5e18,
    holderCount: 678,
    _genre: 'Urban Fantasy',
  },
  {
    id: 'placeholder-signal',
    name: 'The Last Signal',
    description:
      'A radio astronomer receives a message from a civilization that died a million years ago. The message is a warning. The warning is about us.',
    imageURL: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&h=600&fit=crop',
    nodeCount: 12,
    swapVolume: 0,
    holderCount: 89,
    _genre: 'Hard Sci-Fi',
  },
  {
    id: 'placeholder-kindling',
    name: 'Kindling',
    description:
      'After the collapse, a group of teenagers discover that campfire stories can literally reshape reality. But every story demands a sacrifice.',
    imageURL: 'https://images.unsplash.com/photo-1475274047050-1d0c55b7b10c?w=800&h=600&fit=crop',
    nodeCount: 22,
    tokenData: { symbol: 'KNDL', name: 'Kindling Token', imageURL: '', metadata: '' },
    swapVolume: 2.9e18,
    holderCount: 334,
    _genre: 'Post-Apocalyptic',
  },
  {
    id: 'placeholder-atlas',
    name: 'Atlas Unchained',
    description:
      'A world where maps are alive and borders fight back. Cartographers are the most dangerous people alive — and someone just drew a new continent.',
    imageURL: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?w=800&h=600&fit=crop',
    nodeCount: 19,
    tokenData: { symbol: 'ATLS', name: 'Atlas Token', imageURL: '', metadata: '' },
    swapVolume: 1.6e18,
    holderCount: 211,
    _genre: 'Adventure',
  },
  {
    id: 'placeholder-echo',
    name: 'Echo Chamber',
    description:
      'In a society where thoughts are public, one woman discovers she can think in silence. The government calls it a disease. The underground calls it a weapon.',
    imageURL: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&h=600&fit=crop',
    nodeCount: 28,
    tokenData: { symbol: 'ECHO', name: 'Echo Token', imageURL: '', metadata: '' },
    swapVolume: 4.8e18,
    holderCount: 567,
    _genre: 'Dystopian',
  },
];

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
function SectionHeader({
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
    <div className="flex items-end justify-between px-4 md:px-12 mb-4">
      <div className="flex items-center gap-3">
        <Icon className="h-6 w-6 text-primary" />
        <div>
          <h2 className="text-xl md:text-2xl font-bold text-white">{title}</h2>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ──────────────────────────────────────────
 * Universe Card — tall portrait (Webtoons feel)
 * ────────────────────────────────────────── */
function UniverseCard({ universe }: { universe: any }) {
  const navigate = Route.useNavigate();

  return (
    <div
      onClick={() => navigate({ to: `/universe/${universe.id}` })}
      className="group flex-shrink-0 w-[180px] md:w-[200px] cursor-pointer"
    >
      {/* Tall poster image */}
      <div className="relative aspect-[3/4] rounded-xl overflow-hidden bg-muted mb-2 ring-1 ring-white/5 group-hover:ring-primary/60 transition-all duration-300 group-hover:scale-[1.03] group-hover:shadow-xl group-hover:shadow-primary/20">
        {universe.imageURL || universe.tokenData?.imageURL ? (
          <img
            src={universe.imageURL || universe.tokenData?.imageURL}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600" />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />

        {/* Hover play button */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
          <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
            <Play className="h-5 w-5 text-white fill-white ml-0.5" />
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
            {universe.tokenData && (
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
function WideCard({ universe }: { universe: any }) {
  const navigate = Route.useNavigate();

  return (
    <div
      onClick={() => navigate({ to: `/universe/${universe.id}` })}
      className="group flex-shrink-0 w-[320px] md:w-[400px] cursor-pointer"
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-muted ring-1 ring-white/5 group-hover:ring-primary/60 transition-all duration-300 group-hover:scale-[1.02] group-hover:shadow-xl group-hover:shadow-primary/20">
        {universe.imageURL || universe.tokenData?.imageURL ? (
          <img
            src={universe.imageURL || universe.tokenData?.imageURL}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

        {/* Hover play */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
          <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
            <Play className="h-6 w-6 text-white fill-white ml-0.5" />
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
 * Hero Billboard (Netflix-style)
 * ────────────────────────────────────────── */
function HeroBillboard({ universes }: { universes: any[] }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const navigate = Route.useNavigate();
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  const featured = useMemo(() => {
    let picks = universes.filter((u) => u.tokenData || u.nodeCount > 0).slice(0, 5);
    if (picks.length === 0) picks = universes.slice(0, 5);
    return picks;
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
      <div className="relative h-[70vh] min-h-[500px] max-h-[800px] flex items-center justify-center bg-gradient-to-b from-primary/10 via-background to-background">
        <div className="text-center px-4">
          <h1 className="text-5xl md:text-7xl font-black text-white mb-4 tracking-tight">LOAR</h1>
          <p className="text-xl text-white/70 mb-8 max-w-lg mx-auto">
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
    <div className="relative h-[70vh] min-h-[500px] max-h-[800px] overflow-hidden">
      {/* Background image with Ken Burns effect */}
      {featured.map((u, i) => (
        <div
          key={u.id}
          className="absolute inset-0 transition-opacity duration-1000"
          style={{ opacity: i === currentIndex ? 1 : 0 }}
        >
          {u.imageURL || u.tokenData?.imageURL ? (
            <img
              src={u.imageURL || u.tokenData?.imageURL}
              alt=""
              className="w-full h-full object-cover scale-105"
              style={{
                animation:
                  i === currentIndex ? 'kenburns 12s ease-in-out infinite alternate' : 'none',
              }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900" />
          )}
        </div>
      ))}

      {/* Vignette overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/30" />
      <div className="absolute inset-0 bg-gradient-to-r from-background/80 via-transparent to-transparent" />

      {/* Content */}
      <div className="absolute inset-0 flex items-end">
        <div className="w-full px-4 md:px-12 pb-24 md:pb-32 max-w-3xl">
          {/* Badges */}
          <div className="flex items-center gap-2 mb-4">
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
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-black text-white mb-3 tracking-tight leading-none">
            {current.name || current.tokenData?.name}
          </h1>

          {/* Description */}
          <p className="text-base md:text-lg text-white/70 mb-6 max-w-xl line-clamp-3 leading-relaxed">
            {current.description || current.tokenData?.metadata}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              size="lg"
              className="rounded-full px-6 bg-white text-black hover:bg-white/90 font-bold"
              onClick={() => navigate({ to: `/universe/${current.id}` })}
            >
              <Play className="h-5 w-5 mr-2 fill-current" />
              Explore
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="rounded-full px-6 border-white/30 text-white hover:bg-white/10 font-bold"
              onClick={() => navigate({ to: `/universe/${current.id}` })}
            >
              <BookOpen className="h-5 w-5 mr-2" />
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

      {/* Dot indicators */}
      {featured.length > 1 && (
        <div className="absolute bottom-8 left-4 md:left-12 flex gap-2">
          {featured.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
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
function ActivityTicker() {
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data: nodesData } = useQuery({
    queryKey: ['ponder', 'nodes', 'recent-20'],
    queryFn: () =>
      ponderGql<{ nodes: { items: Node[] } }>(`{
        nodes(orderBy: "createdAt", orderDirection: "desc", limit: 20) {
          items { id universeAddress nodeId previousNodeId creator createdAt }
        }
      }`).then((d) => d.nodes.items),
  });

  const { data: nodeContentData } = useQuery({
    queryKey: ['ponder', 'nodeContents'],
    queryFn: () =>
      ponderGql<{ nodeContents: { items: NodeContent[] } }>(`{
        nodeContents(limit: 1000) {
          items { id videoLink plot }
        }
      }`).then((d) => d.nodeContents.items),
  });

  const { data: universesData } = useQuery({
    queryKey: ['ponder', 'universes', 'all'],
    queryFn: () =>
      ponderGql<{ universes: { items: Universe[] } }>(`{
        universes(limit: 1000) {
          items { id universeId creator createdAt name description imageURL tokenAddress governorAddress nodeCount }
        }
      }`).then((d) => d.universes.items),
  });

  const activities = useMemo(() => {
    if (!nodesData || !nodeContentData || !universesData) {
      // Placeholder activity when indexer is offline
      return PLACEHOLDER_UNIVERSES.slice(0, 8).flatMap((u) => [
        { id: `${u.id}-ep`, universeName: u.name, action: 'New Episode', universeId: u.id },
        { id: `${u.id}-vote`, universeName: u.name, action: 'Governance Vote', universeId: u.id },
      ]);
    }

    const contentMap = new Map<string, NodeContent>();
    nodeContentData.forEach((c) => contentMap.set(c.id, c));

    const universeMap = new Map<string, Universe>();
    universesData.forEach((u) => universeMap.set(u.id.toLowerCase(), u));

    return nodesData
      .map((n) => {
        const content = contentMap.get(`${n.universeAddress.toLowerCase()}:${n.nodeId}`);
        const uni = universeMap.get(n.universeAddress.toLowerCase());
        return {
          id: n.id,
          universeName: uni?.name || `Universe ${n.universeAddress.slice(0, 8)}`,
          action: content?.plot ? 'New Episode' : 'Created',
          universeId: n.universeAddress,
        };
      })
      .slice(0, 15);
  }, [nodesData, nodeContentData, universesData]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (scrollRef.current) {
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        if (scrollLeft >= scrollWidth - clientWidth) {
          scrollRef.current.scrollLeft = 0;
        } else {
          scrollRef.current.scrollLeft += 1;
        }
      }
    }, 40);
    return () => clearInterval(interval);
  }, []);

  if (activities.length === 0) return null;

  return (
    <div className="border-b border-white/5 bg-white/[0.02]">
      <div ref={scrollRef} className="flex gap-6 px-4 py-2.5 overflow-x-hidden whitespace-nowrap">
        {activities.map((a, i) => (
          <Link
            key={`${a.id}-${i}`}
            to="/universe/$id"
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
 * Recent Videos Row (Webtoons episode feed)
 * ────────────────────────────────────────── */
function RecentEpisodes({ universes }: { universes: any[] }) {
  const { data: nodesData } = useQuery({
    queryKey: ['ponder', 'nodes', 'recent-10'],
    queryFn: () =>
      ponderGql<{ nodes: { items: Node[] } }>(`{
        nodes(orderBy: "createdAt", orderDirection: "desc", limit: 10) {
          items { id universeAddress nodeId previousNodeId creator createdAt }
        }
      }`).then((d) => d.nodes.items),
  });

  const { data: nodeContentData } = useQuery({
    queryKey: ['ponder', 'nodeContents'],
    queryFn: () =>
      ponderGql<{ nodeContents: { items: NodeContent[] } }>(`{
        nodeContents(limit: 1000) {
          items { id videoLink plot }
        }
      }`).then((d) => d.nodeContents.items),
  });

  const episodes = useMemo(() => {
    if (!nodesData || !nodeContentData) {
      // Placeholder episodes when indexer is offline
      const placeholderPlots = [
        'The neural implant begins broadcasting fragmented memories across the city grid.',
        'Deep in the Wyrdwood, the eldest tree speaks for the first time in a thousand years.',
        'Oxygen reserves drop to 38 days. The navigator AI proposes an impossible detour.',
        'A forbidden technique resurfaces — the Jade Fist, lost since the dynasty fell.',
        'The bloom market crashes overnight. Someone is hoarding dreams.',
        "At 11,000 meters depth, the sonar returns a shape that shouldn't exist.",
        'A witness disappears from a locked room. The detective tastes copper — someone is lying.',
        'The trickster god makes a bet: one week in a mortal body, no powers.',
      ];
      return PLACEHOLDER_UNIVERSES.slice(0, 8).map((u, i) => ({
        id: `placeholder-ep-${u.id}`,
        videoLink: null,
        plot: placeholderPlots[i],
        universeName: u.name,
        universeImage: u.imageURL,
        universeId: u.id,
        nodeId: String(i + 1),
        timestamp: Date.now() - i * 3600000,
      }));
    }

    const contentMap = new Map<string, NodeContent>();
    nodeContentData.forEach((c) => contentMap.set(c.id, c));

    const uniMap = new Map<string, any>();
    universes.forEach((u) => uniMap.set(u.id.toLowerCase(), u));

    return nodesData
      .map((n) => {
        const content = contentMap.get(`${n.universeAddress.toLowerCase()}:${n.nodeId}`);
        const uni = uniMap.get(n.universeAddress.toLowerCase());
        if (!content?.videoLink && !content?.plot) return null;
        return {
          id: n.id,
          videoLink: content?.videoLink,
          plot: content?.plot,
          universeName: uni?.name || `Universe ${n.universeAddress.slice(0, 8)}`,
          universeImage: uni?.imageURL || uni?.tokenData?.imageURL,
          universeId: n.universeAddress,
          nodeId: n.nodeId,
          timestamp: Number(n.createdAt) * 1000,
        };
      })
      .filter(Boolean)
      .slice(0, 10);
  }, [nodesData, nodeContentData, universes]);

  if (episodes.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader icon={Clock} title="New Episodes" subtitle="Latest story updates" />
      <ScrollRow>
        {episodes.map((ep: any) => (
          <Link
            key={ep.id}
            to="/event/$universe/$event"
            params={{ universe: ep.universeId, event: ep.nodeId.toString() }}
            className="group flex-shrink-0 w-[260px] md:w-[300px]"
          >
            {/* Video thumbnail */}
            <div className="relative aspect-video rounded-xl overflow-hidden bg-muted mb-2 ring-1 ring-white/5 group-hover:ring-primary/60 transition-all">
              {ep.videoLink?.includes('walrus') ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-indigo-500/30 to-purple-500/30">
                  <Play className="h-8 w-8 text-white/80 group-hover:scale-110 transition-transform" />
                </div>
              ) : ep.videoLink ? (
                <>
                  <video
                    src={ep.videoLink}
                    className="w-full h-full object-cover"
                    muted
                    preload="metadata"
                  />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
                    <Play className="h-8 w-8 text-white fill-white" />
                  </div>
                </>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-purple-900/40 to-pink-900/40">
                  <BookOpen className="h-8 w-8 text-white/60" />
                </div>
              )}
              {/* Timestamp */}
              <div className="absolute top-2 right-2 px-2 py-0.5 bg-black/70 backdrop-blur-sm rounded text-[10px] text-white font-medium">
                {new Date(ep.timestamp).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
            </div>

            {/* Info */}
            <div className="flex gap-2 items-start px-0.5">
              {ep.universeImage ? (
                <img
                  src={ep.universeImage}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover flex-shrink-0 mt-0.5"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-white truncate group-hover:text-primary transition-colors">
                  {ep.universeName}
                </h4>
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                  {ep.plot || 'New episode added'}
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
 * Top 10 Strip — numbered cards (Netflix Top 10)
 * ────────────────────────────────────────── */
function Top10Strip({ universes }: { universes: any[] }) {
  const sorted = useMemo(() => {
    return [...universes]
      .sort((a, b) => {
        const aScore =
          (a.nodeCount || 0) * 100 + (a.tokenData ? 50 : 0) + (a.swapVolume || 0) / 1e18;
        const bScore =
          (b.nodeCount || 0) * 100 + (b.tokenData ? 50 : 0) + (b.swapVolume || 0) / 1e18;
        return bScore - aScore;
      })
      .slice(0, 10)
      .map((u, i) => ({ ...u, _rank: i }));
  }, [universes]);

  if (sorted.length === 0) return null;

  return (
    <section className="py-6">
      <SectionHeader icon={Flame} title="Top 10 Universes" subtitle="Most active this week" />
      <ScrollRow>
        {sorted.map((u) => (
          <div key={u.id} className="flex-shrink-0 flex items-end gap-0">
            {/* Large rank number */}
            <span
              className="text-[100px] md:text-[120px] font-black leading-none select-none"
              style={{
                WebkitTextStroke: '2px rgba(255,255,255,0.3)',
                color: 'transparent',
                marginRight: '-20px',
                zIndex: 1,
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
function TokenPoweredRow({ universes }: { universes: any[] }) {
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
function TrendingRow({ universes }: { universes: any[] }) {
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
function NewArrivalsRow({ universes }: { universes: any[] }) {
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
function MostEpisodesRow({ universes }: { universes: any[] }) {
  const byEpisodes = useMemo(() => {
    return [...universes]
      .filter((u) => u.nodeCount > 0)
      .sort((a, b) => (b.nodeCount || 0) - (a.nodeCount || 0))
      .slice(0, 10);
  }, [universes]);

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
 * CTA Banner
 * ────────────────────────────────────────── */
function CreateBanner() {
  const navigate = Route.useNavigate();

  return (
    <section className="px-4 md:px-12 py-12">
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-r from-primary/20 via-purple-500/20 to-pink-500/20 border border-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(var(--primary),0.15),transparent_70%)]" />
        <div className="relative px-8 py-12 md:py-16 flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-3xl md:text-4xl font-black text-white mb-2">Start Your Universe</h2>
            <p className="text-white/60 text-lg max-w-md">
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
function SearchOverlay({
  open,
  onClose,
  universes,
}: {
  open: boolean;
  onClose: () => void;
  universes: any[];
}) {
  const [query, setQuery] = useState('');
  const navigate = Route.useNavigate();

  const filtered = useMemo(() => {
    if (!query) return [];
    const q = query.toLowerCase();
    return universes.filter((u: any) => {
      const name = u.name?.toLowerCase() || '';
      const tokenName = u.tokenData?.name?.toLowerCase() || '';
      const tokenSymbol = u.tokenData?.symbol?.toLowerCase() || '';
      const description = u.description?.toLowerCase() || '';
      const address = u.id.toLowerCase();
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
                        navigate({ to: `/universe/${u.id}` });
                        onClose();
                      }}
                      className="w-full p-3 rounded-xl hover:bg-white/5 transition-colors text-left flex items-center gap-3"
                    >
                      <div className="w-10 h-14 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br from-indigo-600 to-purple-600">
                        {(u.imageURL || u.tokenData?.imageURL) && (
                          <img
                            src={u.imageURL || u.tokenData?.imageURL}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-white truncate">
                          {u.name || u.tokenData?.name || `Universe ${u.id.slice(0, 8)}`}
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
                        navigate({ to: `/universe/${u.id}` });
                        onClose();
                      }}
                      className="w-full p-2.5 rounded-lg hover:bg-white/5 transition-colors text-left flex items-center gap-3"
                    >
                      <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br from-indigo-600 to-purple-600">
                        {(u.imageURL || u.tokenData?.imageURL) && (
                          <img
                            src={u.imageURL || u.tokenData?.imageURL}
                            alt=""
                            className="w-full h-full object-cover"
                          />
                        )}
                      </div>
                      <span className="text-sm font-medium text-white truncate">
                        {u.name || u.tokenData?.name || `Universe ${u.id.slice(0, 8)}`}
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
function HomeComponent() {
  const { isConnected } = useAccount();
  const [searchOpen, setSearchOpen] = useState(false);

  // Keyboard shortcut: Cmd/Ctrl + K to open search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Data Queries (same as before) ───
  const { data: universesData } = useQuery({
    queryKey: ['ponder', 'universes', 'top-50'],
    queryFn: () =>
      ponderGql<{ universes: { items: Universe[] } }>(`{
        universes(orderBy: "createdAt", orderDirection: "desc", limit: 50) {
          items { id universeId creator createdAt name description imageURL tokenAddress governorAddress nodeCount }
        }
      }`).then((d) => d.universes.items),
  });

  const { data: tokensData } = useQuery({
    queryKey: ['ponder', 'tokens'],
    queryFn: () =>
      ponderGql<{ tokens: { items: Token[] } }>(`{
        tokens(limit: 1000) {
          items { id universeAddress deployer tokenAdmin name symbol imageURL metadata context startingTick poolHook poolId pairedToken locker createdAt }
        }
      }`).then((d) => d.tokens.items),
  });

  const { data: swapsData } = useQuery({
    queryKey: ['ponder', 'swaps'],
    queryFn: () =>
      ponderGql<{ swaps: { items: Swap[] } }>(`{
        swaps(orderBy: "timestamp", orderDirection: "desc", limit: 1000) {
          items { id poolId sender amount0 amount1 sqrtPriceX96 liquidity tick timestamp blockNumber }
        }
      }`).then((d) => d.swaps.items),
  });

  const { data: holdersData } = useQuery({
    queryKey: ['ponder', 'tokenHolders'],
    queryFn: () =>
      ponderGql<{ tokenHolders: { items: TokenHolder[] } }>(`{
        tokenHolders(limit: 1000) {
          items { id tokenAddress holderAddress balance }
        }
      }`).then((d) => d.tokenHolders.items),
  });

  // ─── Combine data ───
  const universes = useMemo(() => {
    if (!universesData) return PLACEHOLDER_UNIVERSES;

    const tokenMap = new Map<string, Token>();
    if (tokensData) {
      tokensData.forEach((t) => tokenMap.set(t.universeAddress.toLowerCase(), t));
    }

    const now = Date.now() / 1000;
    const dayAgo = now - 86400;
    const volumeMap = new Map<string, number>();
    if (swapsData) {
      swapsData.forEach((s) => {
        if (s.timestamp >= dayAgo) {
          const current = volumeMap.get(s.poolId) || 0;
          volumeMap.set(s.poolId, current + Math.abs(Number(s.amount0)));
        }
      });
    }

    const holderCountMap = new Map<string, number>();
    if (holdersData) {
      holdersData.forEach((h) => {
        const current = holderCountMap.get(h.tokenAddress.toLowerCase()) || 0;
        holderCountMap.set(h.tokenAddress.toLowerCase(), current + 1);
      });
    }

    const combined = universesData.map((u) => {
      const tokenData = tokenMap.get(u.id.toLowerCase());
      const poolId = tokenData?.poolId;
      const swapVolume = poolId ? volumeMap.get(poolId) || 0 : 0;
      const holderCount = tokenData ? holderCountMap.get(tokenData.id.toLowerCase()) || 0 : 0;
      return { ...u, tokenData, swapVolume, holderCount };
    });

    // Fall back to curated placeholders when indexer has no data
    return combined.length > 0 ? combined : PLACEHOLDER_UNIVERSES;
  }, [universesData, tokensData, swapsData, holdersData]);

  return (
    <div className="min-h-screen bg-background">
      {/* Ken Burns animation */}
      <style>{`
        @keyframes kenburns {
          0% { transform: scale(1.05) translate(0, 0); }
          100% { transform: scale(1.12) translate(-1%, -1%); }
        }
      `}</style>

      <ActivityTicker />

      {/* Floating search button */}
      <button
        onClick={() => setSearchOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-white shadow-lg shadow-primary/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform md:hidden"
      >
        <Search className="h-5 w-5" />
      </button>

      {/* Desktop search shortcut hint in header area */}
      <button
        onClick={() => setSearchOpen(true)}
        className="hidden md:flex fixed top-[18px] right-56 z-50 items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-muted-foreground hover:bg-white/10 hover:text-white transition-all"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search</span>
        <kbd className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded font-mono">
          {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}K
        </kbd>
      </button>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} universes={universes} />

      {/* Hero */}
      <HeroBillboard universes={universes} />

      {/* Content Rows */}
      <div className="-mt-16 relative z-10 pb-20 space-y-2">
        <Top10Strip universes={universes} />
        <TrendingRow universes={universes} />
        <RecentEpisodes universes={universes} />
        <NewArrivalsRow universes={universes} />
        <MostEpisodesRow universes={universes} />
        <TokenPoweredRow universes={universes} />
        <CreateBanner />
      </div>
    </div>
  );
}
