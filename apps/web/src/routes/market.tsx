/**
 * Market — Mobile-first discovery hub
 *
 * Browse all listings across the LOAR ecosystem:
 * trending, categories, search, universe storefronts.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Search,
  TrendingUp,
  Sparkles,
  Film,
  Users,
  Package,
  Crown,
  Gavel,
  ShoppingBag,
  Megaphone,
  FileText,
  SlidersHorizontal,
  Store,
  Plus,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useListingsBrowse } from '@/hooks/useListings';
import { useTrending, usePlatformStats } from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import { ListingPrice } from '@/components/Price';

export const Route = createFileRoute('/market')({
  component: MarketPage,
});

const PRODUCT_TYPE_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  ALL: { label: 'All', icon: <Sparkles className="w-4 h-4" /> },
  EPISODE_NFT: { label: 'Episodes', icon: <Film className="w-4 h-4" /> },
  CHARACTER_NFT: { label: 'Characters', icon: <Users className="w-4 h-4" /> },
  ARTIFACT: { label: 'Artifacts', icon: <Package className="w-4 h-4" /> },
  SUBSCRIPTION_TIER: { label: 'Subscriptions', icon: <Crown className="w-4 h-4" /> },
  CANON_LICENSE: { label: 'Canon', icon: <Gavel className="w-4 h-4" /> },
  MERCH: { label: 'Merch', icon: <ShoppingBag className="w-4 h-4" /> },
  SPONSORED_SLOT: { label: 'Ads', icon: <Megaphone className="w-4 h-4" /> },
  IP_LICENSE: { label: 'Licenses', icon: <FileText className="w-4 h-4" /> },
};

const RIGHTS_LABELS: Record<string, string> = {
  all: 'All Rights',
  original: 'Creator-Owned',
  licensed: 'Rights-Cleared',
  fan: 'Fan Works',
};

function MarketPage() {
  const { isAuthenticated } = useWalletAuth();
  const [search, setSearch] = useState('');
  const [productType, setProductType] = useState('ALL');
  const [rightsLane, setRightsLane] = useState('all');
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'popular'>('newest');

  const { data: stats } = usePlatformStats();
  const { data: trending } = useTrending(6);

  const { data: listingsData, isLoading } = useListingsBrowse({
    productType: productType !== 'ALL' ? (productType as any) : undefined,
    rightsLane: rightsLane !== 'all' ? (rightsLane as any) : undefined,
    search: search || undefined,
    sortBy,
  });

  const listings = listingsData?.listings ?? [];

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Hero */}
      <div className="bg-gradient-to-b from-primary/10 to-background px-4 pt-6 pb-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold">LOAR Market</h1>
              <p className="text-sm text-muted-foreground">
                {stats?.universeCount ?? 0} universes · {stats?.totalMints ?? 0} mints
              </p>
            </div>
            {isAuthenticated && (
              <Link to="/sell">
                <Button size="sm" variant="outline" className="gap-1">
                  <Plus className="w-4 h-4" />
                  Sell
                </Button>
              </Link>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search listings…"
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Category pills */}
        <div className="flex gap-2 overflow-x-auto py-3 scrollbar-none -mx-4 px-4">
          {Object.entries(PRODUCT_TYPE_LABELS).map(([type, { label, icon }]) => (
            <button
              key={type}
              onClick={() => setProductType(type)}
              className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                productType === type
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border text-muted-foreground hover:border-primary/50'
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex gap-2 mb-6">
          <Select value={rightsLane} onValueChange={setRightsLane}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SlidersHorizontal className="w-3 h-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(RIGHTS_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
            <SelectTrigger className="h-8 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="popular">Most Popular</SelectItem>
              <SelectItem value="price_asc">Price: Low → High</SelectItem>
              <SelectItem value="price_desc">Price: High → Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Trending universes */}
        {!search && productType === 'ALL' && ((trending as any)?.universes?.length ?? 0) > 0 && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-primary" />
                Trending
              </h2>
            </div>
            <div className="flex gap-3 overflow-x-auto scrollbar-none -mx-4 px-4">
              {((trending as any)?.universes ?? []).slice(0, 6).map((u: any) => (
                <Link key={u.id} to="/shop/$universeId" params={{ universeId: u.id }}>
                  <div className="shrink-0 w-28">
                    <div className="w-28 h-28 rounded-xl bg-muted flex items-center justify-center overflow-hidden mb-1.5">
                      {u.thumbnailUrl ? (
                        <img
                          src={resolveIpfsUrl(u.thumbnailUrl)}
                          alt={u.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Store className="w-8 h-8 text-muted-foreground" />
                      )}
                    </div>
                    <p className="text-xs font-medium truncate">{u.name}</p>
                    <p className="text-xs text-muted-foreground">{u.views ?? 0} views</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Listings grid */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">
              {productType === 'ALL' ? 'All Listings' : PRODUCT_TYPE_LABELS[productType]?.label}
            </h2>
            <span className="text-xs text-muted-foreground">{listings.length} items</span>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : listings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No listings found</p>
              {isAuthenticated && (
                <Link to="/sell/new">
                  <Button variant="outline" size="sm" className="mt-3">
                    Create a listing
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {listings.map((listing: any) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ListingCard({ listing }: { listing: any }) {
  const typeInfo = PRODUCT_TYPE_LABELS[listing.productType] ?? PRODUCT_TYPE_LABELS.ALL;

  return (
    <Link to="/product/$id" params={{ id: listing.id }}>
      <Card className="overflow-hidden hover:border-primary/50 transition-colors cursor-pointer">
        <div className="aspect-square bg-muted flex items-center justify-center relative">
          {listing.thumbnailUrl ? (
            <img
              src={resolveIpfsUrl(listing.thumbnailUrl)}
              alt={listing.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-muted-foreground opacity-30">{typeInfo.icon}</div>
          )}
          <Badge variant="secondary" className="absolute top-1.5 left-1.5 text-xs px-1.5 py-0.5">
            {typeInfo.label}
          </Badge>
        </div>
        <CardContent className="p-2">
          <p className="text-xs font-medium truncate">{listing.title}</p>
          <div className="flex items-center justify-between mt-1">
            <ListingPrice
              amount={listing.price}
              currency={listing.currency}
              className="text-xs text-primary font-semibold"
            />
            {listing.sold > 0 && (
              <span className="text-xs text-muted-foreground">{listing.sold} sold</span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
