/**
 * Checkout — unified buy flow for any listing
 *
 * Accepts search params: listingId, productType, title, price, currency
 * Falls back to fetching listing if listingId is a real listing ID.
 */
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle, Loader2, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useListing } from '@/hooks/useListings';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import { z } from 'zod';

export const Route = createFileRoute('/checkout')({
  validateSearch: z.object({
    listingId: z.string().optional(),
    productType: z.string().optional(),
    title: z.string().optional(),
    price: z.string().optional(),
    currency: z.string().optional(),
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/checkout' });
  const { isConnected, address } = useWalletAuth();
  const [processing, setProcessing] = useState(false);

  const { listingId, productType, title, price, currency } = search;

  // If real listing ID, fetch it; otherwise use URL params (for subscription-style flows)
  const isRealListing = listingId && !listingId.startsWith('sub:');
  const { data: listing } = useListing(isRealListing ? listingId! : '');

  const displayTitle = (listing as any)?.title ?? title ?? 'Product';
  const displayPrice = (listing as any)?.price ?? price ?? '0';
  const displayCurrency = (listing as any)?.currency ?? currency ?? 'ETH';
  const displayType = (listing as any)?.productType ?? productType ?? '';

  const isFree = displayPrice === '0' || displayPrice === '';

  async function handleConfirm() {
    if (!isConnected) {
      toast.error('Connect your wallet first');
      return;
    }
    if (!isRealListing) {
      // Subscription / special flow — stub confirmation
      toast.success('Subscription activated!');
      navigate({ to: '/market' });
      return;
    }
    setProcessing(true);
    try {
      const result = await trpcClient.listings.purchase.mutate({
        listingId: listingId!,
        quantity: 1,
      });
      navigate({ to: '/order/$id', params: { id: result.orderId } });
    } catch (e: any) {
      toast.error(e?.message ?? 'Purchase failed');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <button onClick={() => history.back()}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </button>
        <h1 className="font-bold">Checkout</h1>
      </div>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6 space-y-4">
        {/* Order summary */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Order Summary
            </h2>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">{displayTitle}</p>
                {displayType && (
                  <Badge variant="secondary" className="mt-1 text-xs">
                    {displayType.replace(/_/g, ' ')}
                  </Badge>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-lg text-primary">
                  {isFree ? 'Free' : `${displayPrice} ${displayCurrency}`}
                </p>
                <p className="text-xs text-muted-foreground">1 item</p>
              </div>
            </div>
            <div className="border-t pt-3 flex justify-between font-semibold">
              <span>Total</span>
              <span className="text-primary">{isFree ? 'Free' : `${displayPrice} ${displayCurrency}`}</span>
            </div>
          </CardContent>
        </Card>

        {/* Wallet info */}
        <Card>
          <CardContent className="p-4">
            <h2 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide mb-3">
              Payment Method
            </h2>
            {isConnected ? (
              <div className="flex items-center gap-3">
                <Wallet className="w-5 h-5 text-primary" />
                <div>
                  <p className="text-sm font-medium">Connected Wallet</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'}
                  </p>
                </div>
                <Badge variant="outline" className="ml-auto text-xs text-green-600">Connected</Badge>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-sm text-muted-foreground mb-3">No wallet connected</p>
                <Button variant="outline" size="sm" onClick={() => navigate({ to: '/login' })}>
                  Connect Wallet
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trust signals */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
          <span>Secured by on-chain contract · Creator royalties enforced · Refund via governance</span>
        </div>
      </div>

      {/* Confirm bar */}
      <div className="sticky bottom-0 bg-background border-t px-4 py-4 safe-area-bottom">
        <div className="max-w-lg mx-auto">
          <Button
            size="lg"
            className="w-full"
            onClick={handleConfirm}
            disabled={processing || !isConnected}
          >
            {processing ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            {isFree ? 'Confirm & Claim' : `Confirm Purchase · ${displayPrice} ${displayCurrency}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
