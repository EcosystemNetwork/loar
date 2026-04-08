/**
 * SUI NFT minting hook.
 * Interacts with nft_episodes, nft_characters, and nft_entities Move modules.
 */
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { useState, useCallback } from 'react';
import { getSuiAddresses } from '@/configs/addresses';
import { SUI_NETWORK } from '@/configs/chains';

export function useSuiMint() {
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const addresses = getSuiAddresses(SUI_NETWORK);

  const mintEpisodeEdition = useCallback(
    async (collectionId: string, episodeId: string, paymentCoinId: string, timestamp: number) => {
      const packageId = addresses.nftEpisodes;
      if (!packageId) {
        setError('nftEpisodes package not deployed');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${packageId}::nft_episodes::mint_edition`,
          arguments: [
            tx.object(collectionId),
            tx.pure.u64(Number(episodeId)),
            tx.object(paymentCoinId),
            tx.pure.u64(timestamp),
          ],
        });

        const result = await signAndExecute({ transaction: tx });
        setTxHash(result.digest);
      } catch (err: any) {
        setError(err.message || 'Mint episode edition failed');
      } finally {
        setIsPending(false);
      }
    },
    [addresses.nftEpisodes, signAndExecute]
  );

  const mintCharacter = useCallback(
    async (
      collectionId: string,
      name: string,
      metadataUri: string,
      contentHash: number[],
      paymentCoinId: string,
      price: number,
      timestamp: number
    ) => {
      const packageId = addresses.nftCharacters;
      if (!packageId) {
        setError('nftCharacters package not deployed');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${packageId}::nft_characters::mint_character`,
          arguments: [
            tx.object(collectionId),
            tx.pure.vector('u8', new TextEncoder().encode(name)),
            tx.pure.vector('u8', new TextEncoder().encode(metadataUri)),
            tx.pure.vector('u8', contentHash),
            tx.object(paymentCoinId),
            tx.pure.u64(price),
            tx.pure.u64(timestamp),
          ],
        });

        const result = await signAndExecute({ transaction: tx });
        setTxHash(result.digest);
      } catch (err: any) {
        setError(err.message || 'Mint character failed');
      } finally {
        setIsPending(false);
      }
    },
    [addresses.nftCharacters, signAndExecute]
  );

  const mintEntity = useCallback(
    async (
      collectionId: string,
      kind: number,
      name: string,
      metadataUri: string,
      contentHash: number[],
      maxEditions: number,
      price: number,
      paymentCoinId: string,
      timestamp: number
    ) => {
      const packageId = addresses.nftEntities;
      if (!packageId) {
        setError('nftEntities package not deployed');
        return;
      }
      setIsPending(true);
      setError(null);

      try {
        const tx = new Transaction();
        tx.moveCall({
          target: `${packageId}::nft_entities::mint_entity`,
          arguments: [
            tx.object(collectionId),
            tx.pure.u8(kind),
            tx.pure.vector('u8', new TextEncoder().encode(name)),
            tx.pure.vector('u8', new TextEncoder().encode(metadataUri)),
            tx.pure.vector('u8', contentHash),
            tx.pure.u64(maxEditions),
            tx.pure.u64(price),
            tx.object(paymentCoinId),
            tx.pure.u64(timestamp),
          ],
        });

        const result = await signAndExecute({ transaction: tx });
        setTxHash(result.digest);
      } catch (err: any) {
        setError(err.message || 'Mint entity failed');
      } finally {
        setIsPending(false);
      }
    },
    [addresses.nftEntities, signAndExecute]
  );

  return {
    mintEpisodeEdition,
    mintCharacter,
    mintEntity,
    isPending,
    error,
    txHash,
  };
}
