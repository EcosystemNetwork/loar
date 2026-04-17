/**
 * Universe Timeline Editor Route
 *
 * Main workspace for a single narrative universe. Renders a ReactFlow-based
 * timeline graph where users can view, create, and branch narrative events.
 * Integrates AI video/image generation, character management, blockchain
 * contract interactions, and governance sidebar.
 */

import { createFileRoute, Link, useNavigate, useParams } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Home, Upload, Link2, Video, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import ReactFlow, {
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  Panel,
  MarkerType,
  addEdge,
  type Node,
  type Edge,
  type Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { TimelineEventNode } from '@/components/flow/TimelineNodes';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useChainId } from 'wagmi';
import { useWriteContract } from '@/hooks/useThirdwebWrite';
import type { TimelineNodeData } from '@/components/flow/TimelineNodes';
import { UniverseSidebar } from '@/components/UniverseSidebar';
import { FlowCreationPanel } from '@/components/FlowCreationPanel';
import { GovernanceSidebar } from '@/components/GovernanceSidebar';
import { GenerationsPanel } from '@/components/GenerationsPanel';
import { calculateTreeLayout, normalizeNodeId, getEventLabel } from '@/utils/treeLayout';
import { useVideoGeneration, type StatusMessage } from '@/hooks/useVideoGeneration';
import { useCharacterGeneration } from '@/hooks/useCharacterGeneration';
import { useContractSave } from '@/hooks/useContractSave';
import { useUniverseBlockchain } from '@/hooks/useUniverseBlockchain';
import { TokenGateGuard } from '@/components/governance/TokenGateGuard';
import { PrivateSection } from '@/components/private/PrivateSection';

// Register custom node types
const nodeTypes = {
  timelineEvent: TimelineEventNode,
};

function UniverseTimelineEditor() {
  const { id } = useParams({ from: '/universe/$id' });
  const navigate = useNavigate();
  const chainId = useChainId();

  // Timeline flow state
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState<Node<TimelineNodeData> | null>(null);
  const [eventCounter, setEventCounter] = useState(1);

  // Timeline parameters
  const [timelineTitle, setTimelineTitle] = useState('Universe Timeline');
  const [timelineDescription, setTimelineDescription] = useState(
    'Blockchain-powered narrative timeline'
  );
  const [selectedEventTitle, setSelectedEventTitle] = useState('');
  const [selectedEventDescription, setSelectedEventDescription] = useState('');

  // Video generation dialog state
  const [showVideoDialog, setShowVideoDialog] = useState(false);
  const [videoTitle, setVideoTitle] = useState('');
  const [videoDescription, setVideoDescription] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState<string | null>(null);
  const [additionType, setAdditionType] = useState<'after' | 'branch'>('after');
  const [selectedVideoModel, setSelectedVideoModel] = useState<
    'fal-veo3' | 'fal-kling' | 'fal-wan25' | 'fal-sora' | 'seedance' | 'seedance-fast'
  >('seedance');
  const [selectedVideoDuration, setSelectedVideoDuration] = useState<number>(8);
  const [negativePrompt, setNegativePrompt] = useState('');
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoRatio, setVideoRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [imageFormat, setImageFormat] = useState<
    'landscape_16_9' | 'portrait_16_9' | 'landscape_4_3' | 'portrait_4_3'
  >('landscape_16_9');

  // Status message for sidebar
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);

  // Image generation state
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [showVideoStep, setShowVideoStep] = useState(false);

  // Character selection state
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [showCharacterSelector, setShowCharacterSelector] = useState(false);
  const [showCharacterGenerator, setShowCharacterGenerator] = useState(false);
  const [characterName, setCharacterName] = useState('');
  const [characterDescription, setCharacterDescription] = useState('');
  const [characterStyle, setCharacterStyle] = useState<
    'cute' | 'realistic' | 'anime' | 'fantasy' | 'cyberpunk'
  >('cute');
  const [isGeneratingCharacter, setIsGeneratingCharacter] = useState(false);
  const [generatedCharacter, setGeneratedCharacter] = useState<{
    name: string;
    description: string;
    style: string;
    imageUrl: string;
    characterId?: string;
  } | null>(null);

  // Image-to-video character selection (1-2 max)
  const [selectedImageCharacters, setSelectedImageCharacters] = useState<string[]>([]);

  // Generations panel state
  const [showGenerationsPanel, setShowGenerationsPanel] = useState(false);

  // File upload state
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Edit video dialog state
  const [editVideoDialogOpen, setEditVideoDialogOpen] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editVideoUrl, setEditVideoUrl] = useState('');
  const [editVideoFile, setEditVideoFile] = useState<File | null>(null);
  const [editVideoPreview, setEditVideoPreview] = useState<string | null>(null);
  const [isUploadingEditVideo, setIsUploadingEditVideo] = useState(false);
  const editFileInputRef = useRef<HTMLInputElement>(null);

  // Contract integration state
  const [isSavingToContract, setIsSavingToContract] = useState(false);
  const [contractSaved, setContractSaved] = useState(false);

  // Governance state
  const [showGovernanceSidebar, setShowGovernanceSidebar] = useState(false);

  // Creator's Room state
  const [showCreatorsRoom, setShowCreatorsRoom] = useState(false);

  // Storage integration state
  const [isSavingToStorage, setIsSavingToStorage] = useState(false);
  const [storageSaved, setStorageSaved] = useState(false);
  const [storageKey, setStorageKey] = useState<string | null>(null);

  // Music/soundtrack state
  const [soundtrackUrl, setSoundtrackUrl] = useState<string>('');
  const [soundtrackName, setSoundtrackName] = useState<string>('');

  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Contract hooks - we'll use the write contract directly for universe-specific contracts
  const { writeContractAsync } = useWriteContract();

  // For blockchain universes (addresses starting with 0x), fetch from indexer
  const isBlockchainUniverse = id?.startsWith('0x');

  // Unified query that checks Firestore, localStorage, and indexer
  const { data: universe, isLoading: isLoadingUniverse } = useQuery({
    queryKey: ['universe-metadata', id],
    queryFn: async () => {
      // 1. Try Firestore (off-chain, editable metadata)
      if (isBlockchainUniverse) {
        try {
          const fsResult = await trpcClient.universes.get.query({ id: id! });
          if (fsResult?.data) {
            const d = fsResult.data as Record<string, any>;
            return {
              id: d.id,
              name: d.name ?? d.address,
              description: d.description,
              imageUrl: d.image_url ?? d.imageUrl,
              address: d.address,
              tokenAddress: d.tokenAddress,
              governanceAddress: d.governanceAddress,
              isDefault: false,
            };
          }
        } catch {
          // Firestore miss — continue
        }
      }

      // 2. Check localStorage (just-created universes before Firestore record exists)
      const stored = localStorage.getItem('createdUniverses');
      const universes = stored ? JSON.parse(stored) : [];
      const found = universes.find((u: any) => u.id === id);
      if (found) return found;

      // 3. Fall back to indexer (on-chain immutable values)
      if (isBlockchainUniverse) {
        try {
          const ponderUrl = import.meta.env.VITE_PONDER_URL || 'http://localhost:42069';
          const response = await fetch(`${ponderUrl}/universe/${id}`);
          if (!response.ok) return null;
          const data = await response.json();
          if (data.universe) {
            return {
              id: data.universe.id,
              name: data.universe.name,
              description: data.universe.description,
              imageUrl: data.universe.imageURL,
              address: data.universe.id,
              tokenAddress: data.universe.tokenAddress,
              governanceAddress: data.universe.governorAddress,
              isDefault: false,
            };
          }
        } catch {
          // Indexer fetch failed; fall through to return null
        }
      }

      return null;
    },
  });

  // Fallback for blockchain universes if not found
  const finalUniverse =
    universe ||
    (isBlockchainUniverse
      ? {
          id: id,
          name: `Universe ${id.slice(0, 8)}...`,
          description: 'Blockchain-based cinematic universe',
          address: id,
          isDefault: false,
          tokenAddress: null,
          governanceAddress: null,
        }
      : null);

  // Each universe with a 0x address IS its own Timeline contract
  // So we use the universe ID as the contract address
  const timelineContractAddress = isBlockchainUniverse
    ? id // Use the universe ID as the contract address
    : universe?.address || undefined; // For non-blockchain universes, use the stored address

  // Blockchain data fetching - using extracted hook
  const {
    graphData,
    latestNodeId,
    leavesData,
    isLoadingLeaves,
    isLoadingFullGraph,
    isLoadingCanonChain,
    isLoadingAny,
    refetchLeaves,
    refetchFullGraph,
    refetchCanonChain,
    refetchLatestNodeId,
  } = useUniverseBlockchain({
    universeId: id,
    contractAddress: timelineContractAddress,
    isBlockchainUniverse,
  });

  // Update timeline title when universe data loads
  useEffect(() => {
    const universeToUse =
      universe ||
      (isBlockchainUniverse
        ? {
            name: `Universe ${id.slice(0, 8)}...`,
            description: 'Blockchain-based cinematic universe',
          }
        : null);

    if (universeToUse?.name) {
      setTimelineTitle(universeToUse.name);
      setTimelineDescription(universeToUse.description || 'Blockchain-powered narrative timeline');
    }
  }, [universe, id, isBlockchainUniverse]);

  // Fetch available characters for this universe
  const {
    data: charactersData,
    isLoading: isLoadingCharacters,
    refetch: refetchCharacters,
  } = useQuery({
    queryKey: ['characters', id],
    queryFn: () => trpcClient.wiki.characters.query({ universeId: id }),
  });

  // Analyze character image with Gemini
  const analyzeCharacterMutation = useMutation({
    mutationFn: async (input: {
      imageUrl: string;
      characterName: string;
      userDescription: string;
    }) => {
      const result = await trpcClient.image.analyzeCharacter.mutate(input);
      return result;
    },
  });

  // Generate character mutation (with optional DB save)
  const generateCharacterMutation = useMutation({
    mutationFn: async (input: {
      name: string;
      description: string;
      style: 'cute' | 'realistic' | 'anime' | 'fantasy' | 'cyberpunk';
      saveToDatabase?: boolean;
      detailedVisualDescription?: string;
    }) => {
      const result = await trpcClient.image.generateCharacter.mutate({
        ...input,
        saveToDatabase: input.saveToDatabase ?? false,
        universeId: id,
      });
      return result;
    },
    onSuccess: async (data) => {
      setIsGeneratingCharacter(false);

      // Store generated character for preview
      setGeneratedCharacter({
        name: characterName,
        description: characterDescription,
        style: characterStyle,
        imageUrl: data.imageUrl,
      });
    },
    onError: (error) => {
      alert('Failed to generate character. Please try again.');
      setIsGeneratingCharacter(false);
    },
  });

  // Save character to database mutation (uses existing image URL, no regeneration)
  const saveCharacterMutation = useMutation({
    mutationFn: async (input: {
      name: string;
      description: string;
      imageUrl: string;
      style: 'cute' | 'realistic' | 'anime' | 'fantasy' | 'cyberpunk';
      detailedVisualDescription?: string;
    }) => {
      const result = await trpcClient.image.saveCharacter.mutate({
        ...input,
        universeId: id,
      });
      return result;
    },
    onSuccess: async (data) => {
      // Add to selected characters
      if (data.characterId) {
        setSelectedCharacters((prev) => [...prev, data.characterId!]);
      }

      // Clear generated character and close dialog
      setGeneratedCharacter(null);
      setShowCharacterGenerator(false);

      // Refetch characters to include the new one
      await refetchCharacters();
    },
    onError: (error) => {
      alert('Failed to save character to database. Please try again.');
    },
  });

  // Character generation - using extracted hook
  const {
    isGeneratingImage,
    generateImageMutation,
    handleGenerateEventImage,
    handleGenerateCharacterFrame,
  } = useCharacterGeneration({
    selectedCharacters,
    selectedImageCharacters,
    charactersData,
    imageFormat,
    videoDescription,
    setGeneratedImageUrl,
    setShowVideoStep,
    setStatusMessage,
  });

  // Video generation - using extracted hook
  const {
    isGeneratingVideo,
    handleGenerateVideo: handleGenerateVideoFromHook,
    generateVideoMutation,
  } = useVideoGeneration({
    videoDescription,
    selectedVideoModel,
    selectedVideoDuration,
    videoRatio,
    negativePrompt,
    videoPrompt,
    setGeneratedVideoUrl,
    setStatusMessage,
  });

  // Wrapper to call the hook's handler with the correct parameters
  const handleGenerateVideo = useCallback(async () => {
    await handleGenerateVideoFromHook(generatedImageUrl, uploadedUrl);
  }, [handleGenerateVideoFromHook, generatedImageUrl, uploadedUrl]);

  // Upload generated image to decentralized storage
  const uploadToStorage = useCallback(async () => {
    if (!generatedImageUrl) return;

    setIsUploading(true);
    try {
      // Convert data URL to blob
      const response = await fetch(generatedImageUrl);
      const blob = await response.blob();

      // Convert blob to base64 for tRPC upload
      const arrayBuffer = await blob.arrayBuffer();
      const base64 = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      // Upload via unified storage service
      const manifest = await trpcClient.storage.uploadDirect.mutate({
        data: base64,
        filename: `generated-image-${Date.now()}.png`,
        mimeType: 'image/png',
      });

      const publicUrl = manifest.uploads[0]?.url;
      if (publicUrl) {
        setUploadedUrl(publicUrl);
      } else {
        throw new Error('No URL returned from storage');
      }
    } catch (error) {
      alert('Failed to upload image. Please try again.');
    } finally {
      setIsUploading(false);
    }
  }, [generatedImageUrl]);

  // Contract save - using extracted hook
  const { handleSaveToContract, handleRefreshTimeline, isSaveLocked } = useContractSave({
    generatedVideoUrl,
    videoTitle,
    videoDescription,
    additionType,
    sourceNodeId,
    selectedCharacters,
    selectedImageCharacters,
    graphData,
    latestNodeId,
    universeId: id,
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
  });

  // Handle opening governance sidebar
  const handleOpenGovernance = useCallback(() => {
    setShowGovernanceSidebar(true);
  }, []);

  // Handle showing video generation dialog
  // Preserves character selections, video model, duration, ratio, and image format
  // across sequential deploys so users don't re-pick everything for each node.
  // Only per-node content (title, description, generated media) is reset.
  const handleAddEvent = useCallback((type: 'after' | 'branch' = 'after', nodeId?: string) => {
    setAdditionType(type);
    setSourceNodeId(nodeId || null);
    // Per-node content — always reset
    setVideoTitle('');
    setVideoDescription('');
    setGeneratedImageUrl(null);
    setGeneratedVideoUrl(null);
    setShowVideoStep(false);
    setUploadedUrl(null);
    setContractSaved(false);
    setIsSavingToContract(false);
    setNegativePrompt(''); // Reset negative prompt (scene-specific)
    setVideoPrompt(''); // Reset video prompt (scene-specific)
    setSoundtrackUrl(''); // Reset soundtrack URL
    setSoundtrackName(''); // Reset soundtrack name
    setStatusMessage(null); // Clear any status messages
    // Carried forward between sequential deploys:
    // - selectedVideoModel (kept)
    // - selectedVideoDuration (kept)
    // - videoRatio (kept)
    // - imageFormat (kept)
    // - selectedCharacters (kept)
    // - selectedImageCharacters (kept)
    setShowVideoDialog(true);
  }, []);

  // Handle editing video on an existing node
  const handleEditScene = useCallback(
    (eventId: string) => {
      if (!eventId) return;

      // Load current video URL from localStorage or from the node
      const storageKey = `universe_events_${id}`;
      const storedEvents = localStorage.getItem(storageKey);
      const eventsData = storedEvents ? JSON.parse(storedEvents) : {};
      const eventData = eventsData[eventId];

      // Also check the current node in the flow for its videoUrl
      const node = nodes.find(
        (n) => n.data.eventId === eventId || n.data.blockchainNodeId?.toString() === eventId
      );
      const currentUrl = eventData?.videoUrl || node?.data.videoUrl || '';

      setEditingEventId(eventId);
      setEditVideoUrl(currentUrl);
      setEditVideoFile(null);
      setEditVideoPreview(currentUrl || null);
      setEditVideoDialogOpen(true);
    },
    [id, nodes]
  );

  // Handle file selection for edit video
  const handleEditVideoFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      alert('Please select a video file');
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      alert('File too large (max 200MB)');
      return;
    }
    setEditVideoFile(file);
    setEditVideoPreview(URL.createObjectURL(file));
    setEditVideoUrl(''); // Clear URL input when file is selected
  }, []);

  // Save edited video — upload file if needed, then update localStorage + node
  const handleSaveEditVideo = useCallback(async () => {
    if (!editingEventId) return;

    let finalUrl = editVideoUrl.trim();

    // If a file was selected, upload it first
    if (editVideoFile) {
      setIsUploadingEditVideo(true);
      try {
        const serverUrl = import.meta.env.VITE_SERVER_URL || '';

        // Verify session
        const meRes = await fetch(`${serverUrl}/auth/me`, { credentials: 'include' });
        if (!meRes.ok || !(await meRes.json()).authenticated) {
          alert('Session expired. Please sign in again.');
          setIsUploadingEditVideo(false);
          return;
        }

        const formData = new FormData();
        formData.append('file', editVideoFile);

        const response = await fetch(`${serverUrl}/api/upload`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!response.ok) throw new Error('Upload failed');

        const { manifest } = await response.json();
        const url = manifest?.uploads?.[0]?.url;
        if (!url) throw new Error('No URL returned from upload');
        finalUrl = url;
      } catch (error) {
        alert(
          'Failed to upload video: ' + (error instanceof Error ? error.message : 'Unknown error')
        );
        setIsUploadingEditVideo(false);
        return;
      }
      setIsUploadingEditVideo(false);
    }

    if (!finalUrl) {
      alert('Please provide a video URL or upload a file');
      return;
    }

    // Update localStorage
    const storageKey = `universe_events_${id}`;
    const storedEvents = localStorage.getItem(storageKey);
    const eventsData = storedEvents ? JSON.parse(storedEvents) : {};
    if (eventsData[editingEventId]) {
      eventsData[editingEventId].videoUrl = finalUrl;
    } else {
      eventsData[editingEventId] = {
        eventId: editingEventId,
        videoUrl: finalUrl,
        timestamp: Date.now(),
      };
    }
    localStorage.setItem(storageKey, JSON.stringify(eventsData));

    // Update the node in the flow
    setNodes((nds: any) =>
      nds.map((node: any) => {
        const nodeEventId = node.data.eventId;
        const nodeBlockchainId = node.data.blockchainNodeId?.toString();
        if (nodeEventId === editingEventId || nodeBlockchainId === editingEventId) {
          return {
            ...node,
            data: {
              ...node.data,
              videoUrl: finalUrl,
            },
          };
        }
        return node;
      })
    );

    // Close dialog
    setEditVideoDialogOpen(false);
    setEditingEventId(null);
    setEditVideoUrl('');
    setEditVideoFile(null);
    setEditVideoPreview(null);
  }, [editingEventId, editVideoUrl, editVideoFile, id, setNodes]);

  // Handle selecting a generation from the panel — pre-fills dialog with video ready to save
  const handleSelectGeneration = useCallback(
    (gen: {
      videoUrl: string;
      title: string;
      description: string;
      generationId: string;
      model: string;
    }) => {
      setAdditionType('after');
      setSourceNodeId(null);
      setVideoTitle(gen.title);
      setVideoDescription(gen.description);
      setGeneratedVideoUrl(gen.videoUrl);
      setGeneratedImageUrl(null);
      setShowVideoStep(true);
      setUploadedUrl(null);
      setContractSaved(false);
      setIsSavingToContract(false);
      setStatusMessage({
        type: 'info',
        title: 'Video Loaded',
        description: `Loaded "${gen.title.slice(0, 40)}..." from generations. Save to timeline to commit on-chain.`,
      });
      setShowGenerationsPanel(false);
      setShowVideoDialog(true);
    },
    []
  );

  // Handle drop from generations panel onto the ReactFlow canvas
  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const data = event.dataTransfer.getData('application/json');
      if (!data) return;
      try {
        const gen = JSON.parse(data);
        if (gen.videoUrl) {
          handleSelectGeneration(gen);
        }
      } catch {
        // Not a valid generation drop
      }
    },
    [handleSelectGeneration]
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  // Handle creating actual event after dialog submission - Keep universe branch logic
  const handleCreateEvent = useCallback(() => {
    if (!videoTitle.trim()) return;

    // Find source node if specified
    const sourceNode = sourceNodeId
      ? nodes.find((n) => n.data.eventId === sourceNodeId || n.id === sourceNodeId)
      : null;
    const lastEventNode = nodes.filter((n: any) => n.data.nodeType === 'scene').pop();
    const referenceNode = sourceNode || lastEventNode;

    // Generate appropriate event ID based on addition type - Keep universe branch logic
    let newEventId: string;
    let newAddId: string;

    if (additionType === 'branch' && sourceNodeId) {
      // For branches, add a letter suffix to the source node ID
      const sourceEventId = sourceNodeId;

      // Find all existing branches from this source node
      const existingBranches = nodes.filter((n: any) => {
        const eventId = n.data.eventId?.toString();
        return eventId && eventId.startsWith(sourceEventId) && /[a-z]/.test(eventId);
      });

      // Determine the next branch letter
      const branchLetter = String.fromCharCode(98 + existingBranches.length); // 'b', 'c', 'd', etc.
      newEventId = `${sourceEventId}${branchLetter}`;
      newAddId = `add-${newEventId}`;
    } else {
      // For linear continuation, determine if we're continuing a branch or main timeline
      const sceneNodes = nodes.filter((n: any) => n.data.nodeType === 'scene');

      if (sceneNodes.length === 0) {
        // First event
        newEventId = '1';
      } else {
        // Find the rightmost (last added) event to continue from
        const lastNode = sceneNodes.reduce((latest: any, node: any) => {
          if (!latest) return node;
          // Compare positions to find the rightmost node
          return node.position.x > latest.position.x ? node : latest;
        }, null);

        const lastEventId = lastNode?.data.eventId?.toString();

        if (lastEventId && /[a-z]/.test(lastEventId)) {
          // We're continuing a branch (e.g., from "1b" to "1c")
          const baseNumber = lastEventId.replace(/[a-z]/g, '');
          const lastLetter = lastEventId.match(/[a-z]/)?.[0] || 'a';
          const nextLetter = String.fromCharCode(lastLetter.charCodeAt(0) + 1);
          newEventId = `${baseNumber}${nextLetter}`;
        } else {
          // We're continuing the main timeline (e.g., from "2" to "3")
          const maxEventId = sceneNodes.reduce((max: number, node: any) => {
            const eventId = node.data.eventId;
            if (eventId) {
              // Extract numeric part only (ignore branch suffixes like 'b', 'c')
              const numericId = parseInt(eventId.toString().replace(/[a-z]/g, ''));
              return !isNaN(numericId) ? Math.max(max, numericId) : max;
            }
            return max;
          }, 0);
          newEventId = String(maxEventId + 1);
        }
      }
      newAddId = `add-${newEventId}`;
    }

    // Calculate position based on addition type and depth in tree
    let newEventPosition;
    let newAddPosition;

    const horizontalSpacing = 420;
    const verticalSpacing = 320; // Match blockchain node spacing

    if (additionType === 'branch' && sourceNode) {
      // Create branch: same X depth as if it were a linear continuation, but offset vertically
      // Count how many children the source node already has to position this branch correctly
      const sourceChildren = nodes.filter((n: any) => {
        const parentMatch = edges.find((e) => e.source === sourceNode.id && e.target === n.id);
        return parentMatch && n.data.nodeType === 'scene';
      });

      const branchIndex = sourceChildren.length; // 0-based index for this new branch
      const branchY = sourceNode.position.y + branchIndex * verticalSpacing;

      // Use same X as linear continuation would use
      newEventPosition = { x: sourceNode.position.x + horizontalSpacing, y: branchY };
      newAddPosition = { x: sourceNode.position.x + horizontalSpacing * 2, y: branchY };
    } else {
      // Linear addition to the right of the reference node (or source node)
      if (referenceNode) {
        // Place after the specific reference/source node at same depth
        newEventPosition = {
          x: referenceNode.position.x + horizontalSpacing,
          y: referenceNode.position.y,
        };
        newAddPosition = {
          x: referenceNode.position.x + horizontalSpacing * 2,
          y: referenceNode.position.y,
        };
      } else {
        // No reference node, start fresh
        newEventPosition = { x: 100, y: 100 };
        newAddPosition = { x: 100 + horizontalSpacing, y: 100 };
      }
    }

    // Generate user-friendly display name - Keep it simple for universe branch
    const displayName = newEventId;

    // Create new event node
    const newEventNode: Node<TimelineNodeData> = {
      id: newEventId,
      type: 'timelineEvent',
      position: newEventPosition,
      data: {
        label: videoTitle,
        description: videoDescription,
        timelineColor: additionType === 'branch' ? '#f59e0b' : '#10b981',
        nodeType: 'scene',
        eventId: newEventId,
        displayName: displayName, // User-friendly display name
        timelineId: `timeline-${id}`,
        universeId: id,
        onAddScene: handleAddEvent,
        onEditScene: handleEditScene,
      },
    };

    // Create new add button node
    const newAddNode: Node<TimelineNodeData> = {
      id: newAddId,
      type: 'timelineEvent',
      position: newAddPosition,
      data: {
        label: '',
        description: '',
        nodeType: 'add',
        onAddScene: handleAddEvent,
      },
    };

    // Create edges
    const newEdges: Edge[] = [];
    const edgeColor = additionType === 'branch' ? '#f59e0b' : '#10b981';

    if (referenceNode) {
      newEdges.push({
        id: `edge-${referenceNode.id}-${newEventId}`,
        source: referenceNode.id,
        target: newEventId,
        animated: true,
        style: { stroke: edgeColor, strokeWidth: 3 },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
        },
      });
    }

    newEdges.push({
      id: `edge-${newEventId}-${newAddId}`,
      source: newEventId,
      target: newAddId,
      animated: true,
      style: { stroke: '#cbd5e1', strokeDasharray: '8,8' },
    });

    // For linear addition, remove old add nodes. For branches, keep everything
    let filteredNodes = nodes;
    let filteredEdges = edges;

    if (additionType === 'after') {
      // Linear addition: remove all existing add nodes and their edges
      filteredNodes = nodes.filter((n: any) => n.data.nodeType !== 'add');
      filteredEdges = edges.filter(
        (e: any) =>
          !nodes.some(
            (n: any) => n.data.nodeType === 'add' && (e.source === n.id || e.target === n.id)
          )
      );
    }
    // For branches: keep all existing nodes and just add the new ones

    setNodes([...filteredNodes, newEventNode as any, newAddNode as any]);
    setEdges([...filteredEdges, ...newEdges]);
    setEventCounter((prev) => prev + 1);

    // Save event data to localStorage for ALL events (not just branched)

    // Save ALL events to localStorage for now (easier debugging)
    const eventData = {
      eventId: newEventId,
      title: videoTitle,
      description: videoDescription,
      videoUrl: generatedVideoUrl,
      imageUrl: generatedImageUrl,

      // Characters used in this event
      characterIds: selectedCharacters, // Array of character IDs
      characterNames:
        selectedCharacters.length > 0 && charactersData?.characters
          ? charactersData.characters
              .filter((c: any) => selectedCharacters.includes(c.id))
              .map((c: any) => c.character_name)
          : [],

      // Generation prompts and settings
      imagePrompt: videoDescription, // The prompt used for image generation
      videoPrompt: videoPrompt || videoDescription, // Video animation prompt
      negativePrompt: negativePrompt || '', // Negative prompt for filtering unwanted content

      // Model and settings used
      videoModel: selectedVideoModel, // Which AI model was used (veo3, kling, wan25, sora)
      videoDuration: selectedVideoDuration, // Video duration in seconds
      videoRatio: videoRatio, // Aspect ratio (16:9, 9:16, 1:1)
      imageFormat: imageFormat, // Image format used

      // Music/Soundtrack
      soundtrackUrl: soundtrackUrl || '', // Music track URL
      soundtrackName: soundtrackName || '', // Track name/title

      sourceNodeId: sourceNodeId,
      additionType: additionType,
      timestamp: Date.now(),
      position: newEventPosition,
    };

    // Store in universe-specific localStorage
    const storageKey = `universe_events_${id}`;
    const existingEvents = localStorage.getItem(storageKey);
    const eventsData = existingEvents ? JSON.parse(existingEvents) : {};

    eventsData[newEventId] = eventData;
    localStorage.setItem(storageKey, JSON.stringify(eventsData));

    // Close dialog and reset
    setShowVideoDialog(false);
    setVideoTitle('');
    setVideoDescription('');
    setSourceNodeId(null);
    setGeneratedImageUrl(null);
    setGeneratedVideoUrl(null);
    setShowVideoStep(false);
  }, [
    nodes,
    edges,
    eventCounter,
    id,
    videoTitle,
    videoDescription,
    additionType,
    sourceNodeId,
    handleAddEvent,
    handleEditScene,
    generatedVideoUrl,
    generatedImageUrl,
  ]);

  // Convert blockchain data to timeline nodes
  useEffect(() => {
    if (!graphData.nodeIds.length) return;

    const blockchainNodes: Node<TimelineNodeData>[] = [];
    const blockchainEdges: Edge[] = [];

    // Colors for different types
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

    // Calculate tree layout using utility
    const layout = calculateTreeLayout(graphData.nodeIds, graphData.previousNodes, {
      horizontalSpacing: 420,
      verticalSpacing: 320,
      startX: 100,
      startY: 100,
    });

    // Load locally-saved event data (has resolved URLs and descriptions)
    const localStorageKey = `universe_events_${id}`;
    const storedEvents = localStorage.getItem(localStorageKey);
    const localEvents: Record<string, any> = storedEvents ? JSON.parse(storedEvents) : {};

    // Helper: detect bytes32 hashes (0x + 64 hex chars) which aren't useful for display
    const isHash = (val: string) => /^0x[0-9a-fA-F]{64}$/.test(val);

    // Create nodes from blockchain data using calculated layout
    graphData.nodeIds.forEach((nodeIdStr, index) => {
      const nodeId = normalizeNodeId(nodeIdStr);

      // Try to resolve actual URL and description from localStorage first
      const localEvent = localEvents[nodeId.toString()] || localEvents[String(nodeId)];

      const rawUrl = graphData.urls[index] || '';
      const url =
        localEvent?.videoUrl || (typeof rawUrl === 'string' && !isHash(rawUrl) ? rawUrl : '');

      // Handle description which might be an object {timestamp, description} or a string
      const rawDesc = graphData.descriptions[index];
      const rawDescStr =
        rawDesc && typeof rawDesc === 'object' && 'description' in rawDesc
          ? String((rawDesc as any).description)
          : String(rawDesc || '');
      // Use localStorage description if the on-chain value is a hash
      const description = localEvent?.description || (isHash(rawDescStr) ? '' : rawDescStr);

      const previousNode = graphData.previousNodes[index] || '';
      const isCanon = graphData.flags[index] || false;
      const parentId =
        previousNode && String(previousNode) !== '0' ? normalizeNodeId(previousNode) : 0;

      // Check if this node is in the canon chain
      const isInCanonChain =
        graphData.canonChain &&
        graphData.canonChain.some((canonId: any) => {
          const canonNodeId = normalizeNodeId(canonId);
          return canonNodeId === nodeId;
        });

      // Get position from layout calculation
      const position = layout.nodePositions.get(nodeId) || { x: 100, y: 100 };

      // Generate proper event label
      const eventLabel = getEventLabel(nodeId, parentId, layout.nodesByParent);

      const color = isCanon ? colors[0] : colors[(index + 1) % colors.length];

      const displayLabel =
        localEvent?.title ||
        (description && description.length > 0 && description !== `Timeline event ${nodeId}`
          ? description.substring(0, 50) + (description.length > 50 ? '...' : '')
          : `Event ${nodeId}`);

      // Count children (branches) for this node
      const childNodes = graphData.children[index];
      const childCount = Array.isArray(childNodes) ? childNodes.length : 0;

      // Count segments from localStorage
      let segmentCount = 0;
      try {
        const segKey = `event_segments_${finalUniverse?.id || id}_${nodeId}`;
        const segData = localStorage.getItem(segKey);
        if (segData) {
          segmentCount = JSON.parse(segData).length;
        }
      } catch {
        /* ignore */
      }

      blockchainNodes.push({
        id: `blockchain-node-${nodeId}`,
        type: 'timelineEvent',
        position,
        data: {
          label: displayLabel,
          description: description || `Event ${nodeId}`,
          videoUrl: url,
          timelineColor: color,
          nodeType: 'scene',
          eventId: nodeId.toString(),
          blockchainNodeId: nodeId,
          displayName: nodeId.toString(),
          timelineId: `timeline-1`,
          universeId: finalUniverse?.id || id,
          isRoot: String(previousNode) === '0' || !previousNode,
          isInCanonChain: isInCanonChain,
          segmentCount: segmentCount > 1 ? segmentCount : undefined,
          childCount: childCount > 1 ? childCount : undefined,
          onAddScene: handleAddEvent,
          onEditScene: handleEditScene,
        },
      });
    });

    // Create edges based on previous node relationships
    graphData.nodeIds.forEach((nodeIdStr, index) => {
      const nodeId = normalizeNodeId(nodeIdStr);
      const previousNodeStr = graphData.previousNodes[index];

      if (previousNodeStr && String(previousNodeStr) !== '0') {
        const previousNodeId = normalizeNodeId(previousNodeStr);
        const color = graphData.flags[index] ? colors[0] : colors[(index + 1) % colors.length];

        blockchainEdges.push({
          id: `edge-${previousNodeId}-${nodeId}`,
          source: `blockchain-node-${previousNodeId}`,
          target: `blockchain-node-${nodeId}`,
          animated: true,
          style: { stroke: color, strokeWidth: 3 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: color,
          },
        });
      }
    });

    // Add final + node to continue the timeline
    if (blockchainNodes.length > 0) {
      const lastNode = blockchainNodes[blockchainNodes.length - 1];
      const addNodeId = `add-final`;

      blockchainNodes.push({
        id: addNodeId,
        type: 'timelineEvent',
        position: { x: lastNode.position.x + 420, y: lastNode.position.y },
        data: {
          label: '',
          description: '',
          nodeType: 'add',
          onAddScene: handleAddEvent,
        },
      });

      blockchainEdges.push({
        id: `edge-${lastNode.id}-${addNodeId}`,
        source: lastNode.id,
        target: addNodeId,
        animated: true,
        style: { stroke: '#cbd5e1', strokeDasharray: '8,8' },
      });
    }

    setNodes(blockchainNodes as any);
    setEdges(blockchainEdges);
    setEventCounter(graphData.nodeIds.length + 1);
  }, [graphData, finalUniverse?.id, id, handleAddEvent, handleEditScene]);

  // Handle connections between nodes
  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: '#10b981' },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: '#10b981',
            },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  // Handle node selection
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: any) => {
      setSelectedNode(node);
      if (node.data.nodeType === 'scene') {
        setSelectedEventTitle(node.data.label);
        // Extract description string from object if needed
        const rawDesc = node.data.description;
        const description =
          rawDesc && typeof rawDesc === 'object' && 'description' in rawDesc
            ? String((rawDesc as any).description)
            : String(rawDesc || '');
        setSelectedEventDescription(description);

        // Navigate to event page with specific event
        const universeId = node.data.universeId || id;
        // Use blockchainNodeId if available (for blockchain nodes), otherwise use eventId
        const eventId = node.data.blockchainNodeId || node.data.eventId;

        if (eventId && universeId) {
          navigate({ to: `/event/${universeId}/${eventId}` });
        }
      }
    },
    [id]
  );

  // Update selected node data
  const updateSelectedNode = useCallback(() => {
    if (selectedNode && selectedNode.data.nodeType === 'scene') {
      setNodes((nds: any) =>
        nds.map((node: any) =>
          node.id === selectedNode.id
            ? {
                ...node,
                data: {
                  ...node.data,
                  label: selectedEventTitle,
                  description: selectedEventDescription,
                },
              }
            : node
        )
      );
    }
  }, [selectedNode, selectedEventTitle, selectedEventDescription, setNodes]);

  // Not found state - only for non-blockchain universes
  if (!isBlockchainUniverse && !finalUniverse) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Universe Not Found</h1>
          <p className="text-muted-foreground mb-6">
            The universe with ID "{id}" could not be found.
          </p>
          <Button asChild>
            <Link to="/market">← Back to Market</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoadingUniverse || (isBlockchainUniverse && (isLoadingLeaves || isLoadingFullGraph))) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p>Loading universe timeline...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100svh-57px)] bg-background overflow-hidden">
      {/* Left Sidebar Component */}
      <UniverseSidebar
        finalUniverse={finalUniverse}
        graphData={{ ...graphData, nodeIds: graphData.nodeIds as any[] }}
        leavesData={leavesData}
        nodes={nodes}
        isLoadingAny={isLoadingAny}
        selectedNode={selectedNode}
        handleAddEvent={handleAddEvent}
        handleRefreshTimeline={handleRefreshTimeline}
        onOpenGovernance={handleOpenGovernance}
        onOpenGenerations={() => setShowGenerationsPanel(true)}
      />

      {/* Main Content Area */}
      <TokenGateGuard universeId={id} target="view">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden transition-all duration-300 ease-in-out">
          <ReactFlowProvider>
            <div className="flex-1 relative overflow-hidden w-full h-full">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                nodeTypes={nodeTypes}
                fitView
                className="bg-gradient-to-br from-background via-background/95 to-muted/20"
                minZoom={0.1}
                maxZoom={2}
              >
                <Background />
                <Controls />

                <Panel position="top-right">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setShowCreatorsRoom(!showCreatorsRoom);
                        if (!showCreatorsRoom) setShowGovernanceSidebar(false);
                      }}
                      className="hover:bg-amber-500/10 hover:text-amber-400 transition-all duration-300"
                    >
                      <svg
                        className="h-4 w-4 mr-2"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
                        />
                      </svg>
                      Creator's Room
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="hover:bg-green-500/10 hover:text-green-400 transition-all duration-300"
                    >
                      <Link to="/upload" search={{ universeId: id }}>
                        <svg
                          className="h-4 w-4 mr-2"
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={1.5}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M12 4.5v15m7.5-7.5h-15"
                          />
                        </svg>
                        Add Content
                      </Link>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="hover:bg-primary/10 hover:text-primary transition-all duration-300"
                    >
                      <Link to="/">
                        <Home className="h-4 w-4 mr-2" />
                        Home
                      </Link>
                    </Button>
                  </div>
                </Panel>

                {isLoadingAny && (
                  <Panel
                    position="bottom-right"
                    className="bg-background/80 backdrop-blur-sm p-2 rounded-lg border mb-4"
                  >
                    <div className="flex items-center gap-2 text-sm">
                      <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full"></div>
                      Loading blockchain data...
                    </div>
                  </Panel>
                )}
              </ReactFlow>
            </div>
          </ReactFlowProvider>
        </div>

        {/* Bottom Panel - Event Creation (Google Veo Flow Style) */}
        {(() => {
          // Find previous event's video URL and description - always use the last event or the source node
          const sourceNode = sourceNodeId
            ? nodes.find((n) => n.data.eventId === sourceNodeId || n.id === sourceNodeId)
            : nodes.filter((n: any) => n.data.nodeType === 'scene' && n.data.videoUrl).pop();
          const previousEventVideoUrl = sourceNode?.data.videoUrl || null;

          // Handle description which might be an object {timestamp, description} or a string
          const rawDesc = sourceNode?.data.description;
          const previousEventDescription =
            rawDesc && typeof rawDesc === 'object' && 'description' in rawDesc
              ? String((rawDesc as any).description)
              : rawDesc
                ? String(rawDesc)
                : null;

          const previousEventTitle = sourceNode?.data.label || null;

          // Get previous event wiki data if available
          const previousEventWiki = sourceNode?.data.wiki
            ? {
                title: sourceNode.data.wiki.title || previousEventTitle || '',
                summary: sourceNode.data.wiki.summary || '',
                plot: sourceNode.data.wiki.plot,
              }
            : null;

          return (
            <FlowCreationPanel
              showVideoDialog={showVideoDialog}
              setShowVideoDialog={setShowVideoDialog}
              videoTitle={videoTitle}
              setVideoTitle={setVideoTitle}
              videoDescription={videoDescription}
              setVideoDescription={setVideoDescription}
              additionType={additionType}
              selectedCharacters={selectedCharacters}
              setSelectedCharacters={setSelectedCharacters}
              showCharacterSelector={showCharacterSelector}
              setShowCharacterSelector={setShowCharacterSelector}
              showCharacterGenerator={showCharacterGenerator}
              setShowCharacterGenerator={setShowCharacterGenerator}
              charactersData={charactersData}
              isLoadingCharacters={isLoadingCharacters}
              characterName={characterName}
              setCharacterName={setCharacterName}
              characterDescription={characterDescription}
              setCharacterDescription={setCharacterDescription}
              characterStyle={characterStyle}
              setCharacterStyle={setCharacterStyle}
              isGeneratingCharacter={isGeneratingCharacter}
              generatedCharacter={generatedCharacter}
              setGeneratedCharacter={setGeneratedCharacter}
              generateCharacterMutation={generateCharacterMutation}
              analyzeCharacterMutation={analyzeCharacterMutation}
              saveCharacterMutation={saveCharacterMutation}
              generatedImageUrl={generatedImageUrl}
              isGeneratingImage={isGeneratingImage}
              imageFormat={imageFormat}
              setImageFormat={(format: string) =>
                setImageFormat(
                  format as 'landscape_16_9' | 'portrait_16_9' | 'landscape_4_3' | 'portrait_4_3'
                )
              }
              handleGenerateEventImage={handleGenerateEventImage}
              showVideoStep={showVideoStep}
              setShowVideoStep={setShowVideoStep}
              uploadedUrl={uploadedUrl}
              setUploadedUrl={setUploadedUrl}
              isUploading={isUploading}
              uploadToStorage={uploadToStorage}
              generatedVideoUrl={generatedVideoUrl}
              setGeneratedVideoUrl={setGeneratedVideoUrl}
              setGeneratedImageUrl={setGeneratedImageUrl}
              isGeneratingVideo={isGeneratingVideo}
              videoPrompt={videoPrompt}
              setVideoPrompt={setVideoPrompt}
              videoRatio={videoRatio}
              setVideoRatio={setVideoRatio}
              selectedVideoModel={selectedVideoModel}
              setSelectedVideoModel={setSelectedVideoModel}
              selectedVideoDuration={selectedVideoDuration}
              setSelectedVideoDuration={setSelectedVideoDuration}
              negativePrompt={negativePrompt}
              setNegativePrompt={setNegativePrompt}
              handleGenerateVideo={handleGenerateVideo}
              isSavingToContract={isSavingToContract}
              contractSaved={contractSaved}
              isSavingToFilecoin={isSavingToStorage}
              filecoinSaved={storageSaved}
              pieceCid={storageKey}
              handleSaveToContract={handleSaveToContract}
              handleCreateEvent={handleCreateEvent}
              previousEventVideoUrl={previousEventVideoUrl}
              previousEventDescription={previousEventDescription}
              previousEventTitle={previousEventTitle}
              previousEventWiki={previousEventWiki}
              statusMessage={statusMessage}
              setStatusMessage={setStatusMessage}
              selectedImageCharacters={selectedImageCharacters}
              setSelectedImageCharacters={setSelectedImageCharacters}
              handleGenerateCharacterFrame={handleGenerateCharacterFrame}
              refetchCharacters={refetchCharacters}
            />
          );
        })()}

        {/* Generations Panel */}
        <GenerationsPanel
          universeId={id}
          isOpen={showGenerationsPanel}
          onClose={() => setShowGenerationsPanel(false)}
          onSelectGeneration={handleSelectGeneration}
        />

        {/* Governance Sidebar */}
        <GovernanceSidebar
          isOpen={showGovernanceSidebar}
          onClose={() => setShowGovernanceSidebar(false)}
          finalUniverse={finalUniverse}
          nodes={nodes}
          onRefresh={handleRefreshTimeline}
        />

        {/* Creator's Room Sidebar */}
        {showCreatorsRoom && (
          <div className="w-[400px] border-l border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
              <span className="text-sm text-zinc-400">Private Section</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCreatorsRoom(false)}
                className="text-zinc-500 hover:text-white h-6 w-6 p-0"
              >
                x
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <PrivateSection universeId={id} />
            </div>
          </div>
        )}
      </TokenGateGuard>

      {/* Edit Video Dialog */}
      <Dialog open={editVideoDialogOpen} onOpenChange={setEditVideoDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Change Video — Event {editingEventId}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Current / Preview Video */}
            {editVideoPreview && (
              <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
                <video
                  key={editVideoPreview}
                  src={editVideoPreview}
                  className="w-full h-full object-contain"
                  controls
                  muted
                />
                <button
                  onClick={() => {
                    setEditVideoPreview(null);
                    setEditVideoFile(null);
                    setEditVideoUrl('');
                  }}
                  className="absolute top-2 right-2 bg-black/70 hover:bg-black/90 text-white rounded-full p-1 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Upload File */}
            <div>
              <Label className="text-sm font-medium mb-1.5 block">Upload Video File</Label>
              <input
                ref={editFileInputRef}
                type="file"
                accept="video/*"
                onChange={handleEditVideoFileChange}
                className="hidden"
              />
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => editFileInputRef.current?.click()}
                disabled={isUploadingEditVideo}
              >
                <Upload className="h-4 w-4" />
                {editVideoFile ? editVideoFile.name : 'Choose video file...'}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">MP4, WebM, MOV — max 200MB</p>
            </div>

            {/* Or divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">or</span>
              </div>
            </div>

            {/* Paste URL */}
            <div>
              <Label className="text-sm font-medium mb-1.5 block">Paste Video URL</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://..."
                  value={editVideoUrl}
                  onChange={(e) => {
                    setEditVideoUrl(e.target.value);
                    setEditVideoFile(null);
                    if (e.target.value.trim()) {
                      setEditVideoPreview(e.target.value.trim());
                    }
                  }}
                  disabled={isUploadingEditVideo}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (editVideoUrl.trim()) {
                      setEditVideoPreview(editVideoUrl.trim());
                    }
                  }}
                  title="Preview URL"
                >
                  <Video className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button
              variant="ghost"
              onClick={() => setEditVideoDialogOpen(false)}
              disabled={isUploadingEditVideo}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveEditVideo}
              disabled={isUploadingEditVideo || (!editVideoUrl.trim() && !editVideoFile)}
            >
              {isUploadingEditVideo ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2" />
                  Uploading...
                </>
              ) : (
                'Save Video'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const Route = createFileRoute('/universe/$id')({
  component: UniverseTimelineEditor,
});
