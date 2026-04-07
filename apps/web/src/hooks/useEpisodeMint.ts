/**
 * useEpisodeMint
 *
 * Records an episode NFT mint in Firestore via tRPC.
 *
 * NOTE: This hook records the mint server-side. On-chain minting requires an
 * EpisodeNFT contract to be deployed and its ABI added to packages/abis/src/generated.ts.
 * Until the contract is audited and deployed, mints are tracked off-chain only.
 * The hook accepts an optional `contractAddress` so it can be wired to writeContract
 * once the contract is live — just uncomment the wagmi section below.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';

interface MintEpisodeParams {
  episodeId: string;
  mintPrice: string; // ETH decimal string
  // contractAddress?: `0x${string}`;  // uncomment when EpisodeNFT is deployed
}

export function useEpisodeMint() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ episodeId, mintPrice }: MintEpisodeParams) => {
      // --- Future: on-chain mint ---
      // const { writeContractAsync } = useWriteContract();
      // const txHash = await writeContractAsync({
      //   address: contractAddress,
      //   abi: episodeNFTAbi,
      //   functionName: 'mint',
      //   args: [episodeId],
      //   value: parseEther(mintPrice),
      // });
      // const tokenId = ... // decode from receipt

      // Off-chain record (Firestore) — replace txHash with real one once contract is live
      const txHash = `pending-${Date.now()}`;
      const tokenId = Math.floor(Math.random() * 1_000_000);

      return trpcClient.nft.recordMint.mutate({
        episodeId,
        tokenId,
        txHash,
        price: mintPrice,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['episode-nfts'] });
      qc.invalidateQueries({ queryKey: ['my-nfts'] });
      toast.success('Episode minted!', {
        description:
          'Your NFT has been recorded. On-chain confirmation will be available after contract deployment.',
      });
    },
    onError: (err: any) => {
      toast.error(err.message || 'Mint failed');
    },
  });
}
