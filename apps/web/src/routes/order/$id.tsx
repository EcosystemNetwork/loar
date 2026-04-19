/**
 * Order Confirmation — post-purchase success screen
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { CheckCircle, Package, Share2, Store, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOrder } from '@/hooks/useListings';
import { toast } from 'sonner';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

export const Route = createFileRoute('/order/$id')({
  component: OrderConfirmationPage,
});

function OrderConfirmationPage() {
  const { id } = useParams({ from: '/order/$id' });
  const { data: order, isLoading } = useOrder(id);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const o = order as any;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="max-w-sm w-full space-y-6 text-center">
        {/* Success animation */}
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-green-500" />
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold">Purchase Complete!</h1>
          <p className="text-muted-foreground mt-1">Your item has been added to your vault.</p>
        </div>

        {/* Order details */}
        {o && (
          <Card>
            <CardContent className="p-4 text-left space-y-3">
              <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                Order Details
              </h2>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                  {o.thumbnailUrl ? (
                    <img
                      src={resolveIpfsUrl(o.thumbnailUrl)}
                      alt={o.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Package className="w-5 h-5 text-muted-foreground opacity-30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{o.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.productType?.replace(/_/g, ' ')}
                  </p>
                </div>
                <Badge variant="default" className="shrink-0">
                  {o.price === '0' ? 'Free' : `${o.price} ${o.currency}`}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground pt-2 border-t">
                Order ID: <span className="font-mono">{id.slice(0, 12)}…</span>
              </div>
              {o.txHash && (
                <div className="text-xs text-muted-foreground">
                  TX: <span className="font-mono">{o.txHash.slice(0, 12)}…</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <Link to="/market">
            <Button variant="outline" className="w-full gap-2">
              <Store className="w-4 h-4" />
              Continue Shopping
            </Button>
          </Link>
          <Button
            variant="ghost"
            className="w-full gap-2"
            onClick={async () => {
              const url = window.location.href;
              const title = o?.title
                ? `I just got "${o.title}" on LOAR!`
                : 'Check out my purchase on LOAR!';
              if (navigator.share) {
                try {
                  await navigator.share({ title, url });
                } catch {
                  /* cancelled */
                }
              } else {
                await navigator.clipboard.writeText(url);
                toast.success('Link copied to clipboard');
              }
            }}
          >
            <Share2 className="w-4 h-4" />
            Share Purchase
          </Button>
        </div>
      </div>
    </div>
  );
}
