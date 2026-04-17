/**
 * My Works — User's personal content gallery
 *
 * Shows all content the authenticated user has uploaded, with grid/list
 * view, classification filter tabs, search, and delete actions.
 */
import { createFileRoute, useNavigate, Link, redirect } from '@tanstack/react-router';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Grid3x3,
  List,
  Upload,
  Trash2,
  Eye,
  EyeOff,
  Globe,
  Film,
  Image as ImageIcon,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { MintContentDialog } from '@/components/MintContentDialog';
import { useVocab } from '@/hooks/use-vocab';

export const Route = createFileRoute('/my-works')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/my-works' } });
    }
  },
  component: MyWorksPage,
});

type Classification = 'all' | 'fan' | 'original' | 'licensed';

const VISIBILITY_ICONS = {
  public: <Globe className="h-3 w-3" />,
  unlisted: <Eye className="h-3 w-3" />,
  private: <EyeOff className="h-3 w-3" />,
};

const MEDIA_ICONS = {
  video: <Film className="h-3 w-3" />,
  'ai-video': <Film className="h-3 w-3" />,
  image: <ImageIcon className="h-3 w-3" />,
  'ai-image': <ImageIcon className="h-3 w-3" />,
};

function MyWorksPage() {
  const { isAuthenticated, isAuthenticating } = useWalletAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isAuthenticated && !isAuthenticating) {
      navigate({ to: '/login', search: { redirect: '/my-works' } });
    }
  }, [isAuthenticated, isAuthenticating, navigate]);

  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState<Classification>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [mintingItem, setMintingItem] = useState<any>(null);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['my-content', classFilter],
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
        (Array.isArray(item.tags) && item.tags.some((t: string) => t.toLowerCase().includes(q)))
    );
  }, [allItems, search]);

  if (isAuthenticating) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">My Works</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {allItems.length} item{allItems.length !== 1 ? 's' : ''} uploaded
            </p>
          </div>
          <Button asChild className="gap-2">
            <Link to="/upload" search={{}}>
              <Upload className="h-4 w-4" />
              Upload New
            </Link>
          </Button>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search your works..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Classification filter */}
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

          {/* View mode */}
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
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Film className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {allItems.length === 0 ? 'No works yet' : 'No results'}
            </h3>
            <p className="text-muted-foreground text-sm mb-6">
              {allItems.length === 0
                ? 'Upload your first video or image to get started'
                : 'Try a different search or filter'}
            </p>
            {allItems.length === 0 && (
              <Button asChild className="gap-2">
                <Link to="/upload" search={{}}>
                  <Upload className="h-4 w-4" />
                  Upload Content
                </Link>
              </Button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {filtered.map((item: any) => (
              <ContentCard
                key={item.id}
                item={item}
                onDelete={() => deleteMutation.mutate(item.id)}
                deleting={deleteMutation.isPending && deleteMutation.variables === item.id}
                onMint={() => setMintingItem(item)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((item: any) => (
              <ContentRow
                key={item.id}
                item={item}
                onDelete={() => deleteMutation.mutate(item.id)}
                deleting={deleteMutation.isPending && deleteMutation.variables === item.id}
                onMint={() => setMintingItem(item)}
              />
            ))}
          </div>
        )}

        {/* Load more */}
        {hasNextPage && (
          <div className="flex justify-center mt-8">
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
      </div>

      {/* Mint dialog */}
      {mintingItem && (
        <MintContentDialog
          contentId={mintingItem.id}
          contentTitle={mintingItem.title}
          universeId={mintingItem.universeId}
          onClose={() => setMintingItem(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ['my-content'] })}
        />
      )}
    </div>
  );
}

function ContentCard({
  item,
  onDelete,
  deleting,
  onMint,
}: {
  item: any;
  onDelete: () => void;
  deleting: boolean;
  onMint: () => void;
}) {
  const v = useVocab();
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
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            No preview
          </div>
        )}

        {/* Overlay on hover */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            onClick={onMint}
            className="p-2 rounded-full bg-amber-600 text-white hover:bg-amber-500 transition-colors"
            title={v('mint-as-nft')}
          >
            <Sparkles className="h-4 w-4" />
          </button>
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

        {/* Badges */}
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

function ContentRow({
  item,
  onDelete,
  deleting,
  onMint,
}: {
  item: any;
  onDelete: () => void;
  deleting: boolean;
  onMint: () => void;
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
              {VISIBILITY_ICONS[item.visibility as keyof typeof VISIBILITY_ICONS]}
              {item.visibility}
            </span>
            <span className="flex items-center gap-1">
              {MEDIA_ICONS[item.mediaType as keyof typeof MEDIA_ICONS]}
              {item.mediaType}
            </span>
            <span>{item.views ?? 0} views</span>
            <span>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</span>
          </div>
          {Array.isArray(item.tags) && item.tags.length > 0 && (
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
          onClick={onMint}
          className="p-2 rounded-md text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors flex-shrink-0"
          title="Mint as NFT"
        >
          <Sparkles className="h-4 w-4" />
        </button>
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
