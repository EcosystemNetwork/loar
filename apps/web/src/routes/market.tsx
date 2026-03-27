/**
 * Market Route — Full revenue hub
 *
 * Central marketplace for all LOAR revenue streams:
 * Episode NFTs, Character NFTs, Canon Marketplace, Credits, Subscriptions,
 * Collabs, Ad Placements, Licensing, Merch, and Analytics
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Film,
  Users,
  Gavel,
  Coins,
  Crown,
  Handshake,
  Megaphone,
  FileText,
  ShoppingBag,
  BarChart3,
  TrendingUp,
  Sparkles,
  ArrowRight,
  Loader2,
  Plus,
  ThumbsUp,
  ThumbsDown,
  CheckCircle,
} from 'lucide-react';

import { trpcClient, queryClient } from '@/utils/trpc';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useWalletAuth } from '@/lib/wallet-auth';

export const Route = createFileRoute('/market')({
  component: MarketPage,
});

function MarketPage() {
  const { data: platformStats } = useQuery({
    queryKey: ['platform-stats'],
    queryFn: () => trpcClient.analytics.getPlatformStats.query(),
  });

  const { data: trending } = useQuery({
    queryKey: ['trending'],
    queryFn: () => trpcClient.analytics.getTrending.query({ limit: 5 }),
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-7xl">
        {/* Hero Stats */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">LOAR Marketplace</h1>
          <p className="text-muted-foreground text-lg">
            The decentralized Hollywood — own, trade, and monetize AI-generated story universes
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <StatCard
              label="Universes"
              value={platformStats?.universeCount ?? 0}
              icon={<Sparkles className="w-5 h-5" />}
            />
            <StatCard
              label="Total Views"
              value={platformStats?.totalViews ?? 0}
              icon={<BarChart3 className="w-5 h-5" />}
            />
            <StatCard
              label="NFTs Minted"
              value={platformStats?.totalMints ?? 0}
              icon={<Film className="w-5 h-5" />}
            />
            <StatCard
              label="Total Revenue"
              value={`${formatWei(platformStats?.totalRevenue ?? '0')} ETH`}
              icon={<TrendingUp className="w-5 h-5" />}
            />
          </div>
        </div>

        {/* Revenue Streams Grid */}
        <Tabs defaultValue="nfts" className="space-y-6">
          <TabsList className="grid grid-cols-5 lg:grid-cols-10 w-full h-auto">
            <TabsTrigger value="nfts" className="text-xs">
              <Film className="w-3 h-3 mr-1" />
              NFTs
            </TabsTrigger>
            <TabsTrigger value="characters" className="text-xs">
              <Users className="w-3 h-3 mr-1" />
              Characters
            </TabsTrigger>
            <TabsTrigger value="canon" className="text-xs">
              <Gavel className="w-3 h-3 mr-1" />
              Canon
            </TabsTrigger>
            <TabsTrigger value="credits" className="text-xs">
              <Coins className="w-3 h-3 mr-1" />
              Credits
            </TabsTrigger>
            <TabsTrigger value="subs" className="text-xs">
              <Crown className="w-3 h-3 mr-1" />
              Subscribe
            </TabsTrigger>
            <TabsTrigger value="collabs" className="text-xs">
              <Handshake className="w-3 h-3 mr-1" />
              Collabs
            </TabsTrigger>
            <TabsTrigger value="ads" className="text-xs">
              <Megaphone className="w-3 h-3 mr-1" />
              Ads
            </TabsTrigger>
            <TabsTrigger value="licensing" className="text-xs">
              <FileText className="w-3 h-3 mr-1" />
              License
            </TabsTrigger>
            <TabsTrigger value="merch" className="text-xs">
              <ShoppingBag className="w-3 h-3 mr-1" />
              Merch
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs">
              <BarChart3 className="w-3 h-3 mr-1" />
              Data
            </TabsTrigger>
          </TabsList>

          {/* Episode NFTs */}
          <TabsContent value="nfts">
            <EpisodeNFTsTab />
          </TabsContent>

          {/* Character NFTs */}
          <TabsContent value="characters">
            <CharacterNFTsTab />
          </TabsContent>

          {/* Canon Marketplace */}
          <TabsContent value="canon">
            <CanonMarketplaceTab />
          </TabsContent>

          {/* Credits */}
          <TabsContent value="credits">
            <CreditsTab />
          </TabsContent>

          {/* Subscriptions */}
          <TabsContent value="subs">
            <SubscriptionsTab />
          </TabsContent>

          {/* Collabs */}
          <TabsContent value="collabs">
            <CollabsTab />
          </TabsContent>

          {/* Ads */}
          <TabsContent value="ads">
            <AdsTab />
          </TabsContent>

          {/* Licensing */}
          <TabsContent value="licensing">
            <LicensingTab />
          </TabsContent>

          {/* Merch */}
          <TabsContent value="merch">
            <MerchTab />
          </TabsContent>

          {/* Analytics */}
          <TabsContent value="analytics">
            <AnalyticsTab trending={trending} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ---- Tab Components ----

function EpisodeNFTsTab() {
  const { data: myNfts } = useQuery({
    queryKey: ['my-nfts'],
    queryFn: () => trpcClient.nft.getMyNFTs.query(),
  });

  const { data: allUniverses } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.cinematicUniverses.getAll.query(),
  });

  const [showListForm, setShowListForm] = useState(false);
  const [listForm, setListForm] = useState({
    universeId: '',
    nodeId: '',
    title: '',
    description: '',
    mediaUrl: '',
    mintPrice: '0.01',
    maxSupply: '100',
    royaltyBps: '500',
    metadataURI: '',
  });

  const [browseUniverseId, setBrowseUniverseId] = useState('');

  const { data: universeEpisodes } = useQuery({
    queryKey: ['universe-episodes', browseUniverseId],
    queryFn: () => trpcClient.nft.getEpisodesByUniverse.query({ universeId: browseUniverseId }),
    enabled: !!browseUniverseId,
  });

  const createListing = useMutation({
    mutationFn: () =>
      trpcClient.nft.createEpisodeListing.mutate({
        universeId: listForm.universeId,
        nodeId: parseInt(listForm.nodeId) || 1,
        contentHash: listForm.mediaUrl,
        title: listForm.title,
        description: listForm.description,
        mediaUrl: listForm.mediaUrl,
        mintPrice: listForm.mintPrice,
        maxSupply: parseInt(listForm.maxSupply) || 100,
        royaltyBps: parseInt(listForm.royaltyBps) || 500,
        metadataURI: listForm.metadataURI || listForm.mediaUrl,
      }),
    onSuccess: () => {
      alert('Episode listed for minting!');
      setShowListForm(false);
      setListForm({
        universeId: '',
        nodeId: '',
        title: '',
        description: '',
        mediaUrl: '',
        mintPrice: '0.01',
        maxSupply: '100',
        royaltyBps: '500',
        metadataURI: '',
      });
      queryClient.invalidateQueries({ queryKey: ['my-nfts'] });
      queryClient.invalidateQueries({ queryKey: ['universe-episodes'] });
    },
    onError: (err: any) => alert('Failed to list episode: ' + err.message),
  });

  const recordMint = useMutation({
    mutationFn: (args: { episodeId: string; tokenId: number; txHash: string; price: string }) =>
      trpcClient.nft.recordMint.mutate(args),
    onSuccess: () => {
      alert('Mint recorded!');
      queryClient.invalidateQueries({ queryKey: ['my-nfts'] });
      queryClient.invalidateQueries({ queryKey: ['universe-episodes'] });
    },
    onError: (err: any) => alert('Failed to record mint: ' + err.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Episode NFTs</h2>
          <p className="text-muted-foreground">
            Mint AI-generated episodes as NFTs with royalties on resale
          </p>
        </div>
        <Button onClick={() => setShowListForm(!showListForm)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          List Episode
        </Button>
      </div>

      {/* Stats */}
      <div className="grid md:grid-cols-3 gap-4">
        <RevenueCard
          title="Created Episodes"
          value={myNfts?.createdEpisodes?.length ?? 0}
          description="Episodes you've listed"
          icon={<Film className="w-5 h-5" />}
        />
        <RevenueCard
          title="Collected"
          value={myNfts?.mintedEpisodes?.length ?? 0}
          description="NFTs in your collection"
          icon={<Sparkles className="w-5 h-5" />}
        />
        <RevenueCard
          title="Characters Created"
          value={myNfts?.createdCharacters?.length ?? 0}
          description="Character NFTs you own"
          icon={<Users className="w-5 h-5" />}
        />
      </div>

      {/* List Episode Form */}
      {showListForm && (
        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle>List Episode as NFT</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Universe</Label>
                <Select
                  value={listForm.universeId}
                  onValueChange={(v) => setListForm((f) => ({ ...f, universeId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select universe..." />
                  </SelectTrigger>
                  <SelectContent>
                    {((allUniverses as any)?.data as any[])?.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Node ID</Label>
                <Input
                  type="number"
                  placeholder="1"
                  value={listForm.nodeId}
                  onChange={(e) => setListForm((f) => ({ ...f, nodeId: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                placeholder="Episode title"
                value={listForm.title}
                onChange={(e) => setListForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="What happens in this episode"
                value={listForm.description}
                onChange={(e) => setListForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Media URL</Label>
              <Input
                placeholder="https://..."
                value={listForm.mediaUrl}
                onChange={(e) => setListForm((f) => ({ ...f, mediaUrl: e.target.value }))}
              />
            </div>
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Mint Price (ETH)</Label>
                <Input
                  type="text"
                  value={listForm.mintPrice}
                  onChange={(e) => setListForm((f) => ({ ...f, mintPrice: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Max Supply</Label>
                <Input
                  type="number"
                  value={listForm.maxSupply}
                  onChange={(e) => setListForm((f) => ({ ...f, maxSupply: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Royalty (bps)</Label>
                <Input
                  type="number"
                  placeholder="500 = 5%"
                  value={listForm.royaltyBps}
                  onChange={(e) => setListForm((f) => ({ ...f, royaltyBps: e.target.value }))}
                />
              </div>
            </div>
            <Button
              onClick={() => createListing.mutate()}
              disabled={
                createListing.isPending ||
                !listForm.universeId ||
                !listForm.title ||
                !listForm.mediaUrl
              }
              className="w-full"
            >
              {createListing.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Listing...
                </>
              ) : (
                'List Episode for Minting'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Browse & Mint Episodes */}
      <Card>
        <CardHeader>
          <CardTitle>Browse Episodes by Universe</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={browseUniverseId} onValueChange={setBrowseUniverseId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a universe to browse episodes..." />
            </SelectTrigger>
            <SelectContent>
              {((allUniverses as any)?.data as any[])?.map((u: any) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name || u.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {browseUniverseId && (
            <div className="space-y-3">
              {(universeEpisodes as any[])?.length ? (
                (universeEpisodes as any[]).map((ep: any) => (
                  <Card key={ep.id} className="border">
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <h4 className="font-medium">{ep.title}</h4>
                          <p className="text-sm text-muted-foreground">{ep.description}</p>
                          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                            <span>Price: {ep.mintPrice} ETH</span>
                            <span>
                              Minted: {ep.minted}/{ep.maxSupply || '∞'}
                            </span>
                            <span>Royalty: {(ep.royaltyBps || 0) / 100}%</span>
                          </div>
                        </div>
                        <Button
                          size="sm"
                          disabled={!ep.active || recordMint.isPending}
                          onClick={() => {
                            const fakeTxHash =
                              `0x${Date.now().toString(16)}${'0'.repeat(40)}`.slice(0, 66);
                            recordMint.mutate({
                              episodeId: ep.id,
                              tokenId: (ep.minted || 0) + 1,
                              txHash: fakeTxHash,
                              price: ep.mintPrice,
                            });
                          }}
                        >
                          {recordMint.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            'Mint'
                          )}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No episodes listed for this universe yet
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CharacterNFTsTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Character NFTs</h2>
        <p className="text-muted-foreground">
          Own characters as NFTs. Earn when your character appears in episodes.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How It Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>1. Create a character in a universe</p>
            <p>2. Mint it as an NFT — you own that character</p>
            <p>3. Every time it appears in an episode, you earn royalties</p>
            <p>4. Trade characters on secondary markets with 5% royalty</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Appearance Royalties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Characters earn passive income from episode mints</p>
            <p>More popular characters = more appearances = more earnings</p>
            <p>Claim accumulated royalties anytime from the contract</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function CanonMarketplaceTab() {
  const { isAuthenticated } = useWalletAuth();
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [browseUniverseId, setBrowseUniverseId] = useState('');
  const [browseStatus, setBrowseStatus] = useState<string>('VOTING');
  const [submitForm, setSubmitForm] = useState({
    universeId: '',
    universeToken: '',
    submissionType: 'CHARACTER' as 'CHARACTER' | 'PLOT_ARC' | 'LOCATION' | 'LORE_RULE',
    title: '',
    description: '',
    contentHash: '',
    metadataURI: '',
    mediaUrl: '',
  });

  const { data: allUniverses } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.cinematicUniverses.getAll.query(),
  });

  const { data: submissions } = useQuery({
    queryKey: ['canon-submissions', browseUniverseId, browseStatus],
    queryFn: () =>
      trpcClient.marketplace.getByUniverse.query({
        universeId: browseUniverseId,
        status: browseStatus === 'ALL' ? undefined : (browseStatus as any),
      }),
    enabled: !!browseUniverseId,
  });

  const { data: mySubmissions } = useQuery({
    queryKey: ['my-canon-submissions'],
    queryFn: () => trpcClient.marketplace.mySubmissions.query(),
    enabled: !!isAuthenticated,
  });

  const submitCanon = useMutation({
    mutationFn: () =>
      trpcClient.marketplace.submit.mutate({
        universeId: submitForm.universeId,
        universeToken: submitForm.universeToken || '0x0000000000000000000000000000000000000000',
        submissionType: submitForm.submissionType,
        title: submitForm.title,
        description: submitForm.description,
        contentHash: submitForm.contentHash || `hash-${Date.now()}`,
        metadataURI: submitForm.metadataURI || '',
        mediaUrl: submitForm.mediaUrl,
      }),
    onSuccess: () => {
      alert('Canon submission created! Token holders can now vote.');
      setShowSubmitForm(false);
      setSubmitForm({
        universeId: '',
        universeToken: '',
        submissionType: 'CHARACTER',
        title: '',
        description: '',
        contentHash: '',
        metadataURI: '',
        mediaUrl: '',
      });
      queryClient.invalidateQueries({ queryKey: ['canon-submissions'] });
      queryClient.invalidateQueries({ queryKey: ['my-canon-submissions'] });
    },
    onError: (err: any) => alert('Submission failed: ' + err.message),
  });

  const castVote = useMutation({
    mutationFn: (args: { submissionId: string; support: boolean; weight: string }) =>
      trpcClient.marketplace.vote.mutate(args),
    onSuccess: () => {
      alert('Vote cast!');
      queryClient.invalidateQueries({ queryKey: ['canon-submissions'] });
    },
    onError: (err: any) => alert('Vote failed: ' + err.message),
  });

  const submissionTypes = [
    { value: 'CHARACTER', label: 'Character' },
    { value: 'PLOT_ARC', label: 'Plot Arc' },
    { value: 'LOCATION', label: 'Location' },
    { value: 'LORE_RULE', label: 'Lore Rule' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Canon Marketplace</h2>
          <p className="text-muted-foreground">
            Submit characters, plot arcs, locations, and lore rules. Token holders vote content into
            canon.
          </p>
        </div>
        <Button
          onClick={() => setShowSubmitForm(!showSubmitForm)}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Submit to Canon
        </Button>
      </div>

      {/* Submission Form */}
      {showSubmitForm && (
        <Card className="border-emerald-200">
          <CardHeader>
            <CardTitle>Submit Canon Entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Universe</Label>
                <Select
                  value={submitForm.universeId}
                  onValueChange={(v) => setSubmitForm((f) => ({ ...f, universeId: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select universe..." />
                  </SelectTrigger>
                  <SelectContent>
                    {((allUniverses as any)?.data as any[])?.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={submitForm.submissionType}
                  onValueChange={(v) => setSubmitForm((f) => ({ ...f, submissionType: v as any }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {submissionTypes.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                placeholder="Name your submission"
                value={submitForm.title}
                onChange={(e) => setSubmitForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input
                placeholder="Describe your contribution to the universe"
                value={submitForm.description}
                onChange={(e) => setSubmitForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label>Media URL (optional)</Label>
              <Input
                placeholder="https://..."
                value={submitForm.mediaUrl}
                onChange={(e) => setSubmitForm((f) => ({ ...f, mediaUrl: e.target.value }))}
              />
            </div>
            <Button
              onClick={() => submitCanon.mutate()}
              disabled={
                submitCanon.isPending ||
                !submitForm.universeId ||
                !submitForm.title ||
                !submitForm.description
              }
              className="w-full"
            >
              {submitCanon.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit for Community Vote'
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Browse & Vote on Submissions */}
      <Card>
        <CardHeader>
          <CardTitle>Browse Submissions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1">
              <Select value={browseUniverseId} onValueChange={setBrowseUniverseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select universe..." />
                </SelectTrigger>
                <SelectContent>
                  {((allUniverses as any)?.data as any[])?.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Select value={browseStatus} onValueChange={setBrowseStatus}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="VOTING">Voting</SelectItem>
                <SelectItem value="ACCEPTED">Accepted</SelectItem>
                <SelectItem value="REJECTED">Rejected</SelectItem>
                <SelectItem value="ALL">All</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {browseUniverseId && (
            <div className="space-y-3">
              {(submissions as any[])?.length ? (
                (submissions as any[]).map((sub: any) => (
                  <Card key={sub.id} className="border">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs px-2 py-0.5 rounded bg-muted font-medium">
                              {sub.submissionType}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded font-medium ${
                                sub.status === 'VOTING'
                                  ? 'bg-blue-100 text-blue-700'
                                  : sub.status === 'ACCEPTED'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {sub.status}
                            </span>
                          </div>
                          <h4 className="font-medium">{sub.title}</h4>
                          <p className="text-sm text-muted-foreground mt-1">{sub.description}</p>
                          <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                            <span>For: {sub.votesFor ?? 0}</span>
                            <span>Against: {sub.votesAgainst ?? 0}</span>
                            <span>Voters: {sub.voterCount ?? 0}</span>
                          </div>
                        </div>
                        {sub.status === 'VOTING' && (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                              disabled={castVote.isPending}
                              onClick={() =>
                                castVote.mutate({
                                  submissionId: sub.id,
                                  support: true,
                                  weight: '1',
                                })
                              }
                            >
                              <ThumbsUp className="h-3 w-3 mr-1" />
                              For
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 border-red-300 hover:bg-red-50"
                              disabled={castVote.isPending}
                              onClick={() =>
                                castVote.mutate({
                                  submissionId: sub.id,
                                  support: false,
                                  weight: '1',
                                })
                              }
                            >
                              <ThumbsDown className="h-3 w-3 mr-1" />
                              Against
                            </Button>
                          </div>
                        )}
                        {sub.status === 'ACCEPTED' && (
                          <CheckCircle className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No submissions found
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* My Submissions */}
      {(mySubmissions as any[])?.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Submissions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(mySubmissions as any[]).map((sub: any) => (
                <div
                  key={sub.id}
                  className="flex items-center justify-between py-2 border-b last:border-0"
                >
                  <div>
                    <span className="font-medium text-sm">{sub.title}</span>
                    <span className="text-xs text-muted-foreground ml-2">{sub.submissionType}</span>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${
                      sub.status === 'VOTING'
                        ? 'bg-blue-100 text-blue-700'
                        : sub.status === 'ACCEPTED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {sub.status}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Revenue Model Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Revenue Model</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>Submission fee → Platform + Creator (if accepted)</p>
          <p>License fee → Others pay to use your accepted canon within the universe</p>
          <p>Voting power weighted by governance token balance</p>
        </CardContent>
      </Card>
    </div>
  );
}

function CreditsTab() {
  const { data: balance } = useQuery({
    queryKey: ['credit-balance'],
    queryFn: () => trpcClient.credits.getBalance.query(),
  });

  const { data: tiers } = useQuery({
    queryKey: ['credit-tiers'],
    queryFn: () => trpcClient.credits.getTiers.query(),
  });

  const { data: costs } = useQuery({
    queryKey: ['credit-costs'],
    queryFn: () => trpcClient.credits.getCosts.query(),
  });

  const { data: history } = useQuery({
    queryKey: ['credit-history'],
    queryFn: () => trpcClient.credits.getHistory.query({ limit: 10 }),
  });

  const [purchasingTier, setPurchasingTier] = useState<string | null>(null);

  const purchaseCredits = useMutation({
    mutationFn: (args: { tierId: string; amount: string }) =>
      trpcClient.credits.purchase.mutate({
        tierId: args.tierId,
        txHash: `0x${Date.now().toString(16)}${'0'.repeat(40)}`.slice(0, 66),
        amount: args.amount,
      }),
    onSuccess: (data: any) => {
      alert(`Purchased ${data.creditsAdded} credits!`);
      setPurchasingTier(null);
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      queryClient.invalidateQueries({ queryKey: ['credit-history'] });
    },
    onError: (err: any) => {
      alert('Purchase failed: ' + err.message);
      setPurchasingTier(null);
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">AI Generation Credits</h2>
          <p className="text-muted-foreground">
            Purchase credits to generate side stories, spinoffs, and fan episodes
          </p>
        </div>
        <Card className="px-6 py-3">
          <div className="text-center">
            <p className="text-3xl font-bold">{balance?.balance ?? 0}</p>
            <p className="text-xs text-muted-foreground">Credits Available</p>
            {balance && (
              <p className="text-xs text-muted-foreground mt-1">
                Purchased: {balance.totalPurchased} | Spent: {balance.totalSpent}
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Credit Costs */}
      <div>
        <h3 className="font-semibold mb-3">Generation Costs</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {costs &&
            Object.entries(costs).map(([type, cost]) => (
              <Card key={type} className="text-center p-3">
                <p className="text-sm font-medium capitalize">{type}</p>
                <p className="text-2xl font-bold">{cost as number}</p>
                <p className="text-xs text-muted-foreground">credits</p>
              </Card>
            ))}
        </div>
      </div>

      {/* Purchase Tiers */}
      <div>
        <h3 className="font-semibold mb-3">Purchase Credits</h3>
        <div className="grid md:grid-cols-3 gap-4">
          {(tiers as any[])?.length ? (
            (tiers as any[]).map((tier: any) => (
              <Card key={tier.id} className="relative overflow-hidden">
                <CardHeader>
                  <CardTitle>{tier.name}</CardTitle>
                  <CardDescription>{tier.credits} credits</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold mb-4">
                    {tier.priceWei ? formatWei(tier.priceWei) : '0.00'} ETH
                  </p>
                  <Button
                    className="w-full"
                    disabled={purchaseCredits.isPending && purchasingTier === tier.id}
                    onClick={() => {
                      setPurchasingTier(tier.id);
                      purchaseCredits.mutate({ tierId: tier.id, amount: tier.priceWei || '0' });
                    }}
                  >
                    {purchaseCredits.isPending && purchasingTier === tier.id ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Purchasing...
                      </>
                    ) : (
                      <>
                        <Coins className="h-4 w-4 mr-2" />
                        Purchase
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))
          ) : (
            <p className="text-muted-foreground col-span-3">No credit tiers configured yet</p>
          )}
        </div>
      </div>

      {/* Transaction History */}
      {(history as any[])?.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">Recent Transactions</h3>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {(history as any[]).map((tx: any, i: number) => (
                  <div
                    key={tx.id || i}
                    className="px-4 py-3 flex items-center justify-between text-sm"
                  >
                    <div>
                      <span className="font-medium capitalize">{tx.type}</span>
                      {tx.generationType && (
                        <span className="text-muted-foreground ml-2">({tx.generationType})</span>
                      )}
                    </div>
                    <span
                      className={
                        tx.type === 'purchase' || tx.type === 'grant'
                          ? 'text-emerald-600'
                          : 'text-red-500'
                      }
                    >
                      {tx.type === 'purchase' || tx.type === 'grant' ? '+' : '-'}
                      {tx.credits}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function SubscriptionsTab() {
  const { data: mySubs } = useQuery({
    queryKey: ['my-subs'],
    queryFn: () => trpcClient.subscriptions.mySubscriptions.query(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Universe Subscriptions</h2>
        <p className="text-muted-foreground">
          Subscribe to universes for early episodes, voting rights, premium content, and
          behind-the-scenes access
        </p>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        {['FREE', 'BASIC', 'PREMIUM', 'VIP'].map((tier, i) => (
          <Card key={tier} className={i === 2 ? 'border-primary ring-1 ring-primary' : ''}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {tier === 'VIP' && <Crown className="w-4 h-4 text-yellow-500" />}
                {tier}
              </CardTitle>
              <CardDescription>
                {i === 0 && 'Basic access'}
                {i === 1 && 'Early episodes + voting'}
                {i === 2 && 'All features + premium content'}
                {i === 3 && 'Everything + behind-the-scenes'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {i >= 1 && <p>Early episode access</p>}
              {i >= 1 && <p>Voting boost</p>}
              {i >= 2 && <p>Premium content</p>}
              {i >= 3 && <p>Behind-the-scenes</p>}
              {i >= 2 && <p>Bonus credits monthly</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {mySubs && (mySubs as any[]).length > 0 && (
        <div>
          <h3 className="font-semibold mb-3">My Subscriptions</h3>
          <div className="grid md:grid-cols-2 gap-4">
            {(mySubs as any[]).map((sub: any) => (
              <Card key={sub.id}>
                <CardHeader>
                  <CardTitle className="text-lg">Universe: {sub.universeId}</CardTitle>
                  <CardDescription>
                    {sub.tier} — {sub.active ? 'Active' : 'Expired'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <p>
                    Expires: {sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : 'N/A'}
                  </p>
                  <p>Auto-renew: {sub.autoRenew ? 'Yes' : 'No'}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CollabsTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Cross-Universe Collaborations</h2>
        <p className="text-muted-foreground">
          Two universes collide — special event episodes, joint NFTs, and shared liquidity
        </p>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Propose</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Invite another universe to create crossover episodes together. Set revenue sharing
              terms.
            </p>
            <Button variant="outline" className="mt-4 w-full">
              Create Proposal
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active Collabs</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>View ongoing collaborations, joint episodes, and shared revenue streams.</p>
            <Button variant="outline" className="mt-4 w-full">
              View Active
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Revenue Split</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Configurable BPS revenue sharing between participating universes. Transparent on-chain
              settlement.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AdsTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Programmatic Ad Placement</h2>
        <p className="text-muted-foreground">
          Dynamic product placement inside AI-generated episodes — billboards, products, sponsored
          characters
        </p>
      </div>
      <div className="grid md:grid-cols-4 gap-4">
        {[
          { type: 'Billboard', desc: 'In-scene billboard placement' },
          { type: 'Product', desc: 'Character uses your product' },
          { type: 'Sponsored Character', desc: 'Your brand as a character' },
          { type: 'Audio Mention', desc: 'Dialogue mention of your brand' },
        ].map((ad) => (
          <Card key={ad.type}>
            <CardHeader>
              <CardTitle className="text-lg">{ad.type}</CardTitle>
              <CardDescription>{ad.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full">
                Place Bid
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          <p>
            Sponsors bid on placement slots. Universe creators accept bids. Impressions are tracked
            per episode.
          </p>
          <p className="mt-2">Revenue flows: Sponsor pays → Platform fee → Creator earns</p>
        </CardContent>
      </Card>
    </div>
  );
}

function LicensingTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">IP Licensing</h2>
        <p className="text-muted-foreground">
          License your original universes to streaming platforms, game studios, and publishers
        </p>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {[
          {
            type: 'Streaming',
            desc: 'License to Netflix, Amazon, YouTube',
            icon: <Film className="w-5 h-5" />,
          },
          {
            type: 'Gaming',
            desc: 'Video game adaptations',
            icon: <Sparkles className="w-5 h-5" />,
          },
          {
            type: 'Comics',
            desc: 'Comic book and graphic novel rights',
            icon: <FileText className="w-5 h-5" />,
          },
        ].map((lic) => (
          <Card key={lic.type}>
            <CardHeader>
              <div className="flex items-center gap-2">
                {lic.icon}
                <CardTitle className="text-lg">{lic.type}</CardTitle>
              </div>
              <CardDescription>{lic.desc}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full">
                Create License
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          <p>
            Because universes are 100% original IP, you can license them anywhere with no legal
            risk.
          </p>
          <p className="mt-1">Upfront fees + ongoing royalties. All tracked on-chain.</p>
        </CardContent>
      </Card>
    </div>
  );
}

function MerchTab() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Merchandise</h2>
        <p className="text-muted-foreground">
          Shirts, posters, figurines, comics — all original IP, no legal risk
        </p>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        {['Shirts', 'Posters', 'Figurines', 'Comics', 'Digital Collectibles', 'Other'].map(
          (cat) => (
            <Card key={cat} className="cursor-pointer hover:border-primary transition-colors">
              <CardHeader>
                <CardTitle className="text-lg">{cat}</CardTitle>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" className="w-full">
                  Browse
                </Button>
              </CardContent>
            </Card>
          )
        )}
      </div>
    </div>
  );
}

function AnalyticsTab({ trending }: { trending: any }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Data & Analytics</h2>
        <p className="text-muted-foreground">
          Story engagement data — what stories people like, trending characters, engaging arcs.
          Valuable for AI training and studio insights.
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Trending Universes</CardTitle>
          </CardHeader>
          <CardContent>
            {(trending as any[])?.length ? (
              <div className="space-y-2">
                {(trending as any[]).map((u: any, i: number) => (
                  <div key={u.id} className="flex items-center justify-between text-sm">
                    <span>
                      #{i + 1} Universe {u.id}
                    </span>
                    <span className="text-muted-foreground">{u.totalViews} views</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No trending data yet</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Data Export</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Export engagement data for AI training and studio pitches.</p>
            <p className="mt-2">
              Includes: view patterns, character popularity, arc engagement, audience demographics.
            </p>
            <Button variant="outline" className="mt-4">
              Export Data
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Helpers ----

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
          </div>
          <div className="text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: number;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-lg">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">{value}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function formatWei(wei: string): string {
  try {
    const num = Number(BigInt(wei)) / 1e18;
    return num.toFixed(4);
  } catch {
    return '0.0000';
  }
}
