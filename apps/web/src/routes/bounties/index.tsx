/**
 * Story Bounties Page — Post and claim $LOAR bounties for content.
 *
 * Creators post bounties for specific content needs (videos, art, stories, etc.)
 * and community members submit work to earn $LOAR rewards.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Target,
  Plus,
  Clock,
  Coins,
  Search,
  Trophy,
  Loader2,
  Users,
  Flame,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useStoryBountiesWrite } from '@/hooks/useStoryBounties';
import { keccak256, parseUnits, toHex } from 'viem';
import { toast } from 'sonner';

export const Route = createFileRoute('/bounties/')({
  component: BountiesPage,
  validateSearch: (search: Record<string, unknown>): { universeId?: string } => ({
    ...(search.universeId ? { universeId: search.universeId as string } : {}),
  }),
});

const CONTENT_TYPES = [
  'video',
  'story',
  'character',
  'art',
  'music',
  'voiceover',
  'lore',
  'other',
] as const;

function BountiesPage() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const { universeId } = Route.useSearch();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [reward, setReward] = useState('');
  const [contentType, setContentType] = useState<string>('video');
  const [deadlineDays, setDeadlineDays] = useState('14');

  const {
    data: bounties,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['bounties', filterType, universeId],
    queryFn: () =>
      trpcClient.bounties.list.query({
        status: 'open',
        contentType: filterType || undefined,
        universeId,
        limit: 50,
      }),
  });

  const { data: stats } = useQuery({
    queryKey: ['bounty-stats'],
    queryFn: () => trpcClient.bounties.stats.query(),
  });

  const bountiesWrite = useStoryBountiesWrite();

  /**
   * Two-phase create:
   *   1. Lock $LOAR escrow on-chain via createBounty (Circle DCW server-signed).
   *   2. Record the off-chain bounty doc with the resulting tx hash.
   *
   * Phase 1 is skipped when universeId isn't a numeric on-chain id — happens
   * during early testing on universes that haven't been minted yet. The
   * Firestore-only path remains valid; the on-chain escrow is the new layer.
   */
  const createMutation = useMutation({
    mutationFn: async (data: {
      universeId?: string;
      reward: number;
      title: string;
      description: string;
      contentType:
        | 'video'
        | 'story'
        | 'character'
        | 'art'
        | 'music'
        | 'voiceover'
        | 'lore'
        | 'other';
      deadlineDays: number;
    }) => {
      let txHash: string | undefined;
      try {
        const numericUniverseId = Number(data.universeId);
        if (Number.isFinite(numericUniverseId) && numericUniverseId > 0) {
          const deadline = BigInt(Math.floor(Date.now() / 1000) + data.deadlineDays * 86400);
          const descriptionHash = keccak256(toHex(data.description));
          txHash = await bountiesWrite.createBounty({
            universeId: BigInt(numericUniverseId),
            reward: parseUnits(data.reward.toString(), 18),
            title: data.title,
            descriptionHash,
            contentType: data.contentType,
            deadline,
          });
        }
      } catch (err) {
        toast.error(
          `On-chain escrow failed: ${err instanceof Error ? err.message : 'unknown error'}`
        );
        throw err;
      }

      return trpcClient.bounties.create.mutate({ ...data, txHash });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bounties'] });
      queryClient.invalidateQueries({ queryKey: ['bounty-stats'] });
      setShowCreate(false);
      setTitle('');
      setDescription('');
      setReward('');
      toast.success('Bounty posted');
    },
  });

  const filtered = bounties?.filter((b: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return b.title?.toLowerCase().includes(q) || b.description?.toLowerCase().includes(q);
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Target className="h-8 w-8 text-primary" />
              <h1 className="text-3xl md:text-4xl font-bold">Story Bounties</h1>
            </div>
            <p className="text-muted-foreground">
              Post $LOAR bounties for content you need. Community creates, you approve, $LOAR flows.
            </p>
            {universeId && (
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="text-xs font-mono">
                  Universe: {universeId.slice(0, 6)}...{universeId.slice(-4)}
                </Badge>
                <Link to="/bounties" search={{}}>
                  <Badge variant="secondary" className="cursor-pointer text-xs">
                    Clear filter
                  </Badge>
                </Link>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Link to="/bounties/mine">
              <Button variant="outline" size="lg" className="gap-2">
                <Trophy className="h-5 w-5" />
                My Bounties
              </Button>
            </Link>
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
              <DialogTrigger asChild>
                <Button size="lg" className="font-bold gap-2">
                  <Plus className="h-5 w-5" />
                  Post Bounty
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Post a Bounty</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Title</Label>
                    <Input
                      placeholder="e.g., Need a villain origin story"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Description</Label>
                    <Textarea
                      placeholder="Describe exactly what you need..."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="min-h-[100px]"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Reward ($LOAR)</Label>
                      <Input
                        type="number"
                        placeholder="100"
                        value={reward}
                        onChange={(e) => setReward(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label>Deadline (days)</Label>
                      <Input
                        type="number"
                        value={deadlineDays}
                        onChange={(e) => setDeadlineDays(e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Content Type</Label>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {CONTENT_TYPES.map((type) => (
                        <Badge
                          key={type}
                          variant={contentType === type ? 'default' : 'outline'}
                          className="cursor-pointer capitalize"
                          onClick={() => setContentType(type)}
                        >
                          {type}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <Button
                    className="w-full"
                    disabled={!title || !description || !reward || createMutation.isPending}
                    onClick={() =>
                      createMutation.mutate({
                        title,
                        description,
                        reward: Number(reward),
                        contentType: contentType as any,
                        deadlineDays: Number(deadlineDays),
                        ...(universeId ? { universeId } : {}),
                      })
                    }
                  >
                    {createMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Coins className="h-4 w-4 mr-2" />
                    )}
                    Post Bounty ({reward || '0'} $LOAR)
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.total ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total Bounties</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Flame className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats?.open ?? 0}</p>
                <p className="text-xs text-muted-foreground">Open Now</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Coins className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{(stats?.totalReward ?? 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">$LOAR in Bounties</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search + Filter */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search bounties..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            <Badge
              variant={!filterType ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setFilterType(null)}
            >
              All
            </Badge>
            {CONTENT_TYPES.map((type) => (
              <Badge
                key={type}
                variant={filterType === type ? 'default' : 'outline'}
                className="cursor-pointer capitalize"
                onClick={() => setFilterType(type)}
              >
                {type}
              </Badge>
            ))}
          </div>
        </div>

        {/* Bounty List */}
        {isError ? (
          <div className="p-8 text-center text-red-400">Failed to load data. Please try again.</div>
        ) : isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !filtered?.length ? (
          <Card>
            <CardContent className="text-center py-16">
              <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No bounties found</h3>
              <p className="text-muted-foreground mb-4">Be the first to post a bounty!</p>
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 mr-2" /> Post Bounty
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((bounty: any) => (
              <Link
                key={bounty.id}
                to="/bounties/$bountyId"
                params={{ bountyId: bounty.id }}
                className="block"
              >
                <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold truncate">{bounty.title}</h3>
                          <Badge variant="outline" className="capitalize text-[10px]">
                            {bounty.contentType}
                          </Badge>
                          {bounty.status === 'open' && (
                            <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-[10px]">
                              Open
                            </Badge>
                          )}
                          {bounty.status === 'claimed' && (
                            <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-[10px]">
                              Claimed
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
                          {bounty.description}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />{' '}
                            {new Date(bounty.deadline).toLocaleDateString()}
                          </span>
                          <span className="flex items-center gap-1">
                            <Users className="h-3 w-3" /> {bounty.submissionCount || 0} submissions
                          </span>
                          <span className="font-mono">
                            {bounty.poster?.slice(0, 6)}...{bounty.poster?.slice(-4)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="flex items-center gap-1 text-xl font-bold text-primary">
                          <Coins className="h-5 w-5" />
                          {bounty.reward?.toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground">$LOAR</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
