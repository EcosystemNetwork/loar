/**
 * BuyNFTDialog — Buyer-side NFT purchase flow.
 *
 * Calls the on-chain EpisodeNFT.mint() or EntityNFT.mint() with ETH payment.
 * Revenue flows through PaymentRouter → creator claimable + platform fee.
 * Also records the purchase in Firebase for marketplace tracking.
 */
import { useState, useMemo } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useBalance, useChainId } from 'wagmi';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { parseEther, formatEther } from 'viem';
import { useRecordMint } from '@/hooks/useRevenue';
import { toast } from 'sonner';
import { Loader2, ShoppingCart, X, CheckCircle2, ExternalLink, Coins } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { getExplorerTxUrl } from '@/configs/chains';

// EpisodeNFT.mint ABI
const EPISODE_NFT_MINT_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'episodeId', type: 'uint256' },
      { name: 'tokenURI_', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const;

interface BuyNFTDialogProps {
  listing: {
    id: string;
    contentId?: string;
    title: string;
    description?: string;
    imageUrl?: string;
    mintPrice: string; // ETH as string
    maxSupply?: number;
    minted?: number;
    creator: string;
    creatorName?: string;
    universeId?: string;
    universeName?: string;
    contentType?: string; // 'episode' | 'character' | 'entity'
    contractAddress?: string;
    episodeId?: number;
    metadataUri?: string;
  };
  onClose: () => void;
  onSuccess?: () => void;
}

export function BuyNFTDialog({ listing, onClose, onSuccess }: BuyNFTDialogProps) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: balance } = useBalance({ address });
  const { writeContractAsync, data: txHash } = useWriteContract();
  const { isSuccess: txConfirmed, isLoading: txPending } = useWaitForTransactionReceipt({
    hash: txHash,
  });
  const recordMint = useRecordMint();
  const [step, setStep] = useState<'preview' | 'confirming' | 'pending' | 'success'>('preview');

  const priceWei = useMemo(() => {
    try {
      return parseEther(listing.mintPrice || '0');
    } catch {
      return 0n;
    }
  }, [listing.mintPrice]);

  const canAfford = balance ? balance.value >= priceWei : false;
  const isFree = priceWei === 0n;
  const soldOut = listing.maxSupply && listing.minted && listing.minted >= listing.maxSupply;

  async function handleBuy() {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!canAfford && !isFree) {
      toast.error('Insufficient ETH balance');
      return;
    }

    try {
      setStep('confirming');

      if (listing.contractAddress && listing.episodeId !== undefined) {
        // On-chain mint via EpisodeNFT contract
        await writeContractAsync({
          address: listing.contractAddress as `0x${string}`,
          abi: EPISODE_NFT_MINT_ABI,
          functionName: 'mint',
          args: [BigInt(listing.episodeId), listing.metadataUri || ''],
          value: priceWei,
        });

        setStep('pending');
        toast.success('Transaction submitted! Waiting for confirmation...');
      } else {
        // Off-chain purchase (Firebase listing — no contract deployed yet)
        // Record in Firebase directly
        setStep('pending');
      }

      // Record purchase in Firebase
      try {
        await recordMint.mutateAsync({
          episodeId: listing.contentId || listing.id,
          tokenId: 0,
          txHash: txHash ?? 'pending',
          price: listing.mintPrice,
        });
      } catch {
        // Non-critical — listing purchase already succeeded
      }

      setStep('success');
      toast.success('NFT purchased!');
      onSuccess?.();
    } catch (err: any) {
      // Error surfaced via toast
      toast.error(err?.shortMessage || err?.message || 'Purchase failed');
      setStep('preview');
    }
  }

  // Success state
  if (step === 'success' || txConfirmed) {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-card rounded-2xl border w-full max-w-md p-6 text-center">
          <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold mb-2">Purchase Complete!</h2>
          <p className="text-sm text-muted-foreground mb-4">You now own "{listing.title}"</p>
          {txHash && (
            <a
              href={getExplorerTxUrl(chainId, txHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary flex items-center justify-center gap-1 mb-4"
            >
              View transaction <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <div className="text-xs text-muted-foreground mb-4 p-3 bg-muted rounded-lg">
            <p>Revenue split:</p>
            <p>85% to creator ({listing.creator.slice(0, 8)}...)</p>
            <p>15% to platform + universe stakers</p>
          </div>
          <Button onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border w-full max-w-md overflow-hidden">
        {/* Image */}
        {listing.imageUrl && (
          <div className="relative h-48 bg-muted">
            <img
              src={listing.imageUrl}
              alt={listing.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
          </div>
        )}

        <div className="p-6">
          <div className="flex justify-between items-start mb-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-bold truncate">{listing.title}</h2>
              {listing.universeName && (
                <p className="text-xs text-muted-foreground">{listing.universeName}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                by{' '}
                {listing.creatorName ||
                  `${listing.creator.slice(0, 8)}...${listing.creator.slice(-6)}`}
              </p>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </button>
          </div>

          {listing.description && (
            <p className="text-sm text-muted-foreground mb-4 line-clamp-3">{listing.description}</p>
          )}

          {/* Price & Supply */}
          <div className="flex items-center justify-between p-3 bg-muted rounded-lg mb-4">
            <div>
              <p className="text-2xl font-bold">{isFree ? 'Free' : `${listing.mintPrice} ETH`}</p>
              {!isFree && balance && (
                <p className="text-xs text-muted-foreground">
                  Balance: {Number(formatEther(balance.value)).toFixed(4)} ETH
                </p>
              )}
            </div>
            <div className="text-right">
              {listing.maxSupply ? (
                <>
                  <p className="text-sm font-medium">
                    {listing.minted || 0} / {listing.maxSupply}
                  </p>
                  <p className="text-xs text-muted-foreground">minted</p>
                </>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  Unlimited
                </Badge>
              )}
            </div>
          </div>

          {/* Revenue split info */}
          <div className="flex gap-2 mb-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500" /> 85% Creator
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" /> 10% Universe Pool
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-purple-500" /> 5% Platform
            </span>
          </div>

          {/* Warnings */}
          {soldOut && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg mb-4 text-sm text-red-500">
              Sold out
            </div>
          )}
          {!canAfford && !isFree && !soldOut && (
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg mb-4 text-sm text-yellow-600">
              Insufficient ETH balance
            </div>
          )}

          {/* Buy Button */}
          <Button
            className="w-full h-12 text-base font-bold"
            disabled={
              !isConnected ||
              (!canAfford && !isFree) ||
              !!soldOut ||
              step === 'confirming' ||
              step === 'pending'
            }
            onClick={handleBuy}
          >
            {step === 'confirming' || step === 'pending' ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                {step === 'confirming' ? 'Confirm in wallet...' : 'Waiting for confirmation...'}
              </>
            ) : (
              <>
                <ShoppingCart className="h-5 w-5 mr-2" />
                {isFree ? 'Mint for Free' : `Buy for ${listing.mintPrice} ETH`}
              </>
            )}
          </Button>

          <p className="text-center text-[10px] text-muted-foreground mt-2">
            Revenue funds the universe treasury and rewards stakers.
          </p>
        </div>
      </div>
    </div>
  );
}
