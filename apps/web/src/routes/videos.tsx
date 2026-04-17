/**
 * Videos Gallery
 *
 * Two-section gallery: Short-Form (vertical, Reels-style) and Long-Form (cinema, 16:9).
 * Filters by mediaType video/ai-video, with format distinction.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState, useRef } from 'react';
import {
  Search,
  Play,
  Film,
  Clapperboard,
  Loader2,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

export const Route = createFileRoute('/videos')({
  component: VideosPage,
});

function VideosPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  function handleSearch(val: string) {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(val), 350);
  }

  const shortQuery = useInfiniteQuery({
    queryKey: ['videos-short', debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      trpcClient.content.feed.query({
        mediaType: 'ai-video',
        format: 'short',
        search: debouncedSearch || undefined,
        limit: 12,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: any) => last.nextCursor ?? undefined,
  });

  const longQuery = useInfiniteQuery({
    queryKey: ['videos-long', debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      trpcClient.content.feed.query({
        format: 'long',
        search: debouncedSearch || undefined,
        limit: 12,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: any) => last.nextCursor ?? undefined,
  });

  // Fetch ai-video without format filter to catch promoted sandbox videos (which have no format)
  const aiVideoQuery = useInfiniteQuery({
    queryKey: ['videos-ai', debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      trpcClient.content.feed.query({
        mediaType: 'ai-video',
        search: debouncedSearch || undefined,
        limit: 24,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: any) => last.nextCursor ?? undefined,
  });

  // Also fetch non-AI videos
  const rawVideoQuery = useInfiniteQuery({
    queryKey: ['videos-raw', debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      trpcClient.content.feed.query({
        mediaType: 'video',
        search: debouncedSearch || undefined,
        limit: 24,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: any) => last.nextCursor ?? undefined,
  });

  // Fetch all completed video generations directly (catches any not in content collection)
  const generationGalleryQuery = useInfiniteQuery({
    queryKey: ['videos-generations', debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      trpcClient.generation.gallery.query({
        limit: 50,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: any) => last.nextCursor ?? undefined,
  });

  const shortItems = shortQuery.data?.pages.flatMap((p: any) => p.items) ?? [];
  const longItems = longQuery.data?.pages.flatMap((p: any) => p.items) ?? [];
  const aiVideoItems = aiVideoQuery.data?.pages.flatMap((p: any) => p.items) ?? [];
  const rawVideoItems = rawVideoQuery.data?.pages.flatMap((p: any) => p.items) ?? [];
  const generationItems = generationGalleryQuery.data?.pages.flatMap((p: any) => p.items) ?? [];

  // Collect IDs already shown in short/long sections
  const shortIds = new Set(shortItems.map((i: any) => i.id));
  const longIds = new Set(longItems.map((i: any) => i.id));
  const categorizedIds = new Set([...shortIds, ...longIds]);

  // Also collect generationIds from content items to de-duplicate against generation gallery
  const contentGenIds = new Set(
    [...shortItems, ...longItems, ...aiVideoItems, ...rawVideoItems]
      .map((i: any) => i.generationId)
      .filter(Boolean)
  );
  const contentMediaUrls = new Set(
    [...shortItems, ...longItems, ...aiVideoItems, ...rawVideoItems]
      .map((i: any) => i.mediaUrl)
      .filter(Boolean)
  );

  // Filter generation gallery items that aren't already in content feed
  const extraFromGenerations = generationItems.filter(
    (g: any) =>
      !contentGenIds.has(g.generationId) &&
      !contentMediaUrls.has(g.mediaUrl) &&
      (!debouncedSearch ||
        g.title?.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        g.description?.toLowerCase().includes(debouncedSearch.toLowerCase()))
  );

  // Videos without a format (most sandbox promotions) go into short-form display
  const unformatted = [...aiVideoItems, ...rawVideoItems].filter(
    (i: any) => !i.format && !categorizedIds.has(i.id)
  );

  // Only show videos that have a cover image (thumbnailUrl)
  const hasCover = (i: any) => !!i.thumbnailUrl;
  const displayShort = [...shortItems, ...unformatted, ...extraFromGenerations].filter(hasCover);
  const displayLong = longItems.filter(hasCover);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden border-b bg-gradient-to-br from-background via-primary/5 to-purple-900/20">
        <div className="container mx-auto px-6 py-14">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <Film className="h-8 w-8 text-primary" />
                <h1 className="text-4xl font-bold tracking-tight">Videos</h1>
              </div>
              <p className="text-muted-foreground text-lg max-w-xl">
                AI-generated cinematic universes — from quick shorts to feature-length epics.
              </p>
            </div>
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search videos..."
                className="pl-9 h-11"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-10 space-y-16">
        {/* Short-Form Section */}
        <section>
          <SectionHeader
            icon={<Play className="h-5 w-5 text-pink-500" />}
            label="Short-Form"
            sublabel="Clips · Reels · Shorts"
            accentClass="text-pink-500"
            count={displayShort.length}
          />

          {shortQuery.isLoading || aiVideoQuery.isLoading || generationGalleryQuery.isLoading ? (
            <LoadingRow />
          ) : displayShort.length === 0 ? (
            <EmptySection
              icon={<Play className="h-10 w-10 text-muted-foreground" />}
              message={
                debouncedSearch
                  ? `No short-form results for "${debouncedSearch}"`
                  : 'No short-form videos yet'
              }
            />
          ) : (
            <>
              <HorizontalScrollRow>
                {displayShort.map((item: any) => (
                  <ShortCard key={item.id} item={item} />
                ))}
              </HorizontalScrollRow>
              {shortQuery.hasNextPage && (
                <div className="flex justify-center mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => shortQuery.fetchNextPage()}
                    disabled={shortQuery.isFetchingNextPage}
                    className="gap-2"
                  >
                    {shortQuery.isFetchingNextPage && <Loader2 className="h-3 w-3 animate-spin" />}
                    Load more shorts
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Divider */}
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border/50" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-background px-4 text-xs text-muted-foreground uppercase tracking-widest">
              Long-Form
            </span>
          </div>
        </div>

        {/* Long-Form Section */}
        <section>
          <SectionHeader
            icon={<Clapperboard className="h-5 w-5 text-blue-500" />}
            label="Long-Form"
            sublabel="Episodes · Series · Features"
            accentClass="text-blue-500"
            count={longItems.length}
          />

          {longQuery.isLoading ? (
            <LoadingRow />
          ) : displayLong.length === 0 ? (
            <EmptySection
              icon={<Clapperboard className="h-10 w-10 text-muted-foreground" />}
              message={
                debouncedSearch
                  ? `No long-form results for "${debouncedSearch}"`
                  : 'No long-form videos yet'
              }
            />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {displayLong.map((item: any) => (
                  <LongCard key={item.id} item={item} />
                ))}
              </div>
              {longQuery.hasNextPage && (
                <div className="flex justify-center mt-6">
                  <Button
                    variant="outline"
                    onClick={() => longQuery.fetchNextPage()}
                    disabled={longQuery.isFetchingNextPage}
                    className="gap-2"
                  >
                    {longQuery.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
                    Load more
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ─── Section header ─────────────────────────────────────────── */

function SectionHeader({
  icon,
  label,
  sublabel,
  accentClass,
  count,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  accentClass: string;
  count: number;
}) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <h2 className={`text-2xl font-bold ${accentClass}`}>{label}</h2>
          <p className="text-xs text-muted-foreground">{sublabel}</p>
        </div>
      </div>
      {count > 0 && (
        <span className="text-sm text-muted-foreground">
          {count} video{count !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

/* ─── Horizontal scroll row with arrow buttons ───────────────── */

function HorizontalScrollRow({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  function scroll(dir: 'left' | 'right') {
    if (!ref.current) return;
    ref.current.scrollBy({ left: dir === 'right' ? 320 : -320, behavior: 'smooth' });
  }

  return (
    <div className="relative group/row">
      <button
        onClick={() => scroll('left')}
        className="absolute -left-4 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-background/80 border shadow-md flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-muted"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <div
        ref={ref}
        className="flex gap-4 overflow-x-auto scrollbar-none pb-2"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {children}
      </div>
      <button
        onClick={() => scroll('right')}
        className="absolute -right-4 top-1/2 -translate-y-1/2 z-10 h-9 w-9 rounded-full bg-background/80 border shadow-md flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity hover:bg-muted"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}

/* ─── Short-form card (9:16 vertical) ───────────────────────── */

function ShortCard({ item }: { item: any }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);

  function handleMouseEnter() {
    setPlaying(true);
    videoRef.current?.play().catch(() => {});
  }
  function handleMouseLeave() {
    setPlaying(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }

  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';

  return (
    <div
      className="relative flex-shrink-0 rounded-xl overflow-hidden bg-muted border border-border/50 hover:border-primary/40 transition-all duration-200 hover:shadow-xl hover:-translate-y-1 cursor-pointer group"
      style={{ width: 168, scrollSnapAlign: 'start' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 9:16 aspect */}
      <div className="relative" style={{ aspectRatio: '9/16' }}>
        {isVideo && item.mediaUrl ? (
          <video
            ref={videoRef}
            src={item.thumbnailUrl ? item.mediaUrl : `${item.mediaUrl}#t=0.5`}
            className="w-full h-full object-cover"
            muted={muted}
            loop
            playsInline
            preload="metadata"
            poster={item.thumbnailUrl || undefined}
          />
        ) : item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Play className="h-8 w-8" />
          </div>
        )}

        {/* Play indicator */}
        {!playing && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Play className="h-5 w-5 text-white fill-white" />
            </div>
          </div>
        )}

        {/* Mute toggle */}
        {playing && (
          <button
            className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
            }}
          >
            {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
        )}

        {/* Classification badge */}
        <div className="absolute top-2 left-2">
          <ContentLaneBadge classification={item.classification} size="sm" />
        </div>

        {/* AI badge */}
        {(item.mediaType === 'ai-video' || item.mediaType === 'ai-image') && (
          <div className="absolute top-2 right-2">
            <span className="text-[10px] bg-purple-600/80 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
              AI
            </span>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-2.5">
        <p className="text-xs font-semibold line-clamp-2 leading-tight">{item.title}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{item.views ?? 0} views</p>
      </div>
    </div>
  );
}

/* ─── Long-form card (16:9) ──────────────────────────────────── */

function LongCard({ item }: { item: any }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);

  function handleMouseEnter() {
    setPlaying(true);
    videoRef.current?.play().catch(() => {});
  }
  function handleMouseLeave() {
    setPlaying(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }

  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';

  return (
    <div
      className="rounded-xl overflow-hidden bg-muted border border-border/50 hover:border-primary/40 transition-all duration-200 hover:shadow-xl hover:-translate-y-1 cursor-pointer group"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* 16:9 */}
      <div className="relative aspect-video">
        {isVideo && item.mediaUrl ? (
          <video
            ref={videoRef}
            src={item.thumbnailUrl ? item.mediaUrl : `${item.mediaUrl}#t=0.5`}
            className="w-full h-full object-cover"
            muted={muted}
            loop
            playsInline
            preload="metadata"
            poster={item.thumbnailUrl || undefined}
          />
        ) : item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Clapperboard className="h-10 w-10" />
          </div>
        )}

        {/* Play overlay */}
        <div
          className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity ${
            playing ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div className="h-12 w-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Play className="h-6 w-6 text-white fill-white" />
          </div>
        </div>

        {/* Mute */}
        {playing && (
          <button
            className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
            }}
          >
            {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
        )}

        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1.5">
          <ContentLaneBadge classification={item.classification} size="sm" />
        </div>
        {(item.mediaType === 'ai-video' || item.mediaType === 'ai-image') && (
          <div className="absolute top-2 right-2">
            <span className="text-xs bg-purple-600/80 text-white px-2 py-0.5 rounded backdrop-blur-sm">
              AI
            </span>
          </div>
        )}

        {/* Runtime placeholder badge */}
        <div className="absolute bottom-2 left-2">
          <span className="text-[10px] bg-black/60 text-white px-1.5 py-0.5 rounded">
            Long-Form
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-semibold text-sm line-clamp-1">{item.title}</h3>
        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{item.description}</p>
        )}
        <div className="flex items-center justify-between mt-2">
          <div className="flex flex-wrap gap-1">
            {Array.isArray(item.tags) &&
              item.tags.slice(0, 2).map((tag: string) => (
                <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
          </div>
          <span className="text-[10px] text-muted-foreground">{item.views ?? 0} views</span>
        </div>
      </div>
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────── */

function LoadingRow() {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex-shrink-0 rounded-xl bg-muted animate-pulse"
          style={{ width: 168, aspectRatio: '9/16' }}
        />
      ))}
    </div>
  );
}

function EmptySection({ icon, message }: { icon: React.ReactNode; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon}
      <p className="text-muted-foreground mt-3 text-sm">{message}</p>
    </div>
  );
}
