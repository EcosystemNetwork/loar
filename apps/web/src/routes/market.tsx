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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Film, Users, Gavel, Coins, Crown, Handshake,
  Megaphone, FileText, ShoppingBag, BarChart3,
  TrendingUp, Sparkles, ArrowRight
} from 'lucide-react';

import { trpcClient } from '@/utils/trpc';
import { useQuery } from '@tanstack/react-query';

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
            <StatCard label="Universes" value={platformStats?.universeCount ?? 0} icon={<Sparkles className="w-5 h-5" />} />
            <StatCard label="Total Views" value={platformStats?.totalViews ?? 0} icon={<BarChart3 className="w-5 h-5" />} />
            <StatCard label="NFTs Minted" value={platformStats?.totalMints ?? 0} icon={<Film className="w-5 h-5" />} />
            <StatCard label="Total Revenue" value={`${formatWei(platformStats?.totalRevenue ?? '0')} ETH`} icon={<TrendingUp className="w-5 h-5" />} />
          </div>
        </div>

        {/* Revenue Streams Grid */}
        <Tabs defaultValue="nfts" className="space-y-6">
          <TabsList className="grid grid-cols-5 lg:grid-cols-10 w-full h-auto">
            <TabsTrigger value="nfts" className="text-xs"><Film className="w-3 h-3 mr-1" />NFTs</TabsTrigger>
            <TabsTrigger value="characters" className="text-xs"><Users className="w-3 h-3 mr-1" />Characters</TabsTrigger>
            <TabsTrigger value="canon" className="text-xs"><Gavel className="w-3 h-3 mr-1" />Canon</TabsTrigger>
            <TabsTrigger value="credits" className="text-xs"><Coins className="w-3 h-3 mr-1" />Credits</TabsTrigger>
            <TabsTrigger value="subs" className="text-xs"><Crown className="w-3 h-3 mr-1" />Subscribe</TabsTrigger>
            <TabsTrigger value="collabs" className="text-xs"><Handshake className="w-3 h-3 mr-1" />Collabs</TabsTrigger>
            <TabsTrigger value="ads" className="text-xs"><Megaphone className="w-3 h-3 mr-1" />Ads</TabsTrigger>
            <TabsTrigger value="licensing" className="text-xs"><FileText className="w-3 h-3 mr-1" />License</TabsTrigger>
            <TabsTrigger value="merch" className="text-xs"><ShoppingBag className="w-3 h-3 mr-1" />Merch</TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs"><BarChart3 className="w-3 h-3 mr-1" />Data</TabsTrigger>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Episode NFTs</h2>
          <p className="text-muted-foreground">Mint AI-generated episodes as NFTs with royalties on resale</p>
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <RevenueCard
          title="Created Episodes"
          value={myNfts?.createdEpisodes?.length ?? 0}
          description="Episodes you've listed for minting"
          icon={<Film className="w-5 h-5" />}
        />
        <RevenueCard
          title="Collected"
          value={myNfts?.mintedEpisodes?.length ?? 0}
          description="Episode NFTs in your collection"
          icon={<Sparkles className="w-5 h-5" />}
        />
        <RevenueCard
          title="Characters Created"
          value={myNfts?.createdCharacters?.length ?? 0}
          description="Character NFTs you own"
          icon={<Users className="w-5 h-5" />}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Create episodes in the Universe Timeline Editor, then list them as NFTs here.
        Earn royalties on every resale via ERC-2981.
      </p>
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
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Canon Marketplace</h2>
        <p className="text-muted-foreground">
          Submit characters, plot arcs, locations, and lore rules. Token holders vote content into canon.
        </p>
      </div>
      <div className="grid md:grid-cols-4 gap-4">
        {['Characters', 'Plot Arcs', 'Locations', 'Lore Rules'].map((type) => (
          <Card key={type} className="cursor-pointer hover:border-primary transition-colors">
            <CardHeader>
              <CardTitle className="text-lg">{type}</CardTitle>
              <CardDescription>Submit {type.toLowerCase()} for canon consideration</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full">
                Browse <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">AI Generation Credits</h2>
          <p className="text-muted-foreground">Purchase credits to generate side stories, spinoffs, and fan episodes</p>
        </div>
        <Card className="px-6 py-3">
          <div className="text-center">
            <p className="text-3xl font-bold">{balance?.balance ?? 0}</p>
            <p className="text-xs text-muted-foreground">Credits Available</p>
          </div>
        </Card>
      </div>

      {/* Credit Costs */}
      <div>
        <h3 className="font-semibold mb-3">Generation Costs</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {costs && Object.entries(costs).map(([type, cost]) => (
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
          {(tiers as any[])?.map((tier: any) => (
            <Card key={tier.id} className="relative overflow-hidden">
              <CardHeader>
                <CardTitle>{tier.name}</CardTitle>
                <CardDescription>{tier.credits} credits</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold mb-4">{formatWei(tier.priceWei)} ETH</p>
                <Button className="w-full">Purchase</Button>
              </CardContent>
            </Card>
          )) ?? (
            <p className="text-muted-foreground col-span-3">No credit tiers configured yet</p>
          )}
        </div>
      </div>
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
          Subscribe to universes for early episodes, voting rights, premium content, and behind-the-scenes access
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
                  <p>Expires: {sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : 'N/A'}</p>
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
            <p>Invite another universe to create crossover episodes together. Set revenue sharing terms.</p>
            <Button variant="outline" className="mt-4 w-full">Create Proposal</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Active Collabs</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>View ongoing collaborations, joint episodes, and shared revenue streams.</p>
            <Button variant="outline" className="mt-4 w-full">View Active</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Revenue Split</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Configurable BPS revenue sharing between participating universes. Transparent on-chain settlement.</p>
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
          Dynamic product placement inside AI-generated episodes — billboards, products, sponsored characters
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
          <p>Sponsors bid on placement slots. Universe creators accept bids. Impressions are tracked per episode.</p>
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
          { type: 'Streaming', desc: 'License to Netflix, Amazon, YouTube', icon: <Film className="w-5 h-5" /> },
          { type: 'Gaming', desc: 'Video game adaptations', icon: <Sparkles className="w-5 h-5" /> },
          { type: 'Comics', desc: 'Comic book and graphic novel rights', icon: <FileText className="w-5 h-5" /> },
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
              <Button variant="outline" size="sm" className="w-full">Create License</Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          <p>Because universes are 100% original IP, you can license them anywhere with no legal risk.</p>
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
        {['Shirts', 'Posters', 'Figurines', 'Comics', 'Digital Collectibles', 'Other'].map((cat) => (
          <Card key={cat} className="cursor-pointer hover:border-primary transition-colors">
            <CardHeader>
              <CardTitle className="text-lg">{cat}</CardTitle>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full">Browse</Button>
            </CardContent>
          </Card>
        ))}
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
                    <span>#{i + 1} Universe {u.id}</span>
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
            <p className="mt-2">Includes: view patterns, character popularity, arc engagement, audience demographics.</p>
            <Button variant="outline" className="mt-4">Export Data</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ---- Helpers ----

function StatCard({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p>
          </div>
          <div className="text-muted-foreground">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueCard({ title, value, description, icon }: { title: string; value: number; description: string; icon: React.ReactNode }) {
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
