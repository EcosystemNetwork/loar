/**
 * My Bounties — Dashboard for bounties you posted and submissions you made.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Target,
  Clock,
  Coins,
  ArrowLeft,
  Trophy,
  Loader2,
  Upload,
  ExternalLink,
} from 'lucide-react';
import { useAccount } from 'wagmi';
import { trpcClient } from '@/utils/trpc';
import { useQuery } from '@tanstack/react-query';

export const Route = createFileRoute('/bounties/mine')({
  component: MyBountiesPage,
});

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-green-500/10 text-green-500 border-green-500/20',
  claimed: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  cancelled: 'bg-red-500/10 text-red-500 border-red-500/20',
  expired: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
  pending: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  accepted: 'bg-green-500/10 text-green-500 border-green-500/20',
  rejected: 'bg-red-500/10 text-red-500 border-red-500/20',
};

function MyBountiesPage() {
  const { address } = useAccount();
  const [tab, setTab] = useState('posted');

  const { data: myBounties, isLoading: bountiesLoading } = useQuery({
    queryKey: ['my-bounties'],
    queryFn: () => trpcClient.bounties.myBounties.query(),
    enabled: !!address,
  });

  const { data: mySubmissions, isLoading: subsLoading } = useQuery({
    queryKey: ['my-submissions'],
    queryFn: () => trpcClient.bounties.mySubmissions.query(),
    enabled: !!address,
  });

  if (!address) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <Target className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Connect your wallet</h2>
        <p className="text-muted-foreground">Sign in to see your bounties and submissions.</p>
      </div>
    );
  }

  const openCount = myBounties?.filter((b: any) => b.status === 'open').length ?? 0;
  const totalPosted = myBounties?.reduce((sum: number, b: any) => sum + (b.reward || 0), 0) ?? 0;
  const totalEarned = mySubmissions?.filter((s: any) => s.status === 'accepted').length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <Link
          to="/bounties"
          search={{}}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Bounties
        </Link>

        <h1 className="text-2xl font-bold mb-6">My Bounties</h1>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{myBounties?.length ?? 0}</p>
                <p className="text-xs text-muted-foreground">Posted</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10">
                <Coins className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalPosted.toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">$LOAR Posted</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Trophy className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalEarned}</p>
                <p className="text-xs text-muted-foreground">Won</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="posted">Posted ({myBounties?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="submitted">Submitted ({mySubmissions?.length ?? 0})</TabsTrigger>
          </TabsList>

          {/* Posted bounties tab */}
          <TabsContent value="posted">
            {bountiesLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !myBounties?.length ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Target className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground mb-3">You haven't posted any bounties yet.</p>
                  <Link to="/bounties" search={{}}>
                    <Button variant="outline">Browse Bounties</Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {myBounties.map((bounty: any) => (
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
                              <Badge className={STATUS_STYLES[bounty.status] || ''}>
                                {bounty.status}
                              </Badge>
                              <Badge variant="outline" className="capitalize text-[10px]">
                                {bounty.contentType}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />{' '}
                                {new Date(bounty.deadline).toLocaleDateString()}
                              </span>
                              <span>{bounty.submissionCount || 0} submissions</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 text-lg font-bold text-primary">
                            <Coins className="h-4 w-4" />
                            {bounty.reward?.toLocaleString()}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Submissions tab */}
          <TabsContent value="submitted">
            {subsLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !mySubmissions?.length ? (
              <Card>
                <CardContent className="text-center py-12">
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-muted-foreground mb-3">
                    You haven't submitted to any bounties yet.
                  </p>
                  <Link to="/bounties" search={{}}>
                    <Button variant="outline">Find Bounties</Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {mySubmissions.map((sub: any) => (
                  <Link
                    key={sub.id}
                    to="/bounties/$bountyId"
                    params={{ bountyId: sub.bountyId }}
                    className="block"
                  >
                    <Card className="hover:border-primary/30 transition-colors cursor-pointer">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={STATUS_STYLES[sub.status] || ''}>
                                {sub.status}
                              </Badge>
                              {sub.status === 'accepted' && (
                                <Trophy className="h-4 w-4 text-amber-500" />
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-1">
                              {sub.description}
                            </p>
                            {sub.contentUrl && (
                              <a
                                href={sub.contentUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" /> View content
                              </a>
                            )}
                            <p className="text-xs text-muted-foreground mt-1">
                              {new Date(sub.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
