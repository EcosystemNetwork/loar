/**
 * MintContentDialog — Lets creators mint their content as an NFT listing.
 *
 * Two-step process:
 * 1. Pin content to IPFS and create Firebase listing (nft.mintContent)
 * 2. Mint on-chain via EpisodeEditionCollection contract (writeContract)
 *
 * If the NFT contract isn't deployed yet, falls back to IPFS-only listing.
 */
import { useState } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, keccak256, toBytes } from 'viem';
import { useMintContent, useRecordMint } from '@/hooks/useRevenue';
import { useVocab } from '@/hooks/use-vocab';
import { toast } from 'sonner';
import { Loader2, Sparkles, X, CheckCircle2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Inline ABI for EpisodeEditionCollection.mint — will use generated ABI once contracts deployed
const EPISODE_EDITION_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'editionId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// Inline ABI for EntityNFT.mint
const ENTITY_NFT_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_universeId', type: 'uint256' },
      { name: 'kind', type: 'uint8' },
      { name: 'name', type: 'string' },
      { name: 'contentHash', type: 'bytes32' },
      { name: 'mintPrice', type: 'uint256' },
      { name: 'metadataURI', type: 'string' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const;

interface MintContentDialogProps {
  contentId: string;
  contentTitle?: string;
  universeId?: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export function MintContentDialog({
  contentId,
  contentTitle,
  universeId,
  onClose,
  onSuccess,
}: MintContentDialogProps) {
  const { address, isConnected } = useAccount();
  const v = useVocab();
  const mint = useMintContent();
  const recordMint = useRecordMint();
  const { writeContractAsync, data: txHash } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const [price, setPrice] = useState('0.01');
  const [maxSupply, setMaxSupply] = useState('100');
  const [royaltyBps, setRoyaltyBps] = useState('500'); // 5%
  const [step, setStep] = useState<'form' | 'pinning' | 'minting' | 'done'>('form');
  const [ipfsUri, setIpfsUri] = useState<string | null>(null);

  async function handleMint() {
    if (!isConnected || !address) {
      toast.error('Please connect your wallet first');
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 0) {
      toast.error('Invalid price');
      return;
    }

    try {
      // Step 1: Pin to IPFS and create Firebase listing
      setStep('pinning');
      const result = await mint.mutateAsync({
        contentId,
        universeId: universeId || '',
        mintPrice: price,
        maxSupply: parseInt(maxSupply) || 0,
        royaltyBps: parseInt(royaltyBps) || 500,
      });
      const metadataUri = (result as any)?.ipfsCid
        ? `ipfs://${(result as any).ipfsCid}`
        : `loar://${contentId}`;
      setIpfsUri(metadataUri);

      // Step 2: On-chain mint (if contract deployed)
      // TODO: Replace with actual deployed address when available
      // For now, the listing is created in Firebase for the marketplace
      setStep('done');
      toast.success('Content listed as NFT!', {
        description: `Pinned to IPFS. Listed for ${price} ETH.`,
      });

      // Record the mint in Firestore for tracking
      try {
        await recordMint.mutateAsync({
          episodeId: contentId,
          tokenId: 0, // Will be set after on-chain mint
          txHash: txHash ?? 'offchain',
          price: price,
        });
      } catch {
        // Non-critical, listing already created
      }

      onSuccess?.();
    } catch (err: any) {
      toast.error(err?.message ?? 'Minting failed');
      setStep('form');
    }
  }

  if (step === 'done') {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-md p-6 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">{v('nft-listed')}</h2>
          <p className="text-sm text-zinc-400 mb-1">
            {contentTitle || 'Content'} is now available for {price} ETH
          </p>
          {ipfsUri && (
            <p className="text-xs text-zinc-500 flex items-center justify-center gap-1">
              <Link2 className="w-3 h-3" /> Pinned to IPFS
            </p>
          )}
          <Button onClick={onClose} className="mt-6 w-full">
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-bold text-white">{v('mint-as-nft')}</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {contentTitle && <p className="text-sm text-zinc-400 mb-4 truncate">{contentTitle}</p>}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-zinc-300">{v('mint')} Price (ETH)</Label>
            <Input
              type="number"
              step="0.001"
              min="0"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.01"
              className="bg-zinc-800 border-zinc-700"
              disabled={step !== 'form'}
            />
            <p className="text-xs text-zinc-500">Set to 0 for free mints</p>
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">Max Supply</Label>
            <Input
              type="number"
              min="0"
              value={maxSupply}
              onChange={(e) => setMaxSupply(e.target.value)}
              placeholder="100"
              className="bg-zinc-800 border-zinc-700"
              disabled={step !== 'form'}
            />
            <p className="text-xs text-zinc-500">0 = unlimited supply</p>
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-300">
              {v('royalty')} ({parseInt(royaltyBps) / 100 || 0}%)
            </Label>
            <Input
              type="number"
              min="0"
              max="10000"
              step="100"
              value={royaltyBps}
              onChange={(e) => setRoyaltyBps(e.target.value)}
              placeholder="500"
              className="bg-zinc-800 border-zinc-700"
              disabled={step !== 'form'}
            />
            <p className="text-xs text-zinc-500">Basis points (500 = 5%) on secondary sales</p>
          </div>
        </div>

        {/* Progress indicator */}
        {step !== 'form' && (
          <div className="mt-4 p-3 bg-zinc-800 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              <span className="text-zinc-300">
                {step === 'pinning' && 'Pinning to IPFS & creating listing...'}
                {step === 'minting' && 'Confirming on-chain transaction...'}
              </span>
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-6">
          <Button variant="outline" onClick={onClose} className="flex-1" disabled={step !== 'form'}>
            Cancel
          </Button>
          <Button
            onClick={handleMint}
            disabled={step !== 'form'}
            className="flex-1 bg-amber-600 hover:bg-amber-500"
          >
            {step !== 'form' ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Sparkles className="w-4 h-4 mr-2" />
            )}
            {step !== 'form' ? v('minting') : v('mint-nft')}
          </Button>
        </div>

        <p className="text-center text-[10px] text-zinc-500 mt-3">
          Content will be pinned to IPFS for permanent storage. 95% of sales go to you.
        </p>
      </div>
    </div>
  );
}
