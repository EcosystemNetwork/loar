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
import { trpc, trpcClient } from '@/utils/trpc';
import { useWriteContract, useSendTransaction } from '@/hooks/useThirdwebWrite';
import { useChainId } from 'wagmi';
import { parseEther, parseUnits, type Address } from 'viem';
import { BuyNFTDialog } from '@/components/BuyNFTDialog';
import { useVocab } from '@/hooks/use-vocab';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getEvmAddresses, isZeroAddress } from '@/configs/addresses';

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
  const v = useVocab();
  const { data: listing, isLoading } = useListing(id);
  const [buying, setBuying] = useState(false);
  const [showNftBuy, setShowNftBuy] = useState(false);
  const { writeContractAsync } = useWriteContract();
  const { sendTransactionAsync } = useSendTransaction();
  const queryClient = useQueryClient();
  const chainId = useChainId();
  const LOAR_TOKEN_ADDRESS = getEvmAddresses(chainId)?.loarToken;
  const hasLoarToken = !!LOAR_TOKEN_ADDRESS && !isZeroAddress(LOAR_TOKEN_ADDRESS);

  // Like system
  const { data: likedData } = useQuery(
    trpc.social.isLiked.queryOptions({ targetId: id }, { enabled: isConnected })
  );
  const { data: likeCountData } = useQuery(trpc.social.getLikeCount.queryOptions({ targetId: id }));
  const isLiked = likedData?.liked ?? false;
  const likeCount = likeCountData?.count ?? 0;

  const likeMutation = useMutation(
    trpc.social.like.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [['social', 'isLiked']] });
        queryClient.invalidateQueries({ queryKey: [['social', 'getLikeCount']] });
      },
    })
  );
  const unlikeMutation = useMutation(
    trpc.social.unlike.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [['social', 'isLiked']] });
        queryClient.invalidateQueries({ queryKey: [['social', 'getLikeCount']] });
      },
    })
  );

  function handleLike() {
    if (!isConnected) {
      toast.error('Connect your wallet to like items');
      return;
    }
    if (isLiked) {
      unlikeMutation.mutate({ targetId: id });
    } else {
      likeMutation.mutate({ targetId: id, targetType: 'listing' });
    }
  }

  async function handleShare() {
    const url = window.location.href;
    const title = listing ? (listing as any).title : 'Check this out on LOAR';
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
      } catch {
        // User cancelled share — ignore
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    }
  }

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
        <Link to="/market">
          <Button variant="outline">Back to Market</Button>
        </Link>
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
      let txHash: string | undefined;

      // Direct ETH/LOAR transfers to seller EOAs are disabled until
      // an escrow or PaymentRouter contract is integrated. Only contract-
      // based purchases (NFT mints) are allowed for paid listings.
      if (
        (l.currency === 'ETH' || l.currency === 'LOAR') &&
        l.price !== '0' &&
        !l.contractAddress
      ) {
        toast.error(
          'Direct purchases are temporarily disabled. This listing needs smart contract integration before it can accept payments.'
        );
        return;
      }

      // For ETH listings routed through a contract, send ETH on-chain
      if (l.currency === 'ETH' && l.price !== '0' && l.contractAddress) {
        const recipient = l.contractAddress as Address;
        toast.info('Confirm ETH payment in your wallet…');
        txHash = await sendTransactionAsync({
          to: recipient,
          value: parseEther(l.price as string),
        });
        toast.info('ETH sent! Recording order…');
      }

      // For $LOAR listings routed through a contract
      if (l.currency === 'LOAR' && l.price !== '0' && l.contractAddress) {
        if (!hasLoarToken || !LOAR_TOKEN_ADDRESS) {
          toast.error('$LOAR token is not deployed on this chain');
          return;
        }
        const recipient = l.contractAddress as Address;
        const loarAmount = parseUnits(l.price as string, 18);
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
        listingId: id,
        quantity: 1,
        txHash,
      });
      navigate({ to: '/order/$id', params: { id: result.orderId } });
    } catch (e: any) {
      if (!(e instanceof Error && e.message.includes('rejected'))) {
        toast.error(e?.message ?? 'Purchase failed');
      }
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
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleShare}>
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
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleLike}
              disabled={likeMutation.isPending || unlikeMutation.isPending}
            >
              <Heart className={`w-4 h-4 ${isLiked ? 'fill-red-500 text-red-500' : ''}`} />
              {likeCount > 0 && (
                <span className="text-xs text-muted-foreground ml-0.5">{likeCount}</span>
              )}
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
              <Button className="w-full" size="lg">
                {v('connect-wallet-to-buy')}
              </Button>
            </Link>
          ) : (
            <Button
              className="w-full"
              size="lg"
              onClick={() => {
                const isNft = ['EPISODE_NFT', 'CHARACTER_NFT', 'ARTIFACT'].includes(l.productType);
                if (isNft && l.contractAddress) {
                  setShowNftBuy(true);
                } else {
                  handleBuy();
                }
              }}
              disabled={buying}
            >
              {buying ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <CheckCircle className="w-4 h-4 mr-2" />
              )}
              {l.price === '0'
                ? 'Claim Free'
                : (l.currency === 'ETH' || l.currency === 'LOAR') && !l.contractAddress
                  ? 'Purchase Unavailable'
                  : l.currency === 'ETH'
                    ? `Pay ${l.price} ETH`
                    : `Buy for ${l.price} ${l.currency}`}
            </Button>
          )}
        </div>
      </div>

      {/* NFT Purchase Dialog */}
      {showNftBuy && (
        <BuyNFTDialog
          listing={{
            id: l.id,
            contentId: l.contentId,
            title: l.title,
            description: l.description,
            imageUrl: l.mediaUrl ?? l.thumbnailUrl,
            mintPrice: l.price ?? '0',
            maxSupply: l.supply ?? 0,
            minted: l.sold ?? 0,
            creator: l.sellerAddress ?? '',
            creatorName: l.sellerName,
            universeId: l.universeId,
            universeName: l.universeName,
            contentType: l.productType,
            contractAddress: l.contractAddress,
            episodeId: l.episodeId,
            metadataUri: l.metadataUri,
          }}
          onClose={() => setShowNftBuy(false)}
          onSuccess={() => {
            setShowNftBuy(false);
            navigate({ to: '/my-works' });
          }}
        />
      )}
    </div>
  );
}
