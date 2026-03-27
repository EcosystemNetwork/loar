/**
 * Contract Save Hook
 *
 * Handles saving timeline events to blockchain smart contracts with decentralized storage.
 * Uploads to unified storage (Walrus/IPFS/Synapse/Firebase), stores content hashes on-chain.
 */

import { useCallback } from 'react';
import { type Address, keccak256, toBytes } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { universeAbi } from '@loar/abis/generated';
import { TIMELINE_ADDRESSES, type SupportedChainId } from '@/configs/addresses-test';
import { type GraphData } from '@/hooks/useUniverseBlockchain';

export interface UseContractSaveProps {
  generatedVideoUrl: string | null;
  videoTitle: string;
  videoDescription: string;
  additionType: 'after' | 'branch';
  sourceNodeId: string | null;
  selectedCharacters: string[];
  selectedImageCharacters: string[];
  graphData: GraphData;
  latestNodeId: number;
  universeId: string;
  isBlockchainUniverse: boolean;
  chainId: number;
  setGeneratedVideoUrl: (url: string | null) => void;
  setStorageKey: (key: string) => void;
  setStorageSaved: (saved: boolean) => void;
  setContractSaved: (saved: boolean) => void;
  setIsSavingToContract: (saving: boolean) => void;
  setIsSavingToStorage: (saving: boolean) => void;
  writeContractAsync: any;
  refetchLeaves: () => Promise<any>;
  refetchFullGraph: () => Promise<any>;
  refetchCanonChain: () => Promise<any>;
  refetchLatestNodeId: () => Promise<any>;
}

export interface UseContractSaveReturn {
  handleSaveToContract: () => Promise<void>;
  handleRefreshTimeline: () => Promise<void>;
}

/**
 * Orchestrates saving a generated video to decentralized storage and the blockchain.
 *
 * Flow:
 * 1. Upload video to unified StorageManager (Walrus/IPFS/Synapse/Firebase)
 * 2. Determine the previous node (linear continuation or branch)
 * 3. Compute keccak256 content/plot hashes
 * 4. Call `createNode` on the Universe contract
 * 5. Trigger background wiki generation via tRPC
 * 6. Refresh on-chain data after confirmation
 *
 * @param props - All required state, setters, and refetch functions (see UseContractSaveProps)
 * @returns `{ handleSaveToContract, handleRefreshTimeline }`
 */
export function useContractSave({
  generatedVideoUrl,
  videoTitle,
  videoDescription,
  additionType,
  sourceNodeId,
  selectedCharacters,
  selectedImageCharacters,
  graphData,
  latestNodeId,
  universeId,
  isBlockchainUniverse,
  chainId,
  setGeneratedVideoUrl,
  setStorageKey,
  setStorageSaved,
  setContractSaved,
  setIsSavingToContract,
  setIsSavingToStorage,
  writeContractAsync,
  refetchLeaves,
  refetchFullGraph,
  refetchCanonChain,
  refetchLatestNodeId,
}: UseContractSaveProps): UseContractSaveReturn {
  const queryClient = useQueryClient();

  const handleSaveToContract = useCallback(async () => {
    if (!generatedVideoUrl || !videoTitle || !videoDescription) {
      alert('Video, title, and description are required to save to contract');
      return;
    }

    setIsSavingToContract(true);
    setIsSavingToStorage(true);

    try {
      // Step 1: Upload to decentralized storage via unified StorageManager
      console.log('Step 1: Uploading video to decentralized storage. URL:', generatedVideoUrl);

      let storageUrl: string | null = null;
      let contentHashHex: string | null = null;

      try {
        const uuid = crypto.randomUUID();
        const manifest = await trpcClient.storage.upload.mutate({
          url: generatedVideoUrl,
          filename: `${uuid}.mp4`,
        });

        console.log('Storage upload successful. Content hash:', manifest.contentHash);
        console.log(
          'Providers:',
          manifest.uploads.map((u: { provider: string }) => u.provider).join(', ')
        );

        contentHashHex = manifest.contentHash;
        storageUrl = manifest.uploads[0]?.url || generatedVideoUrl;
        setStorageKey(manifest.contentHash);
        setStorageSaved(true);

        setGeneratedVideoUrl(storageUrl);
      } catch (storageError) {
        console.error('Storage upload failed, proceeding with original URL:', storageError);
        storageUrl = generatedVideoUrl;
      }

      setIsSavingToStorage(false);

      // Step 2: Determine the previous node based on addition type
      let previousNodeId: number;

      if (additionType === 'branch' && sourceNodeId) {
        const numericPart = sourceNodeId.match(/^\d+/);
        previousNodeId = numericPart ? parseInt(numericPart[0]) : 0;
        console.log('Creating branch from event:', sourceNodeId, '-> numeric:', previousNodeId);
      } else {
        const numericIds = graphData.nodeIds.map((id) => {
          const idStr = String(id);
          const numericPart = idStr.match(/^\d+/);
          return numericPart ? parseInt(numericPart[0]) : 0;
        });
        previousNodeId = Math.max(...(numericIds || [0]), 0);
        console.log('Creating linear continuation after event:', previousNodeId);
      }

      // Step 3: Compute content hashes for on-chain storage
      const contentHash: `0x${string}` = contentHashHex
        ? (`0x${contentHashHex}` as `0x${string}`)
        : keccak256(toBytes(storageUrl || generatedVideoUrl));
      const plotHash: `0x${string}` = keccak256(toBytes(videoDescription));

      const videoUrlForEvent = storageUrl || generatedVideoUrl;

      console.log('Step 3: Saving to contract:', {
        contentHash,
        plotHash,
        link: videoUrlForEvent,
        plot: videoDescription,
        previous: previousNodeId,
      });

      // Determine which contract address to use
      const contractAddressToUse = isBlockchainUniverse
        ? (universeId as Address)
        : (TIMELINE_ADDRESSES[chainId as SupportedChainId] as Address);

      // Step 4: Create node on-chain (hashes stored, full strings emitted in event)
      const txHash = await writeContractAsync({
        abi: universeAbi,
        address: contractAddressToUse,
        functionName: 'createNode',
        args: [contentHash, plotHash, BigInt(previousNodeId), videoUrlForEvent, videoDescription],
      });

      console.log('Transaction submitted:', txHash);
      setContractSaved(true);

      toast.success('Event Saved to Blockchain & Decentralized Storage!', {
        description: `Your timeline event has been permanently stored.\nTransaction: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)}`,
        duration: 8000,
      });

      // Step 5: Generate wiki entry in background (non-blocking)
      const previousEvents = graphData.nodeIds
        .slice(-3)
        .map((nodeId, idx) => ({
          title: graphData.descriptions[graphData.nodeIds.length - 3 + idx] || `Event ${nodeId}`,
          description: graphData.descriptions[graphData.nodeIds.length - 3 + idx] || '',
        }))
        .filter((evt) => evt.description.length > 0);

      const characterIdsForWiki =
        selectedImageCharacters.length > 0
          ? selectedImageCharacters
          : selectedCharacters.length > 0
            ? selectedCharacters
            : undefined;

      const newEventId = latestNodeId + 1;

      trpcClient.wiki.generateFromVideo
        .mutate({
          universeId: universeId,
          eventId: String(newEventId),
          videoUrl: videoUrlForEvent,
          title: videoTitle,
          description: videoDescription,
          characterIds: characterIdsForWiki,
          previousEvents: previousEvents.length > 0 ? previousEvents : undefined,
        })
        .then((wikiResult: unknown) => {
          console.log('Wiki generated successfully!', wikiResult);
          toast.success('Wiki Generated!', {
            description: 'AI-powered wiki entry created for your event.',
            duration: 4000,
          });
        })
        .catch((wikiError: unknown) => {
          console.error('Wiki generation failed:', wikiError);
        });

      // Refresh the blockchain data
      setTimeout(async () => {
        if (isBlockchainUniverse) {
          await refetchLeaves();
          await refetchFullGraph();
          await refetchCanonChain();
          await refetchLatestNodeId();
        }
        await queryClient.invalidateQueries();
      }, 5000);
    } catch (error) {
      console.error('Error saving to contract:', error);
      toast.error('Contract Save Failed', {
        description:
          'Failed to save event to blockchain: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
        duration: 5000,
      });
    } finally {
      setIsSavingToContract(false);
      setIsSavingToStorage(false);
    }
  }, [
    generatedVideoUrl,
    videoTitle,
    videoDescription,
    additionType,
    sourceNodeId,
    selectedCharacters,
    selectedImageCharacters,
    graphData.nodeIds,
    graphData.descriptions,
    latestNodeId,
    universeId,
    isBlockchainUniverse,
    chainId,
    setGeneratedVideoUrl,
    setStorageKey,
    setStorageSaved,
    setContractSaved,
    setIsSavingToContract,
    setIsSavingToStorage,
    writeContractAsync,
    refetchLeaves,
    refetchFullGraph,
    refetchCanonChain,
    refetchLatestNodeId,
    queryClient,
  ]);

  const handleRefreshTimeline = useCallback(async () => {
    console.log('Manually refreshing timeline...');
    if (isBlockchainUniverse) {
      await refetchLeaves();
      await refetchFullGraph();
      await refetchCanonChain();
      await refetchLatestNodeId();
    }
    await queryClient.invalidateQueries();
  }, [
    queryClient,
    isBlockchainUniverse,
    refetchLeaves,
    refetchFullGraph,
    refetchCanonChain,
    refetchLatestNodeId,
    universeId,
  ]);

  return {
    handleSaveToContract,
    handleRefreshTimeline,
  };
}
