/**
 * Discover Page
 *
 * Tabs: Universes (default) · Creators · Content · Videos
 * Top: Trending hero section with global trending content.
 * All cards are clickable with proper routing.
 * Content cards show universe context.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';
import { QueryState } from '@/components/QueryState';
import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Search,
  Users,
  Play,
  Sparkles,
  DollarSign,
  Image as ImageIcon,
  Film,
  Grid3X3,
  Clapperboard,
  Loader2,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
  Globe,
  TrendingUp,
  Flame,
  Eye,
  Lock,
  Crown,
} from 'lucide-react';

export const Route = createFileRoute('/discover')({
  component: DiscoverPage,
});

function DiscoverPage() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('universes');
  const [contentFilter, setContentFilter] = useState<'all' | 'fan' | 'original' | 'licensed'>(
    'all'
  );
  const [mediaFilter, setMediaFilter] = useState<string | undefined>();

  const {
    data: profilesData,
    isLoading: profilesLoading,
    isError: profilesError,
    refetch: profilesRefetch,
  } = useQuery({
    queryKey: ['discover-profiles', search],
    queryFn: () => trpcClient.profiles.discover.query({ search: search || undefined, limit: 30 }),
    enabled: activeTab === 'creators',
  });

  const {
    data: contentData,
    isLoading: contentLoading,
    isError: contentError,
    refetch: contentRefetch,
  } = useQuery({
    queryKey: ['discover-content', search, contentFilter, mediaFilter],
    queryFn: () =>
      trpcClient.content.feed.query({
        search: search || undefined,
        classification: contentFilter === 'all' ? undefined : contentFilter,
        mediaType: mediaFilter as any,
        limit: 30,
      }),
    enabled: activeTab === 'content',
  });

  const { data: trendingData, isLoading: trendingLoading } = useQuery({
    queryKey: ['discover-trending'],
    queryFn: () => trpcClient.feed.getGlobalTrending.query({ limit: 6 }),
  });

  const profiles = profilesData?.profiles || [];
  const contentItems = contentData?.items || [];
  const trendingItems = trendingData?.items || [];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero — Trending Section */}
      <div className="border-b bg-gradient-to-br from-primary/5 via-purple-500/5 to-pink-500/5">
        <div className="container mx-auto px-6 py-10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-bold mb-2">Discover</h1>
              <p className="text-muted-foreground text-lg">
                Explore universes, creators, and AI-generated stories.
              </p>
            </div>
            <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
              <Flame className="h-4 w-4 text-orange-500" />
              Trending Now
            </div>
          </div>

          {/* Search */}
          <div className="max-w-xl relative mb-8">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search universes, creators, content..."
              className="pl-10 h-12 text-lg"
            />
          </div>

          {/* Trending Cards */}
          {trendingItems.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {trendingItems.map((item: any, i: number) => (
                <Link
                  key={item.id || item.contentId || i}
                  to="/gallery"
                  className="group relative rounded-xl overflow-hidden bg-muted aspect-[3/4] hover:ring-2 hover:ring-primary/50 transition-all"
                >
                  {item.thumbnailUrl || item.mediaUrl ? (
                    <img
                      src={item.thumbnailUrl || item.mediaUrl}
                      alt={item.title || 'Trending'}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <TrendingUp className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  <div className="absolute bottom-0 inset-x-0 p-2.5">
                    <div className="flex items-center gap-1 mb-1">
                      <span className="text-[10px] font-bold text-orange-400">#{i + 1}</span>
                      <Flame className="h-3 w-3 text-orange-400" />
                    </div>
                    <p className="text-white text-xs font-medium line-clamp-2 leading-tight">
                      {item.title || 'Untitled'}
                    </p>
                    <p className="text-white/50 text-[10px] mt-0.5">
                      {item.totalViews ?? item.views ?? 0} views
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
          {trendingLoading && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl bg-muted animate-pulse aspect-[3/4]" />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
            <TabsList>
              <TabsTrigger value="universes" className="gap-1">
                <Globe className="h-4 w-4" /> Universes
              </TabsTrigger>
              <TabsTrigger value="creators" className="gap-1">
                <Users className="h-4 w-4" /> Creators
              </TabsTrigger>
              <TabsTrigger value="content" className="gap-1">
                <Grid3X3 className="h-4 w-4" /> Content
              </TabsTrigger>
              <TabsTrigger value="videos" className="gap-1">
                <Film className="h-4 w-4" /> Videos
              </TabsTrigger>
            </TabsList>

            {/* Content sub-filters */}
            {activeTab === 'content' && (
              <div className="flex gap-2 flex-wrap">
                {(
                  [
                    { value: 'all', label: 'All', icon: Grid3X3 },
                    { value: 'fan', label: 'Fan', icon: Sparkles },
                    { value: 'original', label: 'Original', icon: DollarSign },
                    { value: 'licensed', label: 'Licensed', icon: Lock },
                  ] as const
                ).map((opt) => (
                  <Button
                    key={opt.value}
                    variant={contentFilter === opt.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setContentFilter(opt.value)}
                    className="gap-1"
                  >
                    <opt.icon className="h-3 w-3" />
                    {opt.label}
                  </Button>
                ))}
                <div className="w-px bg-border mx-1" />
                {[
                  { value: undefined, label: 'All Types', icon: Grid3X3 },
                  { value: 'video', label: 'Video', icon: Film },
                  { value: 'ai-video', label: 'AI Video', icon: Play },
                  { value: 'image', label: 'Image', icon: ImageIcon },
                ].map((opt) => (
                  <Button
                    key={opt.label}
                    variant={mediaFilter === opt.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setMediaFilter(opt.value)}
                    className="gap-1"
                  >
                    <opt.icon className="h-3 w-3" />
                    {opt.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Universes Tab */}
          <TabsContent value="universes">
            <UniversesTabContent search={search} />
          </TabsContent>

          {/* Creators Tab */}
          <TabsContent value="creators">
            <QueryState
              isLoading={profilesLoading}
              isError={profilesError}
              isEmpty={profiles.length === 0}
              onRetry={() => profilesRefetch()}
              errorMessage="Failed to load creators. Please try again."
              skeletonCount={8}
              skeletonAspect="aspect-[4/5]"
              emptyState={
                <div className="text-center py-16">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No creators found</h3>
                  <p className="text-muted-foreground">
                    {search
                      ? `No results for "${search}"`
                      : 'Be the first to create a public profile!'}
                  </p>
                </div>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {profiles.map((profile: any) => (
                  <CreatorCard key={profile.id} profile={profile} />
                ))}
              </div>
            </QueryState>
          </TabsContent>

          {/* Content Tab */}
          <TabsContent value="content">
            <QueryState
              isLoading={contentLoading}
              isError={contentError}
              isEmpty={contentItems.length === 0}
              onRetry={() => contentRefetch()}
              errorMessage="Failed to load content. Please try again."
              skeletonCount={8}
              skeletonAspect="aspect-video"
              emptyState={
                <div className="text-center py-16">
                  <Grid3X3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No content found</h3>
                  <p className="text-muted-foreground">
                    {search ? `No results for "${search}"` : 'No public content yet.'}
                  </p>
                </div>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {contentItems.map((item: any) => (
                  <ContentFeedCard key={item.id} item={item} />
                ))}
              </div>
            </QueryState>
          </TabsContent>

          {/* Videos Tab */}
          <TabsContent value="videos">
            <VideosTabContent search={search} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/* ─── Universes Tab ────────────────────────────────────────────── */

function UniversesTabContent({ search }: { search: string }) {
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [accessFilter, setAccessFilter] = useState<string | undefined>();
  const [typeFilter, setTypeFilter] = useState<'fun' | 'monetized' | undefined>();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['discover-universes', search, sortBy, accessFilter, typeFilter],
    queryFn: () =>
      trpcClient.universes.discover.query({
        search: search || undefined,
        sortBy,
        accessModel: accessFilter as any,
        universeType: typeFilter,
        limit: 40,
      }),
  });

  const universes = data?.items || [];

  return (
    <div>
      {/* Sort & Filter Bar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <span className="text-sm text-muted-foreground mr-1">Sort:</span>
        {(['newest', 'oldest', 'name'] as const).map((s) => (
          <Button
            key={s}
            variant={sortBy === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSortBy(s)}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
        <div className="w-px h-6 bg-border mx-2" />
        <span className="text-sm text-muted-foreground mr-1">Access:</span>
        {[
          { value: undefined, label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'token_gate', label: 'Token-Gated' },
          { value: 'subscription', label: 'Subscription' },
        ].map((opt) => (
          <Button
            key={opt.label}
            variant={accessFilter === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setAccessFilter(opt.value)}
            className="gap-1"
          >
            {opt.value === 'token_gate' && <Lock className="h-3 w-3" />}
            {opt.value === 'subscription' && <Crown className="h-3 w-3" />}
            {opt.label}
          </Button>
        ))}
        <div className="w-px h-6 bg-border mx-2" />
        <span className="text-sm text-muted-foreground mr-1">Type:</span>
        {(
          [
            { value: undefined, label: 'All', icon: null },
            { value: 'fun', label: 'Fun', icon: Sparkles },
            { value: 'monetized', label: 'Monetized', icon: DollarSign },
          ] as const
        ).map((opt) => (
          <Button
            key={opt.label}
            variant={typeFilter === opt.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTypeFilter(opt.value)}
            className="gap-1"
          >
            {opt.icon && <opt.icon className="h-3 w-3" />}
            {opt.label}
          </Button>
        ))}
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        isEmpty={universes.length === 0}
        onRetry={() => refetch()}
        errorMessage="Failed to load universes. Please try again."
        skeletonCount={8}
        skeletonAspect="aspect-[4/5]"
        skeletonGrid="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
        emptyState={
          <div className="text-center py-16">
            <Globe className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No universes found</h3>
            <p className="text-muted-foreground">
              {search ? `No results for "${search}"` : 'No universes created yet.'}
            </p>
            <Link to="/create">
              <Button className="mt-4">Create a Universe</Button>
            </Link>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {universes.map((universe: any) => (
            <UniverseCard key={universe.id} universe={universe} />
          ))}
        </div>
      </QueryState>
    </div>
  );
}

/* ─── Universe Card ────────────────────────────────────────────── */

function UniverseCard({ universe }: { universe: any }) {
  const imageUrl = universe.portrait_image_url || universe.image_url;
  const accessModel = universe.accessModel || 'open';
  const universeType = (universe.universeType || 'monetized') as 'fun' | 'monetized';

  return (
    <Link to="/universe/$id" params={{ id: universe.id }}>
      <Card className="overflow-hidden group cursor-pointer hover:shadow-xl transition-all duration-300 hover:-translate-y-1">
        <CardContent className="p-0">
          <div className="relative aspect-[4/5] bg-muted">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={universe.name || 'Universe'}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-purple-500/20">
                <Globe className="h-16 w-16 text-muted-foreground/50" />
              </div>
            )}

            {/* Gradient overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

            {/* Access badge */}
            <div className="absolute top-3 right-3">
              {accessModel === 'token_gate' && (
                <Badge className="bg-amber-600/80 text-white border-0 backdrop-blur-sm text-xs gap-1">
                  <Lock className="h-3 w-3" /> Token-Gated
                </Badge>
              )}
              {accessModel === 'subscription' && (
                <Badge className="bg-purple-600/80 text-white border-0 backdrop-blur-sm text-xs gap-1">
                  <Crown className="h-3 w-3" /> Subscription
                </Badge>
              )}
              {accessModel === 'both' && (
                <Badge className="bg-pink-600/80 text-white border-0 backdrop-blur-sm text-xs gap-1">
                  <Lock className="h-3 w-3" /> Gated
                </Badge>
              )}
            </div>

            {/* Top-left stack: type label + multi-sig */}
            <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start">
              {universeType === 'fun' ? (
                <Badge className="bg-pink-600/80 text-white border-0 backdrop-blur-sm text-xs gap-1">
                  <Sparkles className="h-3 w-3" /> Fun
                </Badge>
              ) : (
                <Badge className="bg-emerald-600/80 text-white border-0 backdrop-blur-sm text-xs gap-1">
                  <DollarSign className="h-3 w-3" /> Monetized
                </Badge>
              )}
              {universe.isMultiSig && (
                <Badge
                  variant="outline"
                  className="bg-black/40 text-white border-white/20 backdrop-blur-sm text-xs gap-1"
                >
                  <Users className="h-3 w-3" /> Multi-Sig
                </Badge>
              )}
            </div>

            {/* Bottom info */}
            <div className="absolute bottom-0 inset-x-0 p-4">
              <h3 className="text-white font-bold text-lg line-clamp-1 group-hover:text-primary transition-colors">
                {universe.name || 'Untitled Universe'}
              </h3>
              {universe.description && (
                <p className="text-white/60 text-sm mt-1 line-clamp-2 leading-snug">
                  {universe.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-2">
                <span className="text-white/40 text-xs font-mono truncate">
                  {universe.id?.slice(0, 6)}...{universe.id?.slice(-4)}
                </span>
                {universe.tokenAddress &&
                  universe.tokenAddress !== '0x0000000000000000000000000000000000000000' && (
                    <Badge
                      variant="outline"
                      className="bg-green-500/10 text-green-400 border-green-500/30 text-[10px]"
                    >
                      Token
                    </Badge>
                  )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/* ─── Videos Tab ─────────────────────────────────────────────── */

function VideosTabContent({ search }: { search: string }) {
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(timerRef.current);
  }, [search]);

  const shortQuery = useInfiniteQuery({
    queryKey: ['videos-short', debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      trpcClient.content.feed.query({
        mediaType: 'ai-video',
        format: 'short',
        search: debouncedSearch || undefined,
        limit: 20,
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

  const allVideosQuery = useInfiniteQuery({
    queryKey: ['videos-all', debouncedSearch],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      trpcClient.content.feed.query({
        mediaType: 'video',
        search: debouncedSearch || undefined,
        limit: 12,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: any) => last.nextCursor ?? undefined,
    enabled: !debouncedSearch,
  });

  const shortItems = shortQuery.data?.pages.flatMap((p: any) => p.items) ?? [];
  const longItems = longQuery.data?.pages.flatMap((p: any) => p.items) ?? [];
  const allVideoItems = allVideosQuery.data?.pages.flatMap((p: any) => p.items) ?? [];

  const displayShort =
    shortItems.length > 0 ? shortItems : allVideoItems.filter((i: any) => !i.format);
  const displayLong = longItems;

  return (
    <div className="space-y-14">
      {/* Shorts section */}
      <section>
        <div className="flex items-center gap-2 mb-5">
          <div className="h-1 w-6 rounded-full bg-pink-500" />
          <h2 className="text-xl font-bold">Shorts</h2>
          <span className="text-xs text-muted-foreground ml-1">Clips &middot; Reels</span>
          {displayShort.length > 0 && (
            <span className="ml-auto text-sm text-muted-foreground">
              {displayShort.length} video{displayShort.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {shortQuery.isLoading ? (
          <ShortsLoadingSkeleton />
        ) : displayShort.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Play className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              {debouncedSearch ? `No shorts for "${debouncedSearch}"` : 'No shorts yet'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile: snap-scroll swipe gallery */}
            <div className="md:hidden">
              <MobileShortsGallery items={displayShort} />
            </div>
            {/* Desktop: YouTube Shorts-style player */}
            <div className="hidden md:block">
              <DesktopShortsPlayer items={displayShort} />
            </div>
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
                  Load more
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
            Episodes &amp; Features
          </span>
        </div>
      </div>

      {/* Long-form section */}
      <section>
        <div className="flex items-center gap-2 mb-5">
          <div className="h-1 w-6 rounded-full bg-blue-500" />
          <h2 className="text-xl font-bold">Episodes &amp; Features</h2>
          <span className="text-xs text-muted-foreground ml-1">Series &middot; Cinema</span>
          {displayLong.length > 0 && (
            <span className="ml-auto text-sm text-muted-foreground">
              {displayLong.length} video{displayLong.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {longQuery.isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl bg-muted animate-pulse aspect-video" />
            ))}
          </div>
        ) : displayLong.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Clapperboard className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">
              {debouncedSearch ? `No results for "${debouncedSearch}"` : 'No episodes yet'}
            </p>
          </div>
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
  );
}

/* ─── Mobile Shorts Gallery (snap-scroll swipe) ─────────────── */

function MobileShortsGallery({ items }: { items: any[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const cards = Array.from(container.children) as HTMLElement[];

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = cards.indexOf(entry.target as HTMLElement);
            if (idx !== -1) setActiveIndex(idx);
          }
        });
      },
      { root: container, threshold: 0.6 }
    );
    cards.forEach((c) => observer.observe(c));
    return () => observer.disconnect();
  }, [items]);

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="flex overflow-x-auto scrollbar-none gap-3 pb-3"
        style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
      >
        {items.map((item, i) => (
          <MobileShortCard key={item.id} item={item} isActive={i === activeIndex} />
        ))}
      </div>
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2">
          {items.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === activeIndex ? 'w-4 bg-primary' : 'w-1.5 bg-muted-foreground/30'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MobileShortCard({ item, isActive }: { item: any; isActive: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    if (!videoRef.current) return;
    if (isActive) {
      videoRef.current.play().catch(() => {});
    } else {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  }, [isActive]);

  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';

  return (
    <Link
      to="/gallery"
      className="relative flex-shrink-0 rounded-2xl overflow-hidden bg-muted border border-border/40"
      style={{
        width: 'calc(85vw)',
        maxWidth: 320,
        scrollSnapAlign: 'center',
      }}
    >
      <div className="relative" style={{ aspectRatio: '9/16' }}>
        {isVideo && item.mediaUrl ? (
          <video
            ref={videoRef}
            src={item.mediaUrl}
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
          <div className="w-full h-full flex items-center justify-center">
            <Play className="h-10 w-10 text-muted-foreground" />
          </div>
        )}

        {!isActive && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="h-12 w-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Play className="h-6 w-6 text-white fill-white" />
            </div>
          </div>
        )}

        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent p-3 pt-10">
          {item.universeId && (
            <p className="text-white/50 text-[10px] mb-0.5 truncate">
              <Globe className="h-2.5 w-2.5 inline mr-0.5" />
              {item.universeName || item.universeId.slice(0, 10) + '...'}
            </p>
          )}
          <p className="text-white text-sm font-semibold line-clamp-2 leading-tight">
            {item.title}
          </p>
          <p className="text-white/60 text-xs mt-0.5">{item.views ?? 0} views</p>
        </div>

        <div className="absolute top-2 left-2">
          <ContentLaneBadge classification={item.classification} size="sm" />
        </div>
        {(item.mediaType === 'ai-video' || item.mediaType === 'ai-image') && (
          <div className="absolute top-2 right-2">
            <span className="text-[10px] bg-purple-600/80 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
              AI
            </span>
          </div>
        )}

        {isActive && (
          <button
            className="absolute bottom-14 right-3 p-2 rounded-full bg-black/50 text-white"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMuted((m) => !m);
            }}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
        )}
      </div>
    </Link>
  );
}

/* ─── Desktop Shorts Player (YouTube Shorts-style) ──────────── */

function DesktopShortsPlayer({ items }: { items: any[] }) {
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const item = items[index];
  const isVideo = item && (item.mediaType === 'video' || item.mediaType === 'ai-video');

  const go = useCallback(
    (dir: 1 | -1) => {
      setIndex((i) => Math.max(0, Math.min(items.length - 1, i + dir)));
    },
    [items.length]
  );

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.load();
    videoRef.current.play().catch(() => {});
  }, [index]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') go(1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (!item) return null;

  return (
    <div className="flex items-center justify-center gap-6">
      <button
        onClick={() => go(-1)}
        disabled={index === 0}
        className="h-12 w-12 rounded-full border bg-background/80 backdrop-blur shadow-md flex items-center justify-center hover:bg-muted disabled:opacity-30 transition-all shrink-0"
        aria-label="Previous video"
      >
        <ChevronLeft className="h-6 w-6" />
      </button>

      <Link
        to="/gallery"
        className="relative rounded-2xl overflow-hidden bg-black shadow-2xl border border-border/30"
        style={{ width: 360, aspectRatio: '9/16' }}
      >
        {isVideo && item.mediaUrl ? (
          <video
            ref={videoRef}
            src={item.mediaUrl}
            className="w-full h-full object-cover"
            muted={muted}
            loop
            playsInline
            autoPlay
            poster={item.thumbnailUrl || undefined}
          />
        ) : item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-muted">
            <Play className="h-16 w-16 text-muted-foreground" />
          </div>
        )}

        <div className="absolute top-3 left-3 flex gap-1.5">
          <ContentLaneBadge classification={item.classification} size="sm" />
          {(item.mediaType === 'ai-video' || item.mediaType === 'ai-image') && (
            <span className="text-[10px] bg-purple-600/80 text-white px-1.5 py-0.5 rounded backdrop-blur-sm">
              AI
            </span>
          )}
        </div>

        <div className="absolute top-3 right-3">
          <span className="text-xs bg-black/50 text-white px-2 py-1 rounded-full backdrop-blur-sm">
            {index + 1} / {items.length}
          </span>
        </div>

        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-4 py-5 pt-16">
          {item.universeId && (
            <p className="text-white/50 text-xs mb-1 truncate">
              <Globe className="h-3 w-3 inline mr-1" />
              {item.universeName || item.universeId.slice(0, 10) + '...'}
            </p>
          )}
          <h3 className="text-white font-semibold text-base line-clamp-2 leading-snug">
            {item.title}
          </h3>
          {item.description && (
            <p className="text-white/60 text-xs mt-1 line-clamp-2">{item.description}</p>
          )}
          <div className="flex items-center justify-between mt-2">
            <div className="flex gap-1 flex-wrap">
              {Array.isArray(item.tags) &&
                item.tags.slice(0, 2).map((tag: string) => (
                  <span
                    key={tag}
                    className="text-[10px] bg-white/10 text-white/80 px-2 py-0.5 rounded-full backdrop-blur-sm"
                  >
                    {tag}
                  </span>
                ))}
            </div>
            <span className="text-white/50 text-xs">{item.views ?? 0} views</span>
          </div>
        </div>

        <button
          className="absolute bottom-20 right-3 p-2.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors backdrop-blur-sm"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMuted((m) => !m);
          }}
          aria-label={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
      </Link>

      <button
        onClick={() => go(1)}
        disabled={index === items.length - 1}
        className="h-12 w-12 rounded-full border bg-background/80 backdrop-blur shadow-md flex items-center justify-center hover:bg-muted disabled:opacity-30 transition-all shrink-0"
        aria-label="Next video"
      >
        <ChevronRight className="h-6 w-6" />
      </button>
    </div>
  );
}

/* ─── Long-form card (16:9) — clickable with universe context ── */

function LongCard({ item }: { item: any }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);

  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';

  return (
    <Link
      to="/gallery"
      className="rounded-xl overflow-hidden bg-muted border border-border/50 hover:border-primary/40 transition-all duration-200 hover:shadow-xl hover:-translate-y-1 cursor-pointer group block"
      onMouseEnter={() => {
        setPlaying(true);
        videoRef.current?.play().catch(() => {});
      }}
      onMouseLeave={() => {
        setPlaying(false);
        if (videoRef.current) {
          videoRef.current.pause();
          videoRef.current.currentTime = 0;
        }
      }}
    >
      <div className="relative aspect-video">
        {isVideo && item.mediaUrl ? (
          <video
            ref={videoRef}
            src={item.mediaUrl}
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

        <div
          className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity ${
            playing ? 'opacity-0' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <div className="h-12 w-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
            <Play className="h-6 w-6 text-white fill-white" />
          </div>
        </div>

        {playing && (
          <button
            className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMuted((m) => !m);
            }}
          >
            {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
        )}

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
      </div>

      <div className="p-3">
        {item.universeId && (
          <p className="text-[10px] text-muted-foreground mb-1 truncate">
            <Globe className="h-2.5 w-2.5 inline mr-0.5" />
            {item.universeName || item.universeId.slice(0, 10) + '...'}
          </p>
        )}
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
    </Link>
  );
}

/* ─── Shorts loading skeleton ────────────────────────────────── */

function ShortsLoadingSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden md:justify-center">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex-shrink-0 rounded-2xl bg-muted animate-pulse"
          style={{ width: 200, aspectRatio: '9/16' }}
        />
      ))}
    </div>
  );
}

/* ─── Creator card — links to profile ──────────────────────── */

function CreatorCard({ profile }: { profile: any }) {
  const accentColor = profile.layout?.accentColor || '#8b5cf6';

  return (
    <Link to="/profile/$username" params={{ username: profile.username }}>
      <Card className="overflow-hidden hover:shadow-lg transition-all duration-300 group cursor-pointer">
        <CardContent className="p-0">
          <div
            className="h-20 relative"
            style={{ background: `linear-gradient(135deg, ${accentColor}60, ${accentColor}20)` }}
          >
            <div className="absolute -bottom-6 left-4">
              <div className="w-12 h-12 rounded-full border-2 border-background bg-muted flex items-center justify-center text-lg font-bold overflow-hidden">
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.displayName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  profile.displayName.charAt(0).toUpperCase()
                )}
              </div>
            </div>
          </div>

          <div className="p-4 pt-8">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                {profile.displayName}
              </h3>
            </div>
            <p className="text-sm text-muted-foreground">@{profile.username}</p>

            {profile.bio && (
              <p className="text-sm text-muted-foreground mt-2 line-clamp-2">{profile.bio}</p>
            )}

            <div className="flex flex-wrap gap-1 mt-3">
              {Array.isArray(profile.tags) &&
                profile.tags.slice(0, 4).map((tag: string) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t">
              <span className="text-xs text-muted-foreground">
                {profile.contentCount || 0} works
              </span>
              <Badge
                variant="secondary"
                className="text-xs"
                style={{ backgroundColor: `${accentColor}20`, color: accentColor }}
              >
                {profile.layout?.theme || 'default'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

/* ─── Content feed card — clickable with universe context ───── */

function ContentFeedCard({ item }: { item: any }) {
  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';

  return (
    <Link to="/gallery">
      <Card className="overflow-hidden group cursor-pointer hover:shadow-lg transition-all duration-300">
        <CardContent className="p-0">
          <div className="relative aspect-video bg-muted">
            {item.thumbnailUrl ? (
              <img
                src={item.thumbnailUrl}
                alt={item.title}
                className="w-full h-full object-cover"
              />
            ) : isVideo ? (
              <video
                src={item.mediaUrl}
                className="w-full h-full object-cover"
                muted
                preload="metadata"
              />
            ) : (
              <img src={item.mediaUrl} alt={item.title} className="w-full h-full object-cover" />
            )}
            {isVideo && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity">
                <Play className="h-10 w-10 text-white" />
              </div>
            )}
            <div className="absolute top-2 right-2">
              <ContentLaneBadge
                classification={
                  item.classification === 'fan' || item.classification === 'licensed'
                    ? item.classification
                    : 'original'
                }
                reviewStatus={item.reviewStatus}
                size="sm"
              />
            </div>
            <div className="absolute bottom-2 left-2">
              <Badge variant="outline" className="text-xs bg-black/40 text-white border-0">
                {item.mediaType === 'ai-video'
                  ? 'AI Video'
                  : item.mediaType === 'ai-image'
                    ? 'AI Image'
                    : item.mediaType}
              </Badge>
            </div>
          </div>

          <div className="p-3">
            {item.universeId && (
              <p className="text-[10px] text-muted-foreground mb-1 truncate">
                <Globe className="h-2.5 w-2.5 inline mr-0.5" />
                {item.universeName || item.universeId.slice(0, 10) + '...'}
              </p>
            )}
            <h3 className="font-medium truncate">{item.title}</h3>
            {item.description && (
              <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{item.description}</p>
            )}
            <div className="flex items-center justify-between mt-2">
              <div className="flex gap-1">
                {Array.isArray(item.tags) &&
                  item.tags.slice(0, 2).map((tag: string) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
              </div>
              <span className="text-xs text-muted-foreground">{item.views ?? 0} views</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
