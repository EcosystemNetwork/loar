/**
 * Checkout — unified buy flow for any listing
 *
 * Accepts search params: listingId, productType, title, price, currency
 * Falls back to fetching listing if listingId is a real listing ID.
 */
import { createFileRoute, redirect, useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowLeft, CheckCircle, Loader2, ShieldCheck, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useListing } from '@/hooks/useListings';
import { useWalletAuth, awaitSessionValidation } from '@/lib/wallet-auth';
import { useState, useEffect } from 'react';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import { z } from 'zod';
import { useWriteContract, useSendTransaction } from '@/hooks/useCircleWrite';
import { useChainId } from 'wagmi';
import { parseEther, parseUnits, type Address } from 'viem';
import { useVocab } from '@/hooks/use-vocab';
import { confirmTx } from '@/components/tx-confirm';
import { getEvmAddresses, isZeroAddress } from '@/configs/addresses';
import { ListingPrice, usePriceText } from '@/components/Price';

const TREASURY_ADDRESS = import.meta.env.VITE_TREASURY_ADDRESS as Address | undefined;

const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export const Route = createFileRoute('/checkout')({
  validateSearch: z.object({
    listingId: z.string().optional(),
    productType: z.string().optional(),
    title: z.string().optional(),
    price: z.string().optional(),
    currency: z.string().optional(),
  }),
  // WEB-6: block checkout entry until /auth/me confirms the session. The
  // page fires value-moving transactions (subscription payments, treasury
  // transfers); we do not want them firing with a stale-auth state.
  beforeLoad: async ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/checkout' } });
    }
    await awaitSessionValidation();
  },
  component: CheckoutPage,
});

function CheckoutPage() {
  const navigate = useNavigate();
  const search = useSearch({ from: '/checkout' });
  const { isAuthenticated, isAuthenticating, isConnected, address, sessionReady } = useWalletAuth();
  const v = useVocab();
  const [processing, setProcessing] = useState(false);
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const chainId = useChainId();
  const priceText = usePriceText();
  const LOAR_TOKEN_ADDRESS = getEvmAddresses(chainId)?.loarToken;
  const hasLoarToken = !!LOAR_TOKEN_ADDRESS && !isZeroAddress(LOAR_TOKEN_ADDRESS);

  const { listingId, productType, title, price, currency } = search;

  // If real listing ID, fetch it; otherwise use URL params (for subscription-style flows)
  const isRealListing = listingId && !listingId.startsWith('sub:');
  const { data: listing } = useListing(isRealListing ? listingId! : '');

  if (isAuthenticating || !sessionReady) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const displayTitle = (listing as any)?.title ?? title ?? 'Product';
  const displayPrice = (listing as any)?.price ?? price ?? '0';
  const displayCurrency = (listing as any)?.currency ?? currency ?? 'ETH';
  const displayType = (listing as any)?.productType ?? productType ?? '';

  const isFree = displayPrice === '0' || displayPrice === '';

  async function handleConfirm() {
    if (!isAuthenticated) {
      toast.error('Connect your wallet first');
      return;
    }
    setProcessing(true);
    try {
      if (!isRealListing && listingId?.startsWith('sub:')) {
        // Subscription flow: listingId = "sub:<universeId>:<tier>"
        const [, universeId, tier] = listingId.split(':');
        let txHash = `sub-free-${Date.now()}`;

        // On-chain payment for paid subscription tiers
        const subPrice = parseFloat(displayPrice);
        if (subPrice > 0) {
          if (displayCurrency === 'LOAR' && hasLoarToken && LOAR_TOKEN_ADDRESS) {
            const recipient = TREASURY_ADDRESS;
            if (!recipient) {
              toast.error('Treasury address not configured');
              return;
            }
            const loarAmount = parseUnits(displayPrice, 18);
            // WEB-4: explicit confirm — treasury address comes from env at
            // build time and is a MitM target. Show the user exactly where
            // the tokens are going before the wallet popup.
            const okLoar = await confirmTx({
              title: 'Pay subscription in $LOAR',
              description: `Tier: ${tier} · Universe: ${universeId}`,
              chainName: `Chain ${chainId}`,
              functionName: 'transfer',
              to: LOAR_TOKEN_ADDRESS,
              summary: [
                ['Recipient (treasury)', recipient],
                ['Amount', `${displayPrice} LOAR`],
              ],
              confirmLabel: 'Confirm payment',
            });
            if (!okLoar) {
              toast.info('Payment cancelled');
              return;
            }
            toast.info('Confirm $LOAR transfer in your wallet...');
            txHash = await writeContractAsync({
              address: LOAR_TOKEN_ADDRESS,
              abi: ERC20_ABI,
              functionName: 'transfer',
              args: [recipient, loarAmount],
            });
          } else {
            if (!TREASURY_ADDRESS) {
              toast.error('Treasury address not configured');
              return;
            }
            const ethAmount = parseEther((subPrice / 3000).toFixed(18));
            const okEth = await confirmTx({
              title: 'Pay subscription in ETH',
              description: `Tier: ${tier} · Universe: ${universeId}`,
              chainName: `Chain ${chainId}`,
              functionName: 'sendTransaction',
              to: TREASURY_ADDRESS,
              valueEth: (subPrice / 3000).toFixed(6),
              summary: [['Recipient (treasury)', TREASURY_ADDRESS]],
              confirmLabel: 'Confirm payment',
            });
            if (!okEth) {
              toast.info('Payment cancelled');
              return;
            }
            toast.info('Confirm ETH transfer in your wallet...');
            txHash = await sendTransactionAsync({
              to: TREASURY_ADDRESS,
              value: ethAmount,
            });
          }
          toast.info('Payment sent! Activating subscription...');
        }

        await trpcClient.subscriptions.subscribe.mutate({
          universeId,
          tier: tier as 'FREE' | 'BASIC' | 'PREMIUM' | 'VIP',
          months: 1,
          txHash,
          amount: displayPrice === '0' ? '0' : displayPrice,
        });
        toast.success('Subscription activated!', {
          description: `${tier} access to this universe is now active.`,
        });
        navigate({ to: '/market' });
        return;
      }

      let txHash: string | undefined;

      // For $LOAR listings, transfer tokens on-chain before recording the order
      if (displayCurrency === 'LOAR' && displayPrice !== '0' && !isFree) {
        if (!hasLoarToken || !LOAR_TOKEN_ADDRESS) {
          toast.error('$LOAR token is not deployed on this chain');
          return;
        }
        const recipient =
          ((listing as any)?.sellerAddress as Address | undefined) ?? TREASURY_ADDRESS;
        if (!recipient) {
          toast.error('Treasury address not configured');
          return;
        }
        const loarAmount = parseUnits(displayPrice, 18);
        toast.info('Confirm $LOAR transfer in your wallet…');
        txHash = await writeContractAsync({
          address: LOAR_TOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'transfer',
          args: [recipient, loarAmount],
        });
        toast.info('$LOAR sent! Recording order…');
      }

      const result = await trpcClient.listings.purchase.mutate({
        listingId: listingId!,
        quantity: 1,
        txHash,
      });
      navigate({ to: '/order/$id', params: { id: result.orderId } });
    } catch (e: any) {
      if (!(e instanceof Error && e.message.includes('rejected'))) {
        toast.error(e?.message ?? 'Purchase failed');
      }
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
                  <ListingPrice amount={displayPrice} currency={displayCurrency} />
                </p>
                <p className="text-xs text-muted-foreground">1 item</p>
              </div>
            </div>
            <div className="border-t pt-3 flex justify-between font-semibold">
              <span>Total</span>
              <span className="text-primary">
                <ListingPrice amount={displayPrice} currency={displayCurrency} />
              </span>
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
                  <p className="text-sm font-medium">
                    {displayCurrency === 'LOAR' ? '$LOAR Token' : 'Connected Wallet'}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—'}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`ml-auto text-xs ${displayCurrency === 'LOAR' ? 'text-amber-500 border-amber-500/40' : 'text-green-600'}`}
                >
                  {displayCurrency === 'LOAR' ? '$LOAR' : 'Connected'}
                </Badge>
              </div>
            ) : (
              <div className="text-center py-2">
                <p className="text-sm text-muted-foreground mb-3">No wallet connected</p>
                <Button variant="outline" size="sm" onClick={() => navigate({ to: '/login' })}>
                  {v('connect-wallet')}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Trust signals */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="w-4 h-4 text-green-500 shrink-0" />
          <span>
            Secured by on-chain contract · Creator royalties enforced · Refund via governance
          </span>
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
            {isFree
              ? 'Confirm & Claim'
              : displayCurrency === 'LOAR'
                ? `Pay ${displayPrice} $LOAR`
                : `Confirm Purchase · ${priceText({ eth: parseFloat(displayPrice) }, { hideChain: true })}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
