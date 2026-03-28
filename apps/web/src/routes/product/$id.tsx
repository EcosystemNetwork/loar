/**
 * Product Detail — full listing view with buy CTA
 */
import { createFileRoute, Link, useParams, useNavigate } from '@tanstack/react-router';
import {
  ArrowLeft,
  Package,
  Crown,
  Film,
  Users,
  ShoppingBag,
  Share2,
  Heart,
  Loader2,
  Store,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useListing } from '@/hooks/useListings';
import { useWalletAuth } from '@/lib/wallet-auth';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';
import { useState } from 'react';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';

export const Route = createFileRoute('/product/$id')({
  component: ProductDetailPage,
});

const PRODUCT_TYPE_ICONS: Record<string, React.ReactNode> = {
  EPISODE_NFT: <Film className="w-5 h-5" />,
  CHARACTER_NFT: <Users className="w-5 h-5" />,
  ARTIFACT: <Package className="w-5 h-5" />,
  SUBSCRIPTION_TIER: <Crown className="w-5 h-5" />,
  MERCH: <ShoppingBag className="w-5 h-5" />,
};

function ProductDetailPage() {
  const { id } = useParams({ from: '/product/$id' });
  const navigate = useNavigate();
  const { isConnected } = useWalletAuth();
  const { data: listing, isLoading } = useListing(id);
  const [buying, setBuying] = useState(false);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4 px-4">
        <Package className="w-12 h-12 text-muted-foreground opacity-30" />
        <p className="text-muted-foreground">Listing not found</p>
        <Link to="/market"><Button variant="outline">Back to Market</Button></Link>
      </div>
    );
  }

  const l = listing as any;
  const isUnlimited = l.supply === 0;
  const soldOut = !isUnlimited && l.sold >= l.supply;
  const supplyPct = isUnlimited ? 0 : Math.round((l.sold / l.supply) * 100);

  async function handleBuy() {
    if (!isConnected) {
      toast.error('Connect your wallet to purchase');
      return;
    }
    setBuying(true);
    try {
      const result = await trpcClient.listings.purchase.mutate({ listingId: id, quantity: 1 });
      navigate({ to: '/order/$id', params: { id: result.orderId } });
    } catch (e: any) {
      toast.error(e?.message ?? 'Purchase failed');
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Back nav */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b px-4 py-3 flex items-center gap-3">
        <button onClick={() => history.back()}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </button>
        <span className="font-semibold truncate flex-1">{l.title}</span>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Share2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Media */}
      <div className="aspect-square max-h-80 w-full bg-muted flex items-center justify-center overflow-hidden">
        {l.mediaUrl || l.thumbnailUrl ? (
          l.mediaUrl?.endsWith('.mp4') || l.mediaUrl?.endsWith('.webm') ? (
            <video
              src={l.mediaUrl}
              controls
              className="w-full h-full object-contain"
              poster={l.thumbnailUrl ?? undefined}
            />
          ) : (
            <img
              src={l.mediaUrl ?? l.thumbnailUrl}
              alt={l.title}
              className="w-full h-full object-contain"
            />
          )
        ) : (
          <div className="text-muted-foreground opacity-20">
            {PRODUCT_TYPE_ICONS[l.productType] ?? <Package className="w-16 h-16" />}
          </div>
        )}
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">
        {/* Title + badges */}
        <div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold leading-tight">{l.title}</h1>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <Heart className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Badge variant="secondary" className="gap-1">
              {PRODUCT_TYPE_ICONS[l.productType]}
              {l.productType?.replace(/_/g, ' ')}
            </Badge>
            <ContentLaneBadge
              classification={l.rightsLane ?? 'original'}
              reviewStatus="not_required"
            />
          </div>
        </div>

        {/* Price card */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-2xl font-bold text-primary">
                  {l.price === '0' ? 'Free' : `${l.price} ${l.currency}`}
                </p>
                {l.royaltyBps > 0 && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {(l.royaltyBps / 100).toFixed(1)}% creator royalty
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{l.sold ?? 0} sold</p>
                {!isUnlimited && (
                  <p className="text-xs text-muted-foreground">
                    {l.supply - l.sold} of {l.supply} remaining
                  </p>
                )}
              </div>
            </div>

            {/* Supply bar */}
            {!isUnlimited && l.supply > 0 && (
              <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${supplyPct}%` }}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Description */}
        {l.description && (
          <div>
            <h2 className="font-semibold mb-1.5">About</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{l.description}</p>
          </div>
        )}

        {/* Universe link */}
        {l.universeId && (
          <Link to="/shop/$universeId" params={{ universeId: l.universeId }}>
            <div className="flex items-center gap-2 p-3 rounded-lg border hover:border-primary/50 transition-colors">
              <Store className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm">View Universe Shop</span>
              <ArrowLeft className="w-4 h-4 ml-auto rotate-180 text-muted-foreground" />
            </div>
          </Link>
        )}
      </div>

      {/* Sticky buy bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t p-4 safe-area-bottom">
        <div className="max-w-2xl mx-auto">
          {soldOut ? (
            <Button disabled className="w-full" size="lg">
              Sold Out
            </Button>
          ) : !isConnected ? (
            <Link to="/login">
              <Button className="w-full" size="lg">Connect Wallet to Buy</Button>
            </Link>
          ) : (
            <Button
              className="w-full"
              size="lg"
              onClick={handleBuy}
              disabled={buying}
            >
              {buying ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              {l.price === '0' ? 'Claim Free' : `Buy for ${l.price} ${l.currency}`}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
