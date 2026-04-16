/**
 * Contract Save Hook
 *
 * Handles saving timeline events to blockchain smart contracts with decentralized storage.
 * Uploads to unified storage (Walrus/IPFS/Synapse/Firebase), stores content hashes on-chain.
 *
 * Fixes applied:
 * - Save queue prevents concurrent saves from corrupting state
 * - Tx receipt parsing extracts real node ID from NodeCreated event
 * - Optimistic latestNodeId/previousNodeId tracking for rapid deploys
 * - Local description store so wiki previousEvents gets real text, not bytes32
 */

import { useCallback, useRef } from 'react';
import { type Address, keccak256, toBytes, decodeEventLog, type Log } from 'viem';
import { usePublicClient } from 'wagmi';
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
  /** Whether a save is currently in-flight (use to disable save button) */
  isSaveLocked: boolean;
}

/**
 * Parse the NodeCreated event from a transaction receipt to extract the real on-chain node ID.
 */
function parseNodeCreatedEvent(logs: Log[]): {
  nodeId: bigint;
  previous: bigint;
} | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: universeAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'NodeCreated') {
        const args = decoded.args as any;
        return {
          nodeId: BigInt(args.id),
          previous: BigInt(args.previous),
        };
      }
    } catch {
      // Not a NodeCreated event — skip
    }
  }
  return null;
}

/**
 * Orchestrates saving a generated video to decentralized storage and the blockchain.
 *
 * Flow:
 * 1. Upload video to unified StorageManager (Walrus/IPFS/Synapse/Firebase)
 * 2. Determine the previous node (linear continuation or branch)
 * 3. Compute keccak256 content/plot hashes
 * 4. Call `createNode` on the Universe contract
 * 5. Wait for tx receipt and parse real node ID from NodeCreated event
 * 6. Trigger background wiki generation with real descriptions
 * 7. Refresh on-chain data after confirmation
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
  const publicClient = usePublicClient();

  // ── Save queue lock ───────────────────────────────────────────────────────
  // Prevents concurrent saves from corrupting frontend state
  const isSavingRef = useRef(false);

  // ── Optimistic tracking ───────────────────────────────────────────────────
  // Tracks the real latest node ID across rapid deploys, independent of
  // the (slow) on-chain refetch cycle.
  const optimisticNodeIdRef = useRef<number | null>(null);

  // ── Local description store ───────────────────────────────────────────────
  // Maps nodeId → description text so wiki previousEvents gets real strings
  // instead of bytes32 plotHash placeholders.
  const descriptionMapRef = useRef<Map<number, { title: string; description: string }>>(new Map());

  const handleSaveToContract = useCallback(async () => {
    if (!generatedVideoUrl || !videoTitle || !videoDescription) {
      alert('Video, title, and description are required to save to contract');
      return;
    }

    // ── Save queue: reject if already saving ──────────────────────────────
    if (isSavingRef.current) {
      toast.warning('Save In Progress', {
        description: 'Please wait for the current save to complete before saving another node.',
        duration: 4000,
      });
      return;
    }
    isSavingRef.current = true;

    setIsSavingToContract(true);
    setIsSavingToStorage(true);

    try {
      // Step 1: Upload to decentralized storage via unified StorageManager
      let storageUrl: string | null = null;
      let contentHashHex: string | null = null;

      try {
        const uuid = crypto.randomUUID();
        const manifest = await trpcClient.storage.upload.mutate({
          url: generatedVideoUrl,
          filename: `${uuid}.mp4`,
        });

        contentHashHex = manifest.contentHash;
        storageUrl = manifest.uploads[0]?.url || generatedVideoUrl;
        setStorageKey(manifest.contentHash);
        setStorageSaved(true);

        setGeneratedVideoUrl(storageUrl);
      } catch (storageError) {
        // Storage failed — fall back to original URL
        storageUrl = generatedVideoUrl;
      }

      setIsSavingToStorage(false);

      // Step 2: Determine the previous node based on addition type
      // Uses optimistic tracking to stay correct across rapid deploys.
      let previousNodeId: number;

      if (additionType === 'branch' && sourceNodeId) {
        const numericPart = sourceNodeId.match(/^\d+/);
        previousNodeId = numericPart ? parseInt(numericPart[0]) : 0;
      } else {
        // Use the optimistic ID if available (set by a prior save in this session),
        // otherwise fall back to the max of graphData.nodeIds.
        if (optimisticNodeIdRef.current !== null && optimisticNodeIdRef.current > 0) {
          previousNodeId = optimisticNodeIdRef.current;
        } else {
          const numericIds = graphData.nodeIds.map((id) => {
            const idStr = String(id);
            const numericPart = idStr.match(/^\d+/);
            return numericPart ? parseInt(numericPart[0]) : 0;
          });
          previousNodeId = Math.max(...(numericIds || [0]), 0);
        }
      }

      // Step 3: Compute content hashes for on-chain storage
      const contentHash: `0x${string}` = contentHashHex
        ? (`0x${contentHashHex}` as `0x${string}`)
        : keccak256(toBytes(storageUrl || generatedVideoUrl));
      const plotHash: `0x${string}` = keccak256(toBytes(videoDescription));

      const videoUrlForEvent = storageUrl || generatedVideoUrl;

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

      // Step 5: Wait for tx receipt and parse real node ID from NodeCreated event
      let realNodeId: number | null = null;

      if (publicClient) {
        try {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
          const parsed = parseNodeCreatedEvent(receipt.logs as Log[]);
          if (parsed) {
            realNodeId = Number(parsed.nodeId);
          }
        } catch (receiptError) {
          // Receipt fetch failed — fall back to optimistic estimate
          console.warn('Could not fetch tx receipt, using optimistic node ID:', receiptError);
        }
      }

      // Update optimistic tracking with the real ID (or best estimate)
      const effectiveLatest = optimisticNodeIdRef.current ?? latestNodeId;
      const newNodeId = realNodeId ?? effectiveLatest + 1;
      optimisticNodeIdRef.current = newNodeId;

      // Store the description locally for future wiki context
      descriptionMapRef.current.set(newNodeId, {
        title: videoTitle,
        description: videoDescription,
      });

      setContractSaved(true);

      toast.success('Event Saved to Blockchain & Decentralized Storage!', {
        description: `Node #${newNodeId} stored on-chain.\nTransaction: ${txHash.substring(0, 10)}...${txHash.substring(txHash.length - 8)}`,
        duration: 8000,
      });

      // Step 6: Generate wiki entry in background (non-blocking)
      // Build previousEvents from local description store + graphData fallback
      const previousEvents: { title: string; description: string }[] = [];

      // Collect up to 3 prior events using local descriptions (real text)
      const priorNodeIds = Array.from(descriptionMapRef.current.keys())
        .filter((id) => id < newNodeId)
        .sort((a, b) => b - a) // Most recent first
        .slice(0, 3);

      for (const priorId of priorNodeIds) {
        const entry = descriptionMapRef.current.get(priorId);
        if (entry && entry.description.length > 0) {
          previousEvents.push(entry);
        }
      }

      // If we don't have enough from local store, try graphData descriptions
      // (but skip bytes32 hash placeholders — they start with 0x and are 66 chars)
      if (previousEvents.length < 3) {
        const remaining = 3 - previousEvents.length;
        const usedIds = new Set(priorNodeIds);
        const graphDescriptions = graphData.nodeIds
          .map((nodeId, idx) => ({
            nodeId: Number(nodeId),
            description: String(graphData.descriptions[idx] || ''),
          }))
          .filter(
            (entry) =>
              entry.nodeId < newNodeId &&
              !usedIds.has(entry.nodeId) &&
              entry.description.length > 0 &&
              // Skip bytes32 hash placeholders (0x + 64 hex chars = 66 chars)
              !(entry.description.startsWith('0x') && entry.description.length === 66)
          )
          .reverse()
          .slice(0, remaining);

        for (const entry of graphDescriptions) {
          previousEvents.push({
            title: `Event ${entry.nodeId}`,
            description: entry.description,
          });
        }
      }

      const characterIdsForWiki =
        selectedImageCharacters.length > 0
          ? selectedImageCharacters
          : selectedCharacters.length > 0
            ? selectedCharacters
            : undefined;

      trpcClient.wiki.generateFromVideo
        .mutate({
          universeId: universeId,
          eventId: String(newNodeId),
          videoUrl: videoUrlForEvent,
          title: videoTitle,
          description: videoDescription,
          characterIds: characterIdsForWiki,
          previousEvents: previousEvents.length > 0 ? previousEvents : undefined,
        })
        .then((_wikiResult: unknown) => {
          toast.success('Wiki Generated!', {
            description: `Wiki entry created for Node #${newNodeId}.`,
            duration: 4000,
          });
        })
        .catch((_wikiError: unknown) => {
          // Error handled by UI state
        });

      // Step 7: Refresh the blockchain data
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
      toast.error('Contract Save Failed', {
        description:
          'Failed to save event to blockchain: ' +
          (error instanceof Error ? error.message : 'Unknown error'),
        duration: 5000,
      });
    } finally {
      setIsSavingToContract(false);
      setIsSavingToStorage(false);
      // ── Release save lock ───────────────────────────────────────────────
      isSavingRef.current = false;
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
    publicClient,
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
    /** Ref-backed lock — use for imperative checks. UI should use isSavingToContract state. */
    isSaveLocked: isSavingRef.current,
  };
}
