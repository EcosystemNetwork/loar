/**
 * Universe Shop — storefront for a single universe
 * Shows hero, featured listings grouped by product type, subscription tiers, seller bio.
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import {
  ArrowLeft,
  Crown,
  Film,
  Users,
  Package,
  ShoppingBag,
  Store,
  Loader2,
  ExternalLink,
  Megaphone,
  TrendingUp,
  Tv2,
  Volume2,
  User,
  Plus,
  Gavel,
  Scale,
  Handshake,
  FileText,
  Banknote,
  Clock,
  CheckCircle2,
  XCircle,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUniverseStorefront } from '@/hooks/useListings';
import {
  useSubscriptionTiers,
  useAdSlots,
  useCanonSubmissions,
  useUniverseLicenses,
  useUniverseCollabs,
  useUniverseMerch,
} from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { formatEther } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useVocab } from '@/hooks/use-vocab';

export const Route = createFileRoute('/shop/$universeId')({
  component: UniverseShopPage,
});

function UniverseShopPage() {
  const { universeId } = useParams({ from: '/shop/$universeId' });
  const { address } = useWalletAuth();
  const v = useVocab();

  const { data: storefront, isLoading } = useUniverseStorefront(universeId);
  const { data: subTiers } = useSubscriptionTiers(universeId);
  const { data: adSlots, isLoading: adsLoading } = useAdSlots(universeId);
  const { data: votingSubmissions } = useCanonSubmissions(universeId, 'VOTING');
  const { data: licenses, isLoading: licensesLoading } = useUniverseLicenses(universeId);
  const { data: collabs, isLoading: collabsLoading } = useUniverseCollabs(universeId);
  const { data: merch, isLoading: merchLoading } = useUniverseMerch(universeId);
  const { data: universe } = useQuery({
    queryKey: ['universe', universeId],
    queryFn: () => trpcClient.universes.get.query({ id: universeId }),
    enabled: !!universeId,
  });

  const listings = storefront?.listings ?? [];

  const byType = listings.reduce((acc: Record<string, any[]>, l: any) => {
    const k = l.productType ?? 'OTHER';
    acc[k] = [...(acc[k] ?? []), l];
    return acc;
  }, {});

  const SECTIONS = [
    { key: 'EPISODE_NFT', label: 'Episodes', icon: <Film className="w-4 h-4" /> },
    { key: 'CHARACTER_NFT', label: 'Characters', icon: <Users className="w-4 h-4" /> },
    { key: 'ARTIFACT', label: 'Artifacts', icon: <Package className="w-4 h-4" /> },
    { key: 'MERCH', label: 'Merch', icon: <ShoppingBag className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Back nav */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
        <Link to="/market">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <span className="font-semibold truncate">{(universe as any)?.name ?? 'Universe Shop'}</span>
      </div>

      {/* Hero */}
      <div className="relative">
        <div className="h-40 bg-gradient-to-br from-primary/20 via-primary/5 to-background flex items-center justify-center">
          {(universe as any)?.bannerUrl ? (
            <img src={(universe as any).bannerUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <Store className="w-16 h-16 text-primary/20" />
          )}
        </div>
        <div className="px-4 pb-4 -mt-8 relative">
          <div className="w-16 h-16 rounded-2xl border-4 border-background bg-muted flex items-center justify-center overflow-hidden shadow-lg">
            {(universe as any)?.thumbnailUrl ? (
              <img
                src={(universe as any).thumbnailUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <Store className="w-8 h-8 text-muted-foreground" />
            )}
          </div>
          <div className="mt-2">
            <h1 className="text-xl font-bold">{(universe as any)?.name ?? '—'}</h1>
            <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
              {(universe as any)?.description ?? ''}
            </p>
            <div className="flex gap-2 mt-2 flex-wrap">
              {listings.length > 0 && <Badge variant="secondary">{listings.length} listings</Badge>}
              {subTiers && subTiers.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Crown className="w-3 h-3" />
                  {subTiers.length} subscription tiers
                </Badge>
              )}
              {adSlots && adSlots.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Megaphone className="w-3 h-3" />
                  {adSlots.length} ad slots
                </Badge>
              )}
              {licenses && licenses.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Scale className="w-3 h-3" />
                  {licenses.length} licenses
                </Badge>
              )}
              {collabs && collabs.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Handshake className="w-3 h-3" />
                  {collabs.length} collabs
                </Badge>
              )}
              {votingSubmissions && votingSubmissions.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Gavel className="w-3 h-3" />
                  {votingSubmissions.length} voting
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="all">
            <TabsList className="w-full mb-4">
              <TabsTrigger value="all" className="flex-1">
                All
              </TabsTrigger>
              <TabsTrigger value="subs" className="flex-1">
                Subscribe
              </TabsTrigger>
              <TabsTrigger value="canon" className="flex-1 gap-1">
                <Gavel className="w-3 h-3" />
                Canon
              </TabsTrigger>
              <TabsTrigger value="ads" className="flex-1 gap-1">
                <Megaphone className="w-3 h-3" />
                Ads
              </TabsTrigger>
              <TabsTrigger value="licensing" className="flex-1 gap-1">
                <Scale className="w-3 h-3" />
                Licenses
              </TabsTrigger>
              <TabsTrigger value="collabs" className="flex-1 gap-1">
                <Handshake className="w-3 h-3" />
                Collabs
              </TabsTrigger>
            </TabsList>

            <TabsContent value="all">
              {/* Sections by product type */}
              {SECTIONS.map(({ key, label, icon }) => {
                const items = byType[key];
                if (!items?.length) return null;
                return (
                  <section key={key} className="mb-6">
                    <h3 className="flex items-center gap-1.5 font-semibold mb-3">
                      {icon}
                      {label}
                    </h3>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {items.map((listing: any) => (
                        <ShopListingCard key={listing.id} listing={listing} />
                      ))}
                    </div>
                  </section>
                );
              })}
              {listings.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <Store className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No active listings yet</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="canon">
              <div className="text-center py-6 space-y-3">
                <Gavel className="w-10 h-10 mx-auto text-primary/40" />
                <p className="text-sm font-medium">{v('canon-marketplace')}</p>
                <p className="text-xs text-muted-foreground">
                  Submit content proposals and vote on what becomes permanent universe canon.
                </p>
                {votingSubmissions && votingSubmissions.length > 0 && (
                  <p className="text-xs text-yellow-500 font-medium">
                    {votingSubmissions.length} active submission
                    {votingSubmissions.length !== 1 ? 's' : ''} need your vote
                  </p>
                )}
                <Link to="/shop/$universeId" params={{ universeId }}>
                  <Button className="gap-2">
                    <Gavel className="w-4 h-4" />
                    Open {v('canon-marketplace')}
                  </Button>
                </Link>
              </div>
            </TabsContent>

            <TabsContent value="ads">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Open Ad Slots</h3>
                <Link to="/ads/new">
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs">
                    <Plus className="w-3 h-3" />
                    New Slot
                  </Button>
                </Link>
              </div>
              {adsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : adSlots?.length ? (
                <div className="space-y-3">
                  {adSlots.map((slot: any) => (
                    <AdSlotCard key={slot.id} slot={slot} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Megaphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No open ad slots</p>
                  <Link to="/ads/new">
                    <Button variant="outline" size="sm" className="mt-3">
                      Create a Slot
                    </Button>
                  </Link>
                </div>
              )}
            </TabsContent>

            <TabsContent value="licensing">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">IP Licenses</h3>
                <Link to="/licensing/new">
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs">
                    <Plus className="w-3 h-3" />
                    New License
                  </Button>
                </Link>
              </div>
              {licensesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : licenses?.length ? (
                <div className="space-y-3">
                  {licenses.map((license: any) => (
                    <LicenseCard key={license.id} license={license} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Scale className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No active licenses</p>
                  <Link to="/licensing/new">
                    <Button variant="outline" size="sm" className="mt-3">
                      Create a License
                    </Button>
                  </Link>
                </div>
              )}

              {/* Merch section within licensing tab */}
              {merch && merch.length > 0 && (
                <div className="mt-6">
                  <h3 className="font-semibold text-sm mb-3 flex items-center gap-1.5">
                    <ShoppingBag className="w-4 h-4" />
                    Merchandise
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {merch.map((item: any) => (
                      <MerchCard key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="collabs">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm">Collaborations</h3>
                <Link to="/collabs/new">
                  <Button size="sm" variant="outline" className="gap-1 h-7 text-xs">
                    <Plus className="w-3 h-3" />
                    Propose
                  </Button>
                </Link>
              </div>
              {collabsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : collabs?.length ? (
                <div className="space-y-3">
                  {collabs.map((collab: any) => (
                    <ShopCollabCard key={collab.id} collab={collab} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Handshake className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No collaborations yet</p>
                  <Link to="/collabs/new">
                    <Button variant="outline" size="sm" className="mt-3">
                      Propose a Collab
                    </Button>
                  </Link>
                </div>
              )}
            </TabsContent>

            <TabsContent value="subs">
              {subTiers?.length ? (
                <div className="space-y-3">
                  {subTiers.map((tier: any) => (
                    <SubTierCard key={tier.id ?? tier.tier} tier={tier} universeId={universeId} />
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Crown className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p>No subscription tiers configured</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}

const PLACEMENT_ICONS: Record<string, React.ReactNode> = {
  BILLBOARD: <Tv2 className="w-4 h-4" />,
  PRODUCT: <Package className="w-4 h-4" />,
  SPONSORED_CHARACTER: <User className="w-4 h-4" />,
  AUDIO_MENTION: <Volume2 className="w-4 h-4" />,
};

const PLACEMENT_LABELS: Record<string, string> = {
  BILLBOARD: 'Billboard',
  PRODUCT: 'Product',
  SPONSORED_CHARACTER: 'Character',
  AUDIO_MENTION: 'Audio',
};

function AdSlotCard({ slot }: { slot: any }) {
  const minBidEth = slot.minBid ? parseFloat(formatEther(BigInt(slot.minBid))).toFixed(4) : '—';
  const topBidEth =
    slot.currentBid && slot.currentBid !== '0'
      ? parseFloat(formatEther(BigInt(slot.currentBid))).toFixed(4)
      : null;

  return (
    <Link
      to="/ads/$slotId"
      params={{ slotId: slot.id }}
      search={{
        universeId: slot.universeId,
        placementType: slot.placementType,
        minBid: slot.minBid,
        currentBid: slot.currentBid,
        currentBidder: slot.currentBidder,
        description: slot.description,
        constraints: slot.constraints,
        episodes: slot.episodes,
        creatorUid: slot.creatorUid,
        active: slot.active,
      }}
    >
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                {PLACEMENT_ICONS[slot.placementType] ?? <Megaphone className="w-4 h-4" />}
              </div>
              <div>
                <p className="text-sm font-medium">
                  {PLACEMENT_LABELS[slot.placementType] ?? slot.placementType}
                </p>
                <p className="text-xs text-muted-foreground">{slot.episodes} episodes</p>
              </div>
            </div>
            <Badge variant={slot.active ? 'default' : 'secondary'} className="text-xs">
              {slot.active ? 'Open' : 'Closed'}
            </Badge>
          </div>

          {slot.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{slot.description}</p>
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Floor: <span className="text-foreground font-medium">{minBidEth} ETH</span>
            </span>
            {topBidEth ? (
              <span className="flex items-center gap-1 text-yellow-400 font-medium">
                <TrendingUp className="w-3 h-3" />
                {topBidEth} ETH
              </span>
            ) : (
              <span className="text-muted-foreground">No bids yet</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function ShopListingCard({ listing }: { listing: any }) {
  return (
    <Link to="/product/$id" params={{ id: listing.id }}>
      <Card className="overflow-hidden hover:border-primary/50 transition-colors cursor-pointer">
        <div className="aspect-square bg-muted flex items-center justify-center">
          {listing.thumbnailUrl ? (
            <img
              src={listing.thumbnailUrl}
              alt={listing.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <Package className="w-8 h-8 text-muted-foreground opacity-30" />
          )}
        </div>
        <CardContent className="p-2">
          <p className="text-xs font-medium truncate">{listing.title}</p>
          <p className="text-xs text-primary font-semibold mt-0.5">
            {listing.price === '0' ? 'Free' : `${listing.price} ${listing.currency}`}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

const LICENSE_TYPE_LABELS: Record<string, string> = {
  STREAMING: 'Streaming',
  MERCH: 'Merchandise',
  GAMING: 'Gaming',
  COMIC: 'Comic / Print',
  AUDIO: 'Audio',
  OTHER: 'Other',
};

const LICENSE_STATUS_COLORS: Record<string, string> = {
  PROPOSED: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  ACTIVE: 'bg-green-500/10 text-green-400 border-green-500/20',
  REVOKED: 'bg-red-500/10 text-red-400 border-red-500/20',
};

function LicenseCard({ license }: { license: any }) {
  const statusColor = LICENSE_STATUS_COLORS[license.status] ?? '';
  const feeEth = license.upfrontFee
    ? parseFloat(formatEther(BigInt(license.upfrontFee))).toFixed(4)
    : '—';

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium">
                {LICENSE_TYPE_LABELS[license.licenseType] ?? license.licenseType}
              </p>
              <p className="text-xs text-muted-foreground">{license.licensee}</p>
            </div>
          </div>
          <Badge variant="outline" className={`text-xs ${statusColor}`}>
            {license.status}
          </Badge>
        </div>

        {license.terms && (
          <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{license.terms}</p>
        )}

        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            Fee: <span className="text-foreground font-medium">{feeEth} ETH</span>
          </span>
          <span className="text-muted-foreground">
            Royalty:{' '}
            <span className="text-foreground font-medium">
              {(license.royaltyBps / 100).toFixed(1)}%
            </span>
          </span>
          <span className="text-muted-foreground">{license.durationDays}d</span>
        </div>
      </CardContent>
    </Card>
  );
}

function MerchCard({ item }: { item: any }) {
  const priceEth = item.price ? parseFloat(formatEther(BigInt(item.price))).toFixed(4) : '0';

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        {item.imageUrl && (
          <div className="aspect-square rounded-lg bg-muted overflow-hidden mb-2">
            <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
          </div>
        )}
        <p className="text-xs font-medium truncate">{item.name}</p>
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-primary font-semibold">{priceEth} ETH</span>
          <Badge variant="secondary" className="text-xs">
            {item.category}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

const COLLAB_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  PROPOSED: { label: 'Proposed', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' },
  ACCEPTED: { label: 'Accepted', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  ACTIVE: { label: 'Active', color: 'bg-green-500/10 text-green-400 border-green-500/20' },
  COMPLETED: { label: 'Completed', color: 'bg-muted text-muted-foreground border-border' },
  CANCELLED: { label: 'Cancelled', color: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

function ShopCollabCard({ collab }: { collab: any }) {
  const statusConfig = COLLAB_STATUS_CONFIG[collab.status] ?? COLLAB_STATUS_CONFIG.PROPOSED;

  return (
    <Link to="/collabs" search={{}}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer">
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                <Handshake className="w-4 h-4" />
              </div>
              <div>
                <p className="text-sm font-medium">{collab.title}</p>
                <p className="text-xs text-muted-foreground">
                  {collab.universeA?.slice(0, 8)}… x {collab.universeB?.slice(0, 8)}…
                </p>
              </div>
            </div>
            <Badge variant="outline" className={`text-xs ${statusConfig.color}`}>
              {statusConfig.label}
            </Badge>
          </div>

          {collab.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{collab.description}</p>
          )}

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Split:{' '}
              <span className="text-foreground font-medium">
                {(collab.revenueShareBps / 100).toFixed(1)}%
              </span>
            </span>
            <span className="text-muted-foreground">{collab.episodeCount ?? 0} episodes</span>
            <span className="text-muted-foreground">{collab.durationDays}d</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function SubTierCard({ tier, universeId }: { tier: any; universeId: string }) {
  const TIER_COLORS: Record<string, string> = {
    FREE: 'border-border',
    BASIC: 'border-blue-500/40',
    PREMIUM: 'border-purple-500/40',
    VIP: 'border-yellow-500/40',
  };

  const features = [
    tier.features?.earlyAccess && 'Early access',
    tier.features?.premiumContent && 'Premium content',
    tier.features?.votingBoost && 'Voting boost',
    tier.features?.behindTheScenes && 'Behind the scenes',
    tier.features?.creditBonus && `+${tier.features.creditBonus}% credit bonus`,
  ].filter(Boolean);

  return (
    <Card className={`border-2 ${TIER_COLORS[tier.tier] ?? 'border-border'}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-1.5">
            <Crown className="w-4 h-4" />
            {tier.tier}
          </CardTitle>
          <span className="font-bold text-primary">
            {tier.pricePerMonth === '0' ? 'Free' : `${tier.pricePerMonth} ETH/mo`}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {features.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-1 mb-3">
            {features.map((f) => (
              <li key={f as string} className="flex items-center gap-1">
                <span className="text-primary">✓</span> {f as string}
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/checkout"
          search={{
            listingId: `sub:${universeId}:${tier.tier}`,
            productType: 'SUBSCRIPTION_TIER',
            title: `${tier.tier} Subscription`,
            price: tier.pricePerMonth,
            currency: 'ETH',
          }}
        >
          <Button size="sm" className="w-full">
            Subscribe
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}
