/**
 * Dashboard Route
 *
 * Authenticated user dashboard showing owned/available narrative universes,
 * an AI media generation section, and navigation to create new universes.
 * Redirects to /login when unauthenticated.
 */

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Play,
  Users,
  Calendar,
  Plus,
  Wand2,
  Film,
  ShoppingBag,
  TrendingUp,
  Upload,
  Search,
  Grid3x3,
  List,
  Trash2,
  Eye,
  EyeOff,
  Globe,
  Image as ImageIcon,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GenerativeMedia } from '@/components/GenerativeMedia';
import { QuestsPanel } from '@/components/QuestsPanel';
import { DailyCheckin } from '@/components/DailyCheckin';
import { MonetizationOverview } from '@/components/MonetizationOverview';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';
import { UploadForm } from '@/components/UploadForm';
import { useMyNFTs } from '@/hooks/useRevenue';
import { toast } from 'sonner';

import { useWalletAuth } from '@/lib/wallet-auth';
import { useEffect, useState, useMemo } from 'react';

export const Route = createFileRoute('/dashboard')({
  component: RouteComponent,
});

function RouteComponent() {
  const { address, isConnected, isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = Route.useNavigate();

  // Redirect unauthenticated users to login
  useEffect(() => {
    if (!isConnected && !isAuthenticating) {
      navigate({ to: '/login', search: { redirect: '/dashboard' } });
    }
  }, [isConnected, isAuthenticating, navigate]);

  // Fetch user's universes (by creator address)
  const { data: myUniverses, isLoading: isLoadingMine } = useQuery({
    queryKey: ['my-universes', address],
    queryFn: () => trpcClient.cinematicUniverses.getByCreator.query({ creator: address! }),
    enabled: !!address,
  });

  // Fetch all universes for discovery
  const { data: allUniverses, isLoading: isLoadingAll } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.cinematicUniverses.getAll.query(),
  });

  const isLoading = isLoadingMine || isLoadingAll;

  const selectUniverse = (universeId: string) => {
    navigate({
      to: '/universe/$id',
      params: { id: universeId },
    });
  };

  const createNewUniverse = () => {
    navigate({
      to: '/cinematicUniverseCreate',
    });
  };

  if (isAuthenticating || !isConnected) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Connecting...</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading universes...</p>
        </div>
      </div>
    );
  }

  const myUniverseList: any[] = (myUniverses as any)?.data ?? [];
  const allUniverseList: any[] = (allUniverses as any)?.data ?? [];
  const otherUniverses = allUniverseList.filter(
    (u: any) => !myUniverseList.some((m: any) => m.id === u.id)
  );
  const universes = [...myUniverseList, ...otherUniverses];

  return (
    <div className="min-h-screen bg-background">
      {/* Dashboard Header */}
      <div className="border-b bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                Welcome back{address ? `, ${address.slice(0, 6)}...${address.slice(-4)}` : ''}
              </h1>
              <p className="text-muted-foreground">Select a narrative universe to explore</p>
            </div>
            <Button onClick={createNewUniverse} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Create Universe
            </Button>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8 flex gap-8">
        {/* Main Content */}
        <div className="flex-1 min-w-0">
          {/* Featured Universe Section */}
          {universes.length > 0 && (
            <section className="mb-12">
              <h2 className="text-xl font-semibold mb-6">Featured Universe</h2>
              <div className="relative">
                <Card
                  className="cursor-pointer hover:shadow-lg transition-all duration-300 overflow-hidden h-64 bg-gradient-to-r from-blue-600 to-purple-600"
                  onClick={() => selectUniverse(universes[0].id)}
                >
                  <CardContent className="p-0 h-full relative">
                    <div className="absolute inset-0 bg-black/40" />
                    <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
                      <h3 className="text-2xl font-bold mb-2">{universes[0].name}</h3>
                      <p className="text-sm opacity-90 mb-4">
                        {universes[0].description || 'A captivating narrative universe awaits'}
                      </p>
                      <Button
                        variant="secondary"
                        className="flex items-center gap-2"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectUniverse(universes[0].id);
                        }}
                      >
                        <Play className="h-4 w-4" />
                        Enter Timeline
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>
          )}

          {/* Monetization Overview */}
          <MonetizationOverview />

          {/* Creator Earnings Summary */}
          <CreatorEarnings />

          {/* Upload */}
          <UploadSection />

          {/* My Works */}
          <MyWorksSection />

          {/* AI Media Generation Section */}
          <section className="mb-12">
            <div className="flex items-center gap-2 mb-6">
              <Wand2 className="h-5 w-5" />
              <h2 className="text-xl font-semibold">AI Media Generation</h2>
            </div>
            <GenerativeMedia />
          </section>

          {/* Your Universes */}
          <section className="mb-12">
            <h2 className="text-xl font-semibold mb-6">Your Universes</h2>
            {myUniverseList.length === 0 ? (
              <div className="text-center py-12">
                <div className="mb-4">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">No universes yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first narrative universe to get started
                </p>
                <Button onClick={createNewUniverse} className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Create Your First Universe
                </Button>
              </div>
            ) : (
              <UniverseGrid universes={myUniverseList} onSelect={selectUniverse} />
            )}
          </section>

          {/* Other Universes */}
          {otherUniverses.length > 0 && (
            <section>
              <h2 className="text-xl font-semibold mb-6">Explore All Universes</h2>
              <UniverseGrid universes={otherUniverses} onSelect={selectUniverse} />
            </section>
          )}
        </div>

        {/* Sidebar — Check-in + Quests & Rewards */}
        <aside className="hidden lg:block w-80 flex-shrink-0">
          <div className="sticky top-20 space-y-4">
            <DailyCheckin />
            <QuestsPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}

function CreatorEarnings() {
  const { data: myNfts, isLoading } = useMyNFTs();

  const episodesListed = myNfts?.createdEpisodes?.length ?? 0;
  const totalMinted =
    myNfts?.createdEpisodes?.reduce((sum: number, ep: any) => sum + (ep.minted || 0), 0) ?? 0;
  const nftsCollected = myNfts?.mintedEpisodes?.length ?? 0;

  if (isLoading) return null;
  if (episodesListed === 0 && nftsCollected === 0) return null;

  return (
    <section className="mb-12">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="h-5 w-5" />
        <h2 className="text-xl font-semibold">Creator Earnings</h2>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Film className="h-4 w-4" />
              <span className="text-sm">Episodes Listed</span>
            </div>
            <p className="text-2xl font-bold">{episodesListed}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <ShoppingBag className="h-4 w-4" />
              <span className="text-sm">Total Tokenized</span>
            </div>
            <p className="text-2xl font-bold">{totalMinted}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Film className="h-4 w-4" />
              <span className="text-sm">Episodes Owned</span>
            </div>
            <p className="text-2xl font-bold">{nftsCollected}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function UploadSection() {
  const [open, setOpen] = useState(false);

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          <h2 className="text-xl font-semibold">Upload Content</h2>
        </div>
        <Button
          variant={open ? 'secondary' : 'default'}
          size="sm"
          className="gap-2"
          onClick={() => setOpen((v) => !v)}
        >
          <Upload className="h-4 w-4" />
          {open ? 'Close' : 'Upload New'}
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {open && <UploadForm onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} />}
    </section>
  );
}

type Classification = 'all' | 'fan' | 'original' | 'licensed';

const VISIBILITY_ICONS: Record<string, React.ReactNode> = {
  public: <Globe className="h-3 w-3" />,
  unlisted: <Eye className="h-3 w-3" />,
  private: <EyeOff className="h-3 w-3" />,
};

const MEDIA_ICONS: Record<string, React.ReactNode> = {
  video: <Film className="h-3 w-3" />,
  'ai-video': <Film className="h-3 w-3" />,
  image: <ImageIcon className="h-3 w-3" />,
  'ai-image': <ImageIcon className="h-3 w-3" />,
};

function MyWorksSection() {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<Classification>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['my-content-dashboard', classFilter],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      trpcClient.content.myContent.query({
        classification: classFilter === 'all' ? undefined : classFilter,
        limit: 24,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: any) => lastPage.nextCursor ?? undefined,
    enabled: isAuthenticated,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => trpcClient.content.delete.mutate({ id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-content-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['my-content'] });
      toast.success('Content deleted');
    },
    onError: (err: any) => toast.error(err.message || 'Delete failed'),
  });

  const allItems = useMemo(() => data?.pages.flatMap((p: any) => p.items) ?? [], [data]);

  const filtered = useMemo(() => {
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter(
      (item: any) =>
        item.title?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.tags?.some((t: string) => t.toLowerCase().includes(q))
    );
  }, [allItems, search]);

  if (!isAuthenticated) return null;

  return (
    <section className="mb-12">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold">My Works</h2>
          {allItems.length > 0 && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {allItems.length} item{allItems.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search your works..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          {(['all', 'fan', 'original', 'licensed'] as Classification[]).map((c) => (
            <button
              key={c}
              onClick={() => setClassFilter(c)}
              className={`px-3 py-1 rounded text-xs font-medium transition-colors capitalize ${
                classFilter === c
                  ? 'bg-background shadow text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 bg-muted/50 rounded-md p-1">
          <Button
            variant={viewMode === 'grid' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            className="h-8 w-8 p-0"
          >
            <Grid3x3 className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            className="h-8 w-8 p-0"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border rounded-lg border-dashed">
          <Film className="h-10 w-10 text-muted-foreground mb-3" />
          <h3 className="font-medium mb-1">
            {allItems.length === 0 ? 'No works yet' : 'No results'}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {allItems.length === 0
              ? 'Upload your first video or image to get started'
              : 'Try a different search or filter'}
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filtered.map((item: any) => (
            <DashboardContentCard
              key={item.id}
              item={item}
              onDelete={() => deleteMutation.mutate(item.id)}
              deleting={deleteMutation.isPending && deleteMutation.variables === item.id}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((item: any) => (
            <DashboardContentRow
              key={item.id}
              item={item}
              onDelete={() => deleteMutation.mutate(item.id)}
              deleting={deleteMutation.isPending && deleteMutation.variables === item.id}
            />
          ))}
        </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center mt-6">
          <Button
            variant="outline"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="gap-2"
          >
            {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
            Load More
          </Button>
        </div>
      )}
    </section>
  );
}

function DashboardContentCard({
  item,
  onDelete,
  deleting,
}: {
  item: any;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';
  return (
    <Card className="group overflow-hidden">
      <div className="aspect-video bg-muted relative">
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
        ) : isVideo && item.mediaUrl ? (
          <video
            src={item.mediaUrl}
            className="w-full h-full object-cover"
            muted
            loop
            onMouseEnter={(e) => e.currentTarget.play()}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
        ) : item.mediaUrl ? (
          <img src={item.mediaUrl} alt={item.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground text-xs">
            No preview
          </div>
        )}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            onClick={onDelete}
            disabled={deleting}
            className="p-2 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-50"
            title="Delete"
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="absolute bottom-2 left-2">
          <ContentLaneBadge classification={item.classification} size="sm" />
        </div>
        <div className="absolute top-2 right-2">
          <span className="text-xs bg-black/60 text-white px-1.5 py-0.5 rounded capitalize">
            {item.visibility}
          </span>
        </div>
      </div>
      <div className="p-2.5">
        <p className="text-xs font-medium line-clamp-1">{item.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}
        </p>
      </div>
    </Card>
  );
}

function DashboardContentRow({
  item,
  onDelete,
  deleting,
}: {
  item: any;
  onDelete: () => void;
  deleting: boolean;
}) {
  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';
  return (
    <Card className="p-4">
      <div className="flex gap-4 items-center">
        <div className="w-28 h-16 bg-muted rounded-md overflow-hidden flex-shrink-0">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : isVideo && item.mediaUrl ? (
            <video src={item.mediaUrl} className="w-full h-full object-cover" muted />
          ) : item.mediaUrl ? (
            <img src={item.mediaUrl} alt={item.title} className="w-full h-full object-cover" />
          ) : null}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-sm truncate">{item.title}</h3>
            <ContentLaneBadge classification={item.classification} size="sm" />
          </div>
          <p className="text-xs text-muted-foreground line-clamp-1 mb-2">
            {item.description || 'No description'}
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 capitalize">
              {VISIBILITY_ICONS[item.visibility]}
              {item.visibility}
            </span>
            <span className="flex items-center gap-1">
              {MEDIA_ICONS[item.mediaType]}
              {item.mediaType}
            </span>
            <span>{item.views ?? 0} views</span>
            <span>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</span>
          </div>
          {item.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.slice(0, 5).map((tag: string) => (
                <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={onDelete}
          disabled={deleting}
          className="p-2 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50 flex-shrink-0"
          title="Delete"
        >
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </Card>
  );
}

function UniverseGrid({
  universes,
  onSelect,
}: {
  universes: any[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {universes.map((universe: any) => (
        <Card
          key={universe.id}
          className="cursor-pointer hover:shadow-lg transition-all duration-300 group overflow-hidden"
          onClick={() => onSelect(universe.id)}
        >
          <CardContent className="p-0">
            <div className="h-32 bg-gradient-to-br from-indigo-500 to-purple-600 relative">
              {universe.imageUrl && (
                <img
                  src={universe.imageUrl}
                  alt={universe.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-black/20" />
              <div className="absolute top-2 right-2">
                <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                  <Calendar className="h-4 w-4 text-white" />
                </div>
              </div>
              <div className="absolute bottom-2 left-2">
                <div className="text-white text-xs bg-black/40 px-2 py-1 rounded">
                  Active Timeline
                </div>
              </div>
            </div>
            <div className="p-4">
              <h3 className="font-semibold truncate group-hover:text-primary transition-colors">
                {universe.name}
              </h3>
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {universe.description || 'Explore this narrative universe'}
              </p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-muted-foreground">
                  {universe.createdAt
                    ? `Created ${new Date(universe.createdAt).toLocaleDateString()}`
                    : ''}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(universe.id);
                  }}
                >
                  <Play className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
