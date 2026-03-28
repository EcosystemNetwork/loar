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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUniverseStorefront } from '@/hooks/useListings';
import { useSubscriptionTiers, useAdSlots } from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { formatEther } from 'viem';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

export const Route = createFileRoute('/shop/$universeId')({
  component: UniverseShopPage,
});

function UniverseShopPage() {
  const { universeId } = useParams({ from: '/shop/$universeId' });

  const { data: storefront, isLoading } = useUniverseStorefront(universeId);
  const { data: subTiers } = useSubscriptionTiers(universeId);
  const { data: universe } = useQuery({
    queryKey: ['universe', universeId],
    queryFn: () => trpcClient.universes.get.query({ id: universeId }),
    enabled: !!universeId,
  });

  const listings = storefront?.listings ?? [];

  const byType = listings.reduce(
    (acc: Record<string, any[]>, l: any) => {
      const k = l.productType ?? 'OTHER';
      acc[k] = [...(acc[k] ?? []), l];
      return acc;
    },
    {}
  );

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
              <img src={(universe as any).thumbnailUrl} alt="" className="w-full h-full object-cover" />
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
              {listings.length > 0 && (
                <Badge variant="secondary">{listings.length} listings</Badge>
              )}
              {subTiers && subTiers.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Crown className="w-3 h-3" />
                  {subTiers.length} subscription tiers
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
              <TabsTrigger value="all" className="flex-1">All</TabsTrigger>
              <TabsTrigger value="subs" className="flex-1">Subscribe</TabsTrigger>
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

function ShopListingCard({ listing }: { listing: any }) {
  return (
    <Link to="/product/$id" params={{ id: listing.id }}>
      <Card className="overflow-hidden hover:border-primary/50 transition-colors cursor-pointer">
        <div className="aspect-square bg-muted flex items-center justify-center">
          {listing.thumbnailUrl ? (
            <img src={listing.thumbnailUrl} alt={listing.title} className="w-full h-full object-cover" />
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
        <Link to="/checkout" search={{ listingId: `sub:${universeId}:${tier.tier}`, productType: 'SUBSCRIPTION_TIER', title: `${tier.tier} Subscription`, price: tier.pricePerMonth, currency: 'ETH' }}>
          <Button size="sm" className="w-full">Subscribe</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
