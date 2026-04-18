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
import {
  Home,
  Upload,
  Link2,
  Video,
  X,
  Music,
  Trash2,
  Copy,
  CheckSquare,
  Search,
  Maximize2,
  Minimize2,
  LayoutGrid,
  ZoomIn,
  ZoomOut,
  Locate,
  Undo2,
  Redo2,
  Keyboard,
  Play,
  Waves,
  Megaphone,
  Settings,
  Eye,
  EyeOff,
  Map,
  List,
  Layers,
  RefreshCw,
  History,
  Hand,
  MousePointer2,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { MusicGenerationPanel } from '@/components/MusicGenerationPanel';
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
  MiniMap,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  Panel,
  MarkerType,
  addEdge,
  useOnSelectionChange,
  useReactFlow,
  useStore,
  SelectionMode,
  type Node,
  type Edge,
  type Connection,
  type OnSelectionChangeParams,
} from 'reactflow';
type MiniMapNodeProps = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  borderRadius: number;
  className: string;
  color: string;
  shapeRendering: string;
  strokeColor: string;
  strokeWidth: number;
  selected?: boolean;
  style?: React.CSSProperties;
  onClick?: (event: React.MouseEvent, id: string) => void;
};
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
import { AudioToolbar, type SelectedClip } from '@/components/AudioToolbar';
import { calculateTreeLayout, normalizeNodeId, getEventLabel } from '@/utils/treeLayout';
import { useVideoGeneration, type StatusMessage } from '@/hooks/useVideoGeneration';
import { useCharacterGeneration } from '@/hooks/useCharacterGeneration';
import { useContractSave } from '@/hooks/useContractSave';
import { useUniverseBlockchain } from '@/hooks/useUniverseBlockchain';
import { TokenGateGuard } from '@/components/governance/TokenGateGuard';
import { PrivateSection } from '@/components/private/PrivateSection';
import { SceneControlsPanel } from '@/components/flow/SceneControlsPanel';
import { CastManager } from '@/components/flow/CastManager';
import { MotionBrush } from '@/components/flow/MotionBrush';
import type { SceneControls } from '@/components/flow/TimelineNodes';
import { SelectionPlayer, type SelectionVideo } from '@/components/player/SelectionPlayer';
import { NodeOutlinePanel } from '@/components/flow/NodeOutlinePanel';
import { NodeFilterBar } from '@/components/flow/NodeFilterBar';
import { BulkOperationsToolbar } from '@/components/flow/BulkOperationsToolbar';
import { NodeContextMenu } from '@/components/flow/NodeContextMenu';
import { ShortcutsHelpDialog } from '@/components/flow/ShortcutsHelpDialog';
import { NodeArcOverlay } from '@/components/flow/NodeArcOverlay';
import { EpisodeBuilder } from '@/components/episodes/EpisodeBuilder';
import { ScriptToEpisode } from '@/components/episodes/ScriptToEpisode';
import { useNodeArcs } from '@/hooks/useNodeArcs';
import { useNodeFilter } from '@/hooks/useNodeFilter';
import type { ContextMenuState } from '@/components/flow/types';
import { getSceneNodes } from '@/components/flow/types';

// Custom MiniMap node — shape varies by node type
function MiniMapNode({
  id,
  x,
  y,
  width,
  height,
  color,
  strokeColor,
  strokeWidth,
  selected,
  style,
  onClick,
}: MiniMapNodeProps) {
  const nodeData = useStore((s) => {
    const node = s.nodeInternals.get(id);
    return node?.data as TimelineNodeData | undefined;
  });

  const handleClick = (e: React.MouseEvent) => {
    onClick?.(e, id);
  };

  // Root nodes → circle
  if (nodeData?.isRoot) {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const r = Math.min(width, height) / 2;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={color}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        style={{ ...style, cursor: 'pointer' }}
        onClick={handleClick}
        className={selected ? 'react-flow__minimap-node selected' : 'react-flow__minimap-node'}
      />
    );
  }

  // Branch nodes → diamond (rotated rect)
  if (nodeData?.nodeType === 'branch') {
    const cx = x + width / 2;
    const cy = y + height / 2;
    const size = Math.min(width, height) * 0.7;
    return (
      <rect
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        rx={1}
        fill={color}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        transform={`rotate(45, ${cx}, ${cy})`}
        style={{ ...style, cursor: 'pointer' }}
        onClick={handleClick}
        className={selected ? 'react-flow__minimap-node selected' : 'react-flow__minimap-node'}
      />
    );
  }

  // Add nodes → small circle (dot)
  if (nodeData?.nodeType === 'add') {
    const cx = x + width / 2;
    const cy = y + height / 2;
    return (
      <circle
        cx={cx}
        cy={cy}
        r={Math.min(width, height) * 0.3}
        fill={color}
        stroke="none"
        style={{ ...style, cursor: 'pointer', opacity: 0.5 }}
        onClick={handleClick}
        className="react-flow__minimap-node"
      />
    );
  }

  // Default scene nodes → rounded rectangle
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={3}
      fill={color}
      stroke={strokeColor}
      strokeWidth={strokeWidth}
      style={{ ...style, cursor: 'pointer' }}
      onClick={handleClick}
      className={selected ? 'react-flow__minimap-node selected' : 'react-flow__minimap-node'}
    />
  );
}

// Register custom node types
const nodeTypes = {
  timelineEvent: TimelineEventNode,
};

function UniverseTimelineEditorInner() {
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
  const [selectedImageModel, setSelectedImageModel] = useState<string>(''); // '' = auto

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

  // Music Studio panel state
  const [showMusicStudio, setShowMusicStudio] = useState(false);

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

  // Regeneration state
  const [regeneratingEventId, setRegeneratingEventId] = useState<string | null>(null);

  // Contract integration state
  const [isSavingToContract, setIsSavingToContract] = useState(false);
  const [contractSaved, setContractSaved] = useState(false);

  // Governance state
  const [showGovernanceSidebar, setShowGovernanceSidebar] = useState(false);

  // Creator's Room state
  const [showCreatorsRoom, setShowCreatorsRoom] = useState(false);

  // Scene Controls state (Node Editor Expansion v1)
  const [showCastManager, setShowCastManager] = useState(false);
  const [showMotionBrush, setShowMotionBrush] = useState(false);
  const [selectedNodeControls, setSelectedNodeControls] = useState<SceneControls>({});
  const [isSavingControls, setIsSavingControls] = useState(false);

  // Canvas tool mode: 'hand' = pan on drag, 'select' = drag-to-select rectangle
  const [canvasTool, setCanvasTool] = useState<'hand' | 'select'>('hand');

  // Multi-select state
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showSelectionPlayer, setShowSelectionPlayer] = useState(false);
  const [showAudioToolbar, setShowAudioToolbar] = useState(false);
  const [showEpisodeBuilder, setShowEpisodeBuilder] = useState(false);
  const [showScriptToEpisode, setShowScriptToEpisode] = useState(false);

  // Storage integration state
  const [isSavingToStorage, setIsSavingToStorage] = useState(false);
  const [storageSaved, setStorageSaved] = useState(false);
  const [storageKey, setStorageKey] = useState<string | null>(null);

  // Music/soundtrack state
  const [soundtrackUrl, setSoundtrackUrl] = useState<string>('');
  const [soundtrackName, setSoundtrackName] = useState<string>('');

  // Node Management state
  const [showOutlinePanel, setShowOutlinePanel] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    nodeId: null,
  });

  // Node Management hooks
  const nodeArcs = useNodeArcs(id);
  const nodeFilter = useNodeFilter(nodes, nodeArcs.arcs);

  // Canvas UI state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [showMiniMap, setShowMiniMap] = useState(true);
  const [miniMapPosition, setMiniMapPosition] = useState<
    'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  >('bottom-right');
  const [miniMapZoomStep, setMiniMapZoomStep] = useState(10); // 1-20, default 10
  const [miniMapSize, setMiniMapSize] = useState<number>(150); // 100-300
  const [showMiniMapSettings, setShowMiniMapSettings] = useState(false);
  const [miniMapOpacity, setMiniMapOpacity] = useState(85); // 20-100
  const [miniMapAutoCollapse, setMiniMapAutoCollapse] = useState(false);
  const [miniMapShowLegend, setMiniMapShowLegend] = useState(true);
  const [miniMapShowEdges, setMiniMapShowEdges] = useState(true);
  const [isMiniMapHovered, setIsMiniMapHovered] = useState(false);

  // Undo/redo state
  const undoStack = useRef<{ nodes: Node<TimelineNodeData>[]; edges: Edge[] }[]>([]);
  const redoStack = useRef<{ nodes: Node<TimelineNodeData>[]; edges: Edge[] }[]>([]);
  const isUndoRedoAction = useRef(false);

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { fitView, zoomIn, zoomOut, setCenter, getZoom } = useReactFlow();

  // Ref to track latest nodes without causing callback identity changes
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

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

  // ── Strict on-chain vs off-chain mode ──
  // The universe doc carries `onChainUniverseId` only if it was actually minted
  // via UniverseManager. Off-chain "fun mode" universes (script-seeded, fan IP,
  // playgrounds) have it null/undefined even when their doc ID starts with 0x.
  // Once the universe doc is loaded:
  //   - If onChainUniverseId is present → strict on-chain mode
  //   - If not → strict off-chain (Firestore timeline nodes only)
  // While the doc is still loading we leave isOnChain undefined so the hook
  // falls back to the legacy isBlockchainUniverse heuristic for back-compat.
  const isOnChain = universe === undefined ? undefined : !!(universe as any)?.onChainUniverseId;

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
    isOnChain,
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

  // Fetch cast members for the universe (Feature 3 - Character Consistency)
  const { data: castMembersData } = useQuery({
    queryKey: ['cast', id],
    queryFn: () => trpcClient.cast.list.query({ universeId: id }),
    retry: false,
    meta: { skipGlobalErrorHandler: true },
  });

  // Fetch scene controls for all nodes in this universe
  const { data: nodeControlsMap } = useQuery({
    queryKey: ['nodeSceneControls', id],
    queryFn: () => trpcClient.sceneControls.getUniverseNodeControls.query({ universeId: id }),
    retry: false,
    meta: { skipGlobalErrorHandler: true },
  });

  // Save scene controls for the selected node
  const handleSaveSceneControls = useCallback(async () => {
    if (!selectedNode?.data.eventId) return;
    setIsSavingControls(true);
    try {
      await trpcClient.sceneControls.saveNodeControls.mutate({
        universeId: id,
        nodeId: selectedNode.data.eventId,
        controls: selectedNodeControls,
      });
      // Update the node's scene controls in the flow state
      setNodes((nds: any) =>
        nds.map((n: any) =>
          n.id === selectedNode.id
            ? { ...n, data: { ...n.data, sceneControls: selectedNodeControls } }
            : n
        )
      );
    } catch (err) {
      console.error('Failed to save scene controls:', err);
    } finally {
      setIsSavingControls(false);
    }
  }, [selectedNode, selectedNodeControls, id, setNodes]);

  // Load scene controls when a node is selected
  useEffect(() => {
    if (selectedNode?.data.eventId && nodeControlsMap) {
      const controls = nodeControlsMap[selectedNode.data.eventId];
      setSelectedNodeControls(controls || {});
    }
  }, [selectedNode?.data.eventId, nodeControlsMap]);

  // Handle motion brush save
  const handleMotionBrushSave = useCallback(
    async (maskDataUrl: string) => {
      try {
        // Convert data URL to base64 and upload
        const base64 = maskDataUrl.split(',')[1];
        if (!base64) return;

        const manifest = await trpcClient.storage.uploadDirect.mutate({
          data: base64,
          filename: `motion-mask-${selectedNode?.data.eventId}-${Date.now()}.png`,
          mimeType: 'image/png',
        });

        setSelectedNodeControls((prev) => ({
          ...prev,
          motionMaskHash: manifest.contentHash,
        }));
        setShowMotionBrush(false);
      } catch (err) {
        console.error('Failed to upload motion mask:', err);
        alert('Failed to save motion mask. Please try again.');
      }
    },
    [selectedNode]
  );

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
    imageModelId: selectedImageModel || undefined,
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

  // ── Multi-select & Node Management ────────────────────────────────

  // Track ReactFlow selection changes
  useOnSelectionChange({
    onChange: useCallback(({ nodes: selectedNodes }: OnSelectionChangeParams) => {
      setSelectedNodeIds(
        new Set(
          selectedNodes.filter((n: any) => n.data?.nodeType === 'scene').map((n: any) => n.id)
        )
      );
    }, []),
  });

  // Get archived node IDs from localStorage
  const getArchivedNodeIds = useCallback((): Set<string> => {
    try {
      const key = `universe_archived_nodes_${id}`;
      const stored = localStorage.getItem(key);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  }, [id]);

  // Save archived node IDs to localStorage
  const saveArchivedNodeIds = useCallback(
    (archivedIds: Set<string>) => {
      const key = `universe_archived_nodes_${id}`;
      localStorage.setItem(key, JSON.stringify([...archivedIds]));
    },
    [id]
  );

  // Delete a single node
  const handleDeleteNode = useCallback(
    (eventId: string) => {
      if (!eventId) return;

      // Find the node
      const nodeToDelete = nodesRef.current.find(
        (n) => n.data.eventId === eventId || n.id === eventId
      );
      if (!nodeToDelete) return;

      const nodeFlowId = nodeToDelete.id;
      const isBlockchain = nodeFlowId.startsWith('blockchain-node-');

      if (isBlockchain) {
        // Soft-delete: archive the blockchain node (can't delete from chain)
        const archived = getArchivedNodeIds();
        archived.add(eventId);
        saveArchivedNodeIds(archived);
      }

      // Remove from localStorage events
      const storageKey = `universe_events_${id}`;
      const storedEvents = localStorage.getItem(storageKey);
      if (storedEvents) {
        const eventsData = JSON.parse(storedEvents);
        delete eventsData[eventId];
        localStorage.setItem(storageKey, JSON.stringify(eventsData));
      }

      // Remove node and its connected edges from the flow
      setNodes((nds: any) => nds.filter((n: any) => n.id !== nodeFlowId));
      setEdges((eds: any) =>
        eds.filter((e: any) => e.source !== nodeFlowId && e.target !== nodeFlowId)
      );

      // Clear selection if deleted node was selected
      setSelectedNode((prev) => (prev?.id === nodeFlowId ? null : prev));
      setSelectedNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(nodeFlowId);
        return next;
      });
    },
    [id, getArchivedNodeIds, saveArchivedNodeIds, setNodes, setEdges]
  );

  // Delete all selected nodes
  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeIds.size === 0) return;

    const archived = getArchivedNodeIds();
    const storageKey = `universe_events_${id}`;
    const storedEvents = localStorage.getItem(storageKey);
    const eventsData = storedEvents ? JSON.parse(storedEvents) : {};

    // Process each selected node
    for (const nodeFlowId of selectedNodeIds) {
      const node = nodesRef.current.find((n) => n.id === nodeFlowId);
      if (!node || node.data.nodeType !== 'scene') continue;

      const eventId = node.data.eventId;
      if (!eventId) continue;

      const isBlockchain = nodeFlowId.startsWith('blockchain-node-');
      if (isBlockchain) {
        archived.add(eventId);
      }

      delete eventsData[eventId];
    }

    saveArchivedNodeIds(archived);
    localStorage.setItem(storageKey, JSON.stringify(eventsData));

    // Remove all selected nodes and their edges from the flow
    setNodes((nds: any) => nds.filter((n: any) => !selectedNodeIds.has(n.id)));
    setEdges((eds: any) =>
      eds.filter((e: any) => !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target))
    );

    setSelectedNode(null);
    setSelectedNodeIds(new Set());
    setShowDeleteConfirm(false);
  }, [selectedNodeIds, id, getArchivedNodeIds, saveArchivedNodeIds, setNodes, setEdges]);

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedNodeIds(new Set());
    // Deselect all nodes in ReactFlow
    setNodes((nds: any) => nds.map((n: any) => ({ ...n, selected: false })));
  }, [setNodes]);

  // Build playlist from selected nodes and open the selection player
  const handlePlaySelected = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    // Collect selected nodes that have video URLs, preserving canvas order (top-to-bottom, left-to-right)
    const selectedWithVideo = nodes
      .filter(
        (n: any) => selectedNodeIds.has(n.id) && n.data?.videoUrl && n.data.nodeType === 'scene'
      )
      .sort((a: any, b: any) => {
        // Sort by vertical position first, then horizontal
        if (Math.abs(a.position.y - b.position.y) > 50) return a.position.y - b.position.y;
        return a.position.x - b.position.x;
      });
    if (selectedWithVideo.length === 0) return;
    setShowSelectionPlayer(true);
  }, [selectedNodeIds, nodes]);

  // Get the selection playlist videos (memoized to avoid recalc on every render)
  const selectionVideos: SelectionVideo[] = useMemo(() => {
    if (!showSelectionPlayer || selectedNodeIds.size === 0) return [];
    return nodes
      .filter(
        (n: any) => selectedNodeIds.has(n.id) && n.data?.videoUrl && n.data.nodeType === 'scene'
      )
      .sort((a: any, b: any) => {
        if (Math.abs(a.position.y - b.position.y) > 50) return a.position.y - b.position.y;
        return a.position.x - b.position.x;
      })
      .map((n: any) => ({
        nodeId: n.id,
        label: n.data.label || n.data.displayName || `Event ${n.data.eventId || n.id}`,
        videoUrl: n.data.videoUrl,
      }));
  }, [showSelectionPlayer, selectedNodeIds, nodes]);

  // Build selected clips for AudioToolbar
  const selectedClips: SelectedClip[] = useMemo(() => {
    if (selectedNodeIds.size === 0) return [];
    return nodes
      .filter(
        (n: any) => selectedNodeIds.has(n.id) && n.data?.videoUrl && n.data.nodeType === 'scene'
      )
      .sort((a: any, b: any) => {
        if (Math.abs(a.position.y - b.position.y) > 50) return a.position.y - b.position.y;
        return a.position.x - b.position.x;
      })
      .map((n: any) => ({
        videoUrl: n.data.videoUrl,
        title: n.data.label || n.data.displayName || `Event ${n.data.eventId || n.id}`,
        generationId: n.data.generationId || n.data.eventId || n.id,
        nodeId: n.data.eventId ? parseInt(n.data.eventId, 10) : undefined,
      }));
  }, [selectedNodeIds, nodes]);

  // ── Undo / Redo ────────────────────────────────────────────────────
  const pushUndoState = useCallback(() => {
    undoStack.current.push({
      nodes: JSON.parse(JSON.stringify(nodesRef.current)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, [edges]);

  const handleUndo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    isUndoRedoAction.current = true;
    redoStack.current.push({
      nodes: JSON.parse(JSON.stringify(nodesRef.current)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    setNodes(prev.nodes as any);
    setEdges(prev.edges);
    requestAnimationFrame(() => {
      isUndoRedoAction.current = false;
    });
  }, [edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    isUndoRedoAction.current = true;
    undoStack.current.push({
      nodes: JSON.parse(JSON.stringify(nodesRef.current)),
      edges: JSON.parse(JSON.stringify(edges)),
    });
    setNodes(next.nodes as any);
    setEdges(next.edges);
    requestAnimationFrame(() => {
      isUndoRedoAction.current = false;
    });
  }, [edges, setNodes, setEdges]);

  // ── Node Search ───────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return nodes.filter(
      (n: any) =>
        n.data.nodeType === 'scene' &&
        (n.data.label?.toLowerCase().includes(q) ||
          n.data.description?.toString().toLowerCase().includes(q) ||
          n.data.eventId?.toString().includes(q) ||
          n.data.displayName?.toLowerCase().includes(q))
    );
  }, [nodes, searchQuery]);

  const handleSearchSelect = useCallback(
    (node: Node<TimelineNodeData>) => {
      setCenter(node.position.x + 160, node.position.y + 136, {
        zoom: 1,
        duration: 500,
      });
      setSelectedNode(node);
      setShowSearch(false);
      setSearchQuery('');
    },
    [setCenter]
  );

  // ── Auto-layout ───────────────────────────────────────────────────
  const handleAutoLayout = useCallback(() => {
    pushUndoState();
    const sceneNodes = nodes.filter((n: any) => n.data.nodeType === 'scene');
    if (sceneNodes.length === 0) return;

    // Build ID arrays for the layout algorithm
    const nodeIds = sceneNodes.map((n: any) => {
      const eid = n.data.blockchainNodeId || parseInt(n.data.eventId) || 0;
      return eid;
    });
    const previousNodes = sceneNodes.map((n: any) => {
      // Find parent from edges
      const parentEdge = edges.find((e) => e.target === n.id);
      if (!parentEdge) return 0;
      const parentNode = sceneNodes.find((pn: any) => pn.id === parentEdge.source);
      if (!parentNode) return 0;
      return parentNode.data.blockchainNodeId || parseInt(parentNode.data.eventId) || 0;
    });

    const layout = calculateTreeLayout(nodeIds, previousNodes, {
      horizontalSpacing: 420,
      verticalSpacing: 320,
      startX: 100,
      startY: 100,
    });

    // Apply positions
    setNodes((nds: any) =>
      nds.map((n: any) => {
        if (n.data.nodeType !== 'scene') {
          // Reposition add nodes relative to their source
          const sourceEdge = edges.find((e) => e.target === n.id);
          if (sourceEdge) {
            const sourceNode = nds.find((sn: any) => sn.id === sourceEdge.source);
            if (sourceNode) {
              const sourcePos = layout.nodePositions.get(
                sourceNode.data.blockchainNodeId || parseInt(sourceNode.data.eventId) || 0
              );
              if (sourcePos) {
                return { ...n, position: { x: sourcePos.x + 420, y: sourcePos.y } };
              }
            }
          }
          return n;
        }
        const eid = n.data.blockchainNodeId || parseInt(n.data.eventId) || 0;
        const pos = layout.nodePositions.get(eid);
        return pos ? { ...n, position: pos } : n;
      })
    );

    requestAnimationFrame(() => {
      fitView({ padding: 0.15, duration: 500 });
    });
  }, [nodes, edges, setNodes, fitView, pushUndoState]);

  // Focus search input when opened
  useEffect(() => {
    if (showSearch) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [showSearch]);

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
  // Uses nodesRef to avoid depending on `nodes` — prevents infinite
  // useEffect loop (setNodes → handleEditScene identity change → effect re-fires).
  const handleEditScene = useCallback(
    (eventId: string) => {
      if (!eventId) return;

      // Load current video URL from localStorage or from the node
      const storageKey = `universe_events_${id}`;
      const storedEvents = localStorage.getItem(storageKey);
      const eventsData = storedEvents ? JSON.parse(storedEvents) : {};
      const eventData = eventsData[eventId];

      // Also check the current node in the flow for its videoUrl
      const node = nodesRef.current.find(
        (n) => n.data.eventId === eventId || n.data.blockchainNodeId?.toString() === eventId
      );
      const currentUrl = eventData?.videoUrl || node?.data.videoUrl || '';

      setEditingEventId(eventId);
      setEditVideoUrl(currentUrl);
      setEditVideoFile(null);
      setEditVideoPreview(currentUrl || null);
      setEditVideoDialogOpen(true);
    },
    [id]
  );

  // Regenerate a scene's video using the same generation context
  const handleRegenerateScene = useCallback(
    async (eventId: string) => {
      if (!eventId || regeneratingEventId) return;

      // Load the event's generation context from localStorage
      const storageKey = `universe_events_${id}`;
      const storedEvents = localStorage.getItem(storageKey);
      const eventsData = storedEvents ? JSON.parse(storedEvents) : {};
      const eventData = eventsData[eventId];

      if (!eventData) {
        alert('No generation context found for this event. Use Edit to change the video instead.');
        return;
      }

      const currentVideoUrl = eventData.videoUrl;
      if (!currentVideoUrl) {
        alert('No existing video to regenerate. Use Edit to add a video first.');
        return;
      }

      // Get the generation parameters from the stored event
      const prompt = eventData.videoPrompt || eventData.imagePrompt || eventData.description || '';
      const model = eventData.videoModel || 'seedance';
      const duration = eventData.videoDuration || 8;
      const ratio = eventData.videoRatio || '16:9';
      const negPrompt = eventData.negativePrompt || '';
      const imageUrl = eventData.imageUrl || null;

      if (!prompt) {
        alert('No prompt found for this event. Use Edit to change the video instead.');
        return;
      }

      setRegeneratingEventId(eventId);

      // Update node to show regenerating state
      setNodes((nds: any) =>
        nds.map((node: any) => {
          if (node.data.eventId === eventId || node.data.blockchainNodeId?.toString() === eventId) {
            return { ...node, data: { ...node.data, isRegenerating: true } };
          }
          return node;
        })
      );

      try {
        // Build model-specific call — same logic as useVideoGeneration
        const modelMap: Record<string, string> = {
          'fal-veo3': imageUrl ? 'fal-ai/veo3.1/fast/image-to-video' : 'fal-ai/veo3.1/fast',
          'fal-kling': imageUrl
            ? 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video'
            : 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
          'fal-wan25': imageUrl
            ? 'fal-ai/wan-25-preview/image-to-video'
            : 'fal-ai/wan-25-preview/text-to-video',
          'fal-sora': imageUrl ? 'fal-ai/sora-2/image-to-video' : 'fal-ai/sora-2/text-to-video',
          seedance: imageUrl
            ? 'bytedance/seedance-2.0/image-to-video'
            : 'bytedance/seedance-2.0/text-to-video',
          'seedance-fast': imageUrl
            ? 'bytedance/seedance-2.0/fast/image-to-video'
            : 'bytedance/seedance-2.0/fast/text-to-video',
        };

        const falModel = modelMap[model] || modelMap['seedance'];

        const result = await trpcClient.generation.generateVideo.mutate({
          prompt,
          ...(imageUrl ? { imageUrl } : {}),
          model: falModel as any,
          duration,
          aspectRatio: ratio,
          negativePrompt: negPrompt || undefined,
          generateAudio: model === 'seedance' || model === 'seedance-fast' ? true : undefined,
        });

        if (result.videoUrl) {
          // Save the old video as a version
          const versions = eventData.videoVersions || [];
          versions.push({
            videoUrl: currentVideoUrl,
            generatedAt: eventData.timestamp || Date.now(),
            model: eventData.videoModel || 'unknown',
            prompt: prompt,
            duration: duration,
            aspectRatio: ratio,
            negativePrompt: negPrompt,
            imageUrl: imageUrl,
            versionNumber: versions.length + 1,
          });

          // Update localStorage with new video and version history
          eventsData[eventId] = {
            ...eventData,
            videoUrl: result.videoUrl,
            videoVersions: versions,
            currentVersionIndex: -1, // -1 = latest
            timestamp: Date.now(),
          };
          localStorage.setItem(storageKey, JSON.stringify(eventsData));

          // Update the node in the flow
          setNodes((nds: any) =>
            nds.map((node: any) => {
              if (
                node.data.eventId === eventId ||
                node.data.blockchainNodeId?.toString() === eventId
              ) {
                return {
                  ...node,
                  data: {
                    ...node.data,
                    videoUrl: result.videoUrl,
                    isRegenerating: false,
                    videoVersions: versions.map((v: any) => ({
                      videoUrl: v.videoUrl,
                      versionNumber: v.versionNumber,
                      generatedAt: v.generatedAt,
                      model: v.model,
                    })),
                    currentVersionIndex: -1,
                  },
                };
              }
              return node;
            })
          );
        }
      } catch (error) {
        alert('Regeneration failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
        // Clear regenerating state
        setNodes((nds: any) =>
          nds.map((node: any) => {
            if (
              node.data.eventId === eventId ||
              node.data.blockchainNodeId?.toString() === eventId
            ) {
              return { ...node, data: { ...node.data, isRegenerating: false } };
            }
            return node;
          })
        );
      } finally {
        setRegeneratingEventId(null);
      }
    },
    [id, setNodes, regeneratingEventId]
  );

  // Switch to a different version of a video on a node
  const handleSwitchVersion = useCallback(
    (eventId: string, versionIndex: number) => {
      if (!eventId) return;

      const storageKey = `universe_events_${id}`;
      const storedEvents = localStorage.getItem(storageKey);
      const eventsData = storedEvents ? JSON.parse(storedEvents) : {};
      const eventData = eventsData[eventId];

      if (!eventData || !eventData.videoVersions) return;

      const versions = eventData.videoVersions as any[];
      let newVideoUrl: string;

      if (versionIndex === -1) {
        // Switch to latest (the current main video stored in videoUrl)
        // The "latest" is always stored as the main videoUrl
        // If we were on a historical version, the latest is still in videoUrl
        // because we only swap display, not the actual stored latest
        newVideoUrl = eventData.latestVideoUrl || eventData.videoUrl;
      } else if (versionIndex >= 0 && versionIndex < versions.length) {
        // Switch to a historical version
        newVideoUrl = versions[versionIndex].videoUrl;
      } else {
        return;
      }

      // Save the latest video URL if we haven't already (first time switching away from latest)
      if (!eventData.latestVideoUrl) {
        eventsData[eventId].latestVideoUrl = eventData.videoUrl;
      }

      // Update the display video URL and current index
      eventsData[eventId].videoUrl = newVideoUrl;
      eventsData[eventId].currentVersionIndex = versionIndex;
      localStorage.setItem(storageKey, JSON.stringify(eventsData));

      // Update the node
      setNodes((nds: any) =>
        nds.map((node: any) => {
          if (node.data.eventId === eventId || node.data.blockchainNodeId?.toString() === eventId) {
            return {
              ...node,
              data: {
                ...node.data,
                videoUrl: newVideoUrl,
                currentVersionIndex: versionIndex,
              },
            };
          }
          return node;
        })
      );
    },
    [id, setNodes]
  );

  // Duplicate selected nodes
  const handleDuplicateSelected = useCallback(() => {
    if (selectedNodeIds.size === 0) return;

    const storageKey = `universe_events_${id}`;
    const storedEvents = localStorage.getItem(storageKey);
    const eventsData = storedEvents ? JSON.parse(storedEvents) : {};

    const newNodes: Node<TimelineNodeData>[] = [];
    const newEdges: Edge[] = [];
    const idMapping: Record<string, string> = {}; // oldId -> newId

    // First pass: create duplicated nodes with new IDs
    for (const nodeFlowId of selectedNodeIds) {
      const node = nodesRef.current.find((n) => n.id === nodeFlowId);
      if (!node || node.data.nodeType !== 'scene') continue;

      const eventId = node.data.eventId;
      if (!eventId) continue;

      // Generate a new unique ID
      const newEventId = `dup-${eventId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newFlowId = `local-node-${newEventId}`;
      idMapping[nodeFlowId] = newFlowId;

      // Position offset (below and to the right)
      const offsetX = 60;
      const offsetY = 180;

      // Copy local event data
      const sourceEventData = eventsData[eventId];
      if (sourceEventData) {
        eventsData[newEventId] = {
          ...sourceEventData,
          eventId: newEventId,
          title: `${sourceEventData.title || `Event ${eventId}`} (copy)`,
          timestamp: Date.now(),
        };
      }

      newNodes.push({
        id: newFlowId,
        type: 'timelineEvent',
        position: { x: node.position.x + offsetX, y: node.position.y + offsetY },
        data: {
          ...node.data,
          label: `${node.data.label} (copy)`,
          eventId: newEventId,
          blockchainNodeId: undefined, // Duplicated nodes are local-only
          displayName: newEventId,
          isRoot: false,
          isInCanonChain: false,
          isSelected: false,
          onAddScene: handleAddEvent,
          onEditScene: handleEditScene,
          onRegenerateScene: handleRegenerateScene,
          onSwitchVersion: handleSwitchVersion,
          onDeleteNode: handleDeleteNode,
        },
      });
    }

    // Second pass: recreate edges between duplicated nodes
    const currentEdges = edges;
    for (const edge of currentEdges) {
      const newSource = idMapping[edge.source];
      const newTarget = idMapping[edge.target];
      if (newSource && newTarget) {
        newEdges.push({
          id: `edge-dup-${newSource}-${newTarget}`,
          source: newSource,
          target: newTarget,
          animated: true,
          style: { stroke: '#8b5cf6', strokeWidth: 3 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#8b5cf6',
          },
        });
      }
    }

    // Save updated localStorage
    localStorage.setItem(storageKey, JSON.stringify(eventsData));

    // Add new nodes and edges to the flow
    setNodes((nds: any) => [...nds, ...newNodes]);
    setEdges((eds: any) => [...eds, ...newEdges]);

    // Clear selection
    setSelectedNodeIds(new Set());
  }, [
    selectedNodeIds,
    id,
    edges,
    handleAddEvent,
    handleEditScene,
    handleRegenerateScene,
    handleSwitchVersion,
    handleDeleteNode,
    setNodes,
    setEdges,
  ]);

  // ── Node Management Actions ──────────────────────────────────────────

  // Select all scene nodes
  const handleSelectAll = useCallback(() => {
    const sceneIds = new Set(
      nodes.filter((n: any) => n.data.nodeType === 'scene').map((n: any) => n.id)
    );
    setSelectedNodeIds(sceneIds);
    setNodes((nds: any) =>
      nds.map((n: any) => (n.data.nodeType === 'scene' ? { ...n, selected: true } : n))
    );
  }, [nodes, setNodes]);

  // Invert selection
  const handleInvertSelection = useCallback(() => {
    const sceneIds = nodes.filter((n: any) => n.data.nodeType === 'scene').map((n: any) => n.id);
    const inverted = new Set(sceneIds.filter((nid: string) => !selectedNodeIds.has(nid)));
    setSelectedNodeIds(inverted);
  }, [nodes, selectedNodeIds]);

  // Toggle canon on selected nodes (local-only toggle)
  const handleToggleCanon = useCallback(() => {
    if (selectedNodeIds.size === 0) return;
    setNodes((nds: any) =>
      nds.map((n: any) => {
        if (!selectedNodeIds.has(n.id)) return n;
        return {
          ...n,
          data: {
            ...n.data,
            isInCanonChain: !n.data.isInCanonChain,
            isCanon: !n.data.isCanon,
          },
        };
      })
    );
  }, [selectedNodeIds, setNodes]);

  // Toggle canon on a single node
  const handleToggleCanonSingle = useCallback(
    (nodeId: string) => {
      setNodes((nds: any) =>
        nds.map((n: any) => {
          if (n.id !== nodeId) return n;
          return {
            ...n,
            data: {
              ...n.data,
              isInCanonChain: !n.data.isInCanonChain,
              isCanon: !n.data.isCanon,
            },
          };
        })
      );
    },
    [setNodes]
  );

  // Duplicate a single node (for context menu)
  const handleDuplicateSingle = useCallback(
    (nodeId: string) => {
      setSelectedNodeIds(new Set([nodeId]));
      // Slight delay to let selection update then trigger duplicate
      requestAnimationFrame(() => handleDuplicateSelected());
    },
    [handleDuplicateSelected]
  );

  // Toggle select for outline panel
  const handleToggleSelect = useCallback((nodeId: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  // Navigate to node (for outline panel and search)
  const handleNavigateToNode = useCallback(
    (node: Node<TimelineNodeData>) => {
      setCenter(node.position.x + 160, node.position.y + 136, {
        zoom: 1,
        duration: 500,
      });
      setSelectedNode(node);
    },
    [setCenter]
  );

  // Context menu handler
  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    if (node.data.nodeType !== 'scene') return;
    setContextMenu({
      visible: true,
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id,
    });
  }, []);

  // Create arc and assign selected nodes
  const handleCreateArcAndAssign = useCallback(
    (name: string) => {
      const arc = nodeArcs.addArc(name);
      if (selectedNodeIds.size > 0) {
        nodeArcs.addNodesToArc(arc.id, [...selectedNodeIds]);
      }
    },
    [nodeArcs, selectedNodeIds]
  );

  // Assign selected nodes to arc
  const handleAssignSelectedToArc = useCallback(
    (arcId: string) => {
      nodeArcs.addNodesToArc(arcId, [...selectedNodeIds]);
    },
    [nodeArcs, selectedNodeIds]
  );

  // ── Keyboard Shortcuts ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (e.target as HTMLElement)?.tagName || ''
      );

      // Ctrl/Cmd+K — search & filter
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch((v) => !v);
        return;
      }

      // Ctrl/Cmd+A — select all scene nodes
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !isInput) {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      // Ctrl/Cmd+Z — undo, Ctrl/Cmd+Shift+Z — redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !isInput) {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }

      // Skip remaining shortcuts if typing in an input
      if (isInput) return;

      // D — duplicate selected
      if (e.key === 'd' && !e.metaKey && !e.ctrlKey && selectedNodeIds.size > 0) {
        e.preventDefault();
        handleDuplicateSelected();
        return;
      }

      // C — toggle canon on selected
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey && selectedNodeIds.size > 0) {
        e.preventDefault();
        handleToggleCanon();
        return;
      }

      // E — edit selected node (single selection)
      if (e.key === 'e' && !e.metaKey && !e.ctrlKey && selectedNodeIds.size === 1) {
        e.preventDefault();
        const nodeId = [...selectedNodeIds][0];
        const node = nodesRef.current.find((n) => n.id === nodeId);
        if (node?.data.eventId) handleEditScene(node.data.eventId);
        return;
      }

      // O — toggle outline panel
      if (e.key === 'o' && !e.metaKey && !e.ctrlKey) {
        setShowOutlinePanel((v) => !v);
        return;
      }

      // G — assign to arc (opens context for arc assignment)
      if (e.key === 'g' && !e.metaKey && !e.ctrlKey && selectedNodeIds.size > 0) {
        if (nodeArcs.arcs.length === 1) {
          nodeArcs.addNodesToArc(nodeArcs.arcs[0].id, [...selectedNodeIds]);
        }
        return;
      }

      // F — fit view
      if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        fitView({ padding: 0.15, duration: 300 });
        return;
      }

      // 1 — zoom to 100%
      if (e.key === '1' && !e.metaKey && !e.ctrlKey) {
        const currentNodes = nodesRef.current;
        if (currentNodes.length > 0) {
          const centerNode = currentNodes[Math.floor(currentNodes.length / 2)];
          setCenter(centerNode.position.x + 160, centerNode.position.y + 136, {
            zoom: 1,
            duration: 300,
          });
        }
        return;
      }

      // + / = — zoom in
      if (e.key === '+' || e.key === '=') {
        zoomIn({ duration: 200 });
        return;
      }

      // - — zoom out
      if (e.key === '-') {
        zoomOut({ duration: 200 });
        return;
      }

      // Delete / Backspace — delete selected nodes
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeIds.size > 0) {
        e.preventDefault();
        setShowDeleteConfirm(true);
        return;
      }

      // Escape — close panels, clear selection
      if (e.key === 'Escape') {
        if (contextMenu.visible) {
          setContextMenu((c) => ({ ...c, visible: false }));
        } else if (showSearch) {
          setShowSearch(false);
          setSearchQuery('');
          nodeFilter.clearFilter();
        } else if (selectedNodeIds.size > 0) {
          handleClearSelection();
        }
        return;
      }

      // ? — toggle shortcuts help
      if (e.key === '?') {
        setShowShortcutsHelp((v) => !v);
        return;
      }

      // H — hand (pan) tool
      if (e.key === 'h') {
        setCanvasTool('hand');
        return;
      }

      // V — select tool
      if (e.key === 'v') {
        setCanvasTool('select');
        return;
      }

      // M — toggle minimap
      if (e.key === 'm') {
        setShowMiniMap((v) => {
          if (v) setShowMiniMapSettings(false);
          return !v;
        });
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    fitView,
    zoomIn,
    zoomOut,
    setCenter,
    handleUndo,
    handleRedo,
    handleClearSelection,
    handleSelectAll,
    handleDuplicateSelected,
    handleToggleCanon,
    handleEditScene,
    selectedNodeIds,
    showSearch,
    contextMenu.visible,
    nodeArcs,
    nodeFilter,
  ]);

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

    // Update localStorage — save old video as a version if it exists
    const storageKey = `universe_events_${id}`;
    const storedEvents = localStorage.getItem(storageKey);
    const eventsData = storedEvents ? JSON.parse(storedEvents) : {};
    const existingEvent = eventsData[editingEventId];

    if (existingEvent) {
      // If there's an existing video URL and it's different, save as version
      const oldVideoUrl = existingEvent.latestVideoUrl || existingEvent.videoUrl;
      if (oldVideoUrl && oldVideoUrl !== finalUrl) {
        const versions = existingEvent.videoVersions || [];
        versions.push({
          videoUrl: oldVideoUrl,
          generatedAt: existingEvent.timestamp || Date.now(),
          model: existingEvent.videoModel || 'manual',
          prompt: existingEvent.videoPrompt || existingEvent.description || '',
          duration: existingEvent.videoDuration || 0,
          aspectRatio: existingEvent.videoRatio || '16:9',
          negativePrompt: existingEvent.negativePrompt || '',
          imageUrl: existingEvent.imageUrl || null,
          versionNumber: versions.length + 1,
        });
        existingEvent.videoVersions = versions;
      }
      existingEvent.videoUrl = finalUrl;
      existingEvent.latestVideoUrl = finalUrl;
      existingEvent.currentVersionIndex = -1;
      eventsData[editingEventId] = existingEvent;
    } else {
      eventsData[editingEventId] = {
        eventId: editingEventId,
        videoUrl: finalUrl,
        latestVideoUrl: finalUrl,
        currentVersionIndex: -1,
        timestamp: Date.now(),
      };
    }
    localStorage.setItem(storageKey, JSON.stringify(eventsData));

    // Build version data for the node
    const versions = eventsData[editingEventId]?.videoVersions || [];
    const versionData = versions.map((v: any) => ({
      videoUrl: v.videoUrl,
      versionNumber: v.versionNumber,
      generatedAt: v.generatedAt,
      model: v.model,
    }));

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
              videoVersions: versionData.length > 0 ? versionData : undefined,
              currentVersionIndex: -1,
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

  // Remove video from a node without deleting the node itself
  const handleRemoveVideo = useCallback(() => {
    if (!editingEventId) return;

    // Clear from localStorage
    const storageKey = `universe_events_${id}`;
    const storedEvents = localStorage.getItem(storageKey);
    if (storedEvents) {
      const eventsData = JSON.parse(storedEvents);
      if (eventsData[editingEventId]) {
        delete eventsData[editingEventId].videoUrl;
        localStorage.setItem(storageKey, JSON.stringify(eventsData));
      }
    }

    // Clear videoUrl from the node
    setNodes((nds: any) =>
      nds.map((node: any) => {
        const nodeEventId = node.data.eventId;
        const nodeBlockchainId = node.data.blockchainNodeId?.toString();
        if (nodeEventId === editingEventId || nodeBlockchainId === editingEventId) {
          return {
            ...node,
            data: {
              ...node.data,
              videoUrl: undefined,
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
  }, [editingEventId, id, setNodes]);

  // Delete the entire event node from the dialog
  const handleDeleteFromDialog = useCallback(() => {
    if (!editingEventId) return;
    if (!confirm('Delete this event from the universe? This cannot be undone.')) return;

    handleDeleteNode(editingEventId);

    // Close dialog
    setEditVideoDialogOpen(false);
    setEditingEventId(null);
    setEditVideoUrl('');
    setEditVideoFile(null);
    setEditVideoPreview(null);
  }, [editingEventId, handleDeleteNode]);

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
        videoUrl: generatedVideoUrl || undefined,
        timelineColor: additionType === 'branch' ? '#f59e0b' : '#10b981',
        nodeType: 'scene',
        eventId: newEventId,
        displayName: displayName, // User-friendly display name
        timelineId: `timeline-${id}`,
        universeId: id,
        onAddScene: handleAddEvent,
        onEditScene: handleEditScene,
        onRegenerateScene: handleRegenerateScene,
        onSwitchVersion: handleSwitchVersion,
        onDeleteNode: handleDeleteNode,
        isSelected: false,
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
    handleRegenerateScene,
    handleSwitchVersion,
    handleDeleteNode,
    generatedVideoUrl,
    generatedImageUrl,
  ]);

  // Convert blockchain data to timeline nodes
  useEffect(() => {
    if (!graphData.nodeIds.length) return;

    const blockchainNodes: Node<TimelineNodeData>[] = [];
    const blockchainEdges: Edge[] = [];

    // Load archived (soft-deleted) node IDs
    const archivedNodeIds = getArchivedNodeIds();

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

      // Skip archived (soft-deleted) nodes
      if (archivedNodeIds.has(nodeId.toString()) || archivedNodeIds.has(String(nodeId))) return;

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

      // Load version history from localStorage
      let videoVersions: any[] | undefined;
      let currentVersionIndex: number | undefined;
      if (localEvent?.videoVersions && localEvent.videoVersions.length > 0) {
        videoVersions = localEvent.videoVersions.map((v: any) => ({
          videoUrl: v.videoUrl,
          versionNumber: v.versionNumber,
          generatedAt: v.generatedAt,
          model: v.model,
        }));
        currentVersionIndex = localEvent.currentVersionIndex ?? -1;
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
          onRegenerateScene: handleRegenerateScene,
          onSwitchVersion: handleSwitchVersion,
          onDeleteNode: handleDeleteNode,
          isSelected: false,
          videoVersions,
          currentVersionIndex,
        },
      });
    });

    // Create edges based on previous node relationships
    graphData.nodeIds.forEach((nodeIdStr, index) => {
      const nodeId = normalizeNodeId(nodeIdStr);
      const previousNodeStr = graphData.previousNodes[index];

      if (previousNodeStr && String(previousNodeStr) !== '0') {
        const previousNodeId = normalizeNodeId(previousNodeStr);
        const isCanonEdge = graphData.flags[index];
        const color = isCanonEdge ? colors[0] : colors[(index + 1) % colors.length];

        // Check if this is a branch (parent has multiple children)
        const parentChildren = layout.nodesByParent.get(previousNodeId) || [];
        const isBranch = parentChildren.length > 1 && parentChildren.indexOf(nodeId) > 0;

        blockchainEdges.push({
          id: `edge-${previousNodeId}-${nodeId}`,
          source: `blockchain-node-${previousNodeId}`,
          target: `blockchain-node-${nodeId}`,
          animated: true,
          label: isCanonEdge ? 'Canon' : isBranch ? 'Branch' : undefined,
          labelStyle: {
            fill: isCanonEdge ? '#eab308' : '#94a3b8',
            fontSize: 10,
            fontWeight: 600,
          },
          labelBgStyle: {
            fill: '#09090b',
            fillOpacity: 0.85,
          },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
          style: { stroke: color, strokeWidth: isCanonEdge ? 3 : 2 },
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

    // Re-fit the viewport after nodes are rendered so outlier nodes are reachable
    requestAnimationFrame(() => {
      fitView({ padding: 0.15, duration: 300 });
    });
  }, [
    graphData,
    finalUniverse?.id,
    id,
    handleAddEvent,
    handleEditScene,
    handleRegenerateScene,
    handleSwitchVersion,
    handleDeleteNode,
    getArchivedNodeIds,
    fitView,
  ]);

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

  // Sync isSelected + dimmed flags on node data when selection/filter changes
  useEffect(() => {
    setNodes((nds: any) =>
      nds.map((n: any) => {
        const shouldBeSelected = selectedNodeIds.has(n.id);
        const shouldBeDimmed =
          nodeFilter.matchingNodeIds !== null &&
          !nodeFilter.matchingNodeIds.has(n.id) &&
          n.data.nodeType === 'scene';
        if (n.data.isSelected !== shouldBeSelected || n.data.dimmed !== shouldBeDimmed) {
          return {
            ...n,
            data: { ...n.data, isSelected: shouldBeSelected, dimmed: shouldBeDimmed },
          };
        }
        return n;
      })
    );
  }, [selectedNodeIds, nodeFilter.matchingNodeIds, setNodes]);

  // Handle node selection — shift+click toggles multi-select without navigating
  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: any) => {
      // Shift+click = toggle selection, don't navigate
      if (event.shiftKey && node.data.nodeType === 'scene') {
        setSelectedNodeIds((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) {
            next.delete(node.id);
          } else {
            next.add(node.id);
          }
          return next;
        });
        return;
      }

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
        onOpenMusicStudio={() => setShowMusicStudio(true)}
      />

      {/* Main Content Area */}
      <TokenGateGuard universeId={id} target="view">
        <div
          className={`flex-1 flex flex-col min-w-0 overflow-hidden transition-all duration-300 ease-in-out ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}
        >
          <div className="flex-1 relative overflow-hidden w-full h-full">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={(changes) => {
                if (!isUndoRedoAction.current) {
                  const hasDrag = changes.some(
                    (c) => c.type === 'position' && c.dragging === false
                  );
                  if (hasDrag) pushUndoState();
                }
                onNodesChange(changes);
              }}
              onEdgesChange={onEdgesChange}
              onConnect={(connection) => {
                pushUndoState();
                onConnect(connection);
              }}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              nodeTypes={nodeTypes}
              onNodeContextMenu={handleNodeContextMenu}
              panOnDrag={canvasTool === 'hand'}
              panOnScroll
              selectionOnDrag={canvasTool === 'select'}
              selectionMode={SelectionMode.Partial}
              multiSelectionKeyCode="Shift"
              deleteKeyCode={null}
              fitView
              className="bg-gradient-to-br from-background via-background/95 to-muted/20"
              minZoom={0.1}
              maxZoom={2}
            >
              {/* Arc group overlays */}
              <NodeArcOverlay nodes={nodes} arcs={nodeArcs.arcs} />

              <Background />
              <Controls showInteractive={false} />

              {/* MiniMap — togglable with settings, auto-collapse, legend, stats */}
              {showMiniMap &&
                (() => {
                  const sceneNodes = nodes.filter((n) => n.data?.nodeType !== 'add');
                  const canonCount = sceneNodes.filter((n) => n.data?.isInCanonChain).length;
                  const branchCount = sceneNodes.filter(
                    (n) => n.data?.nodeType === 'branch'
                  ).length;
                  const totalScenes = sceneNodes.length;
                  const effectiveSize =
                    miniMapAutoCollapse && !isMiniMapHovered
                      ? Math.max(80, miniMapSize * 0.5)
                      : miniMapSize;

                  return (
                    <Panel position={miniMapPosition} className="!m-2">
                      <div
                        className="relative group"
                        onMouseEnter={() => setIsMiniMapHovered(true)}
                        onMouseLeave={() => setIsMiniMapHovered(false)}
                        style={{
                          opacity: miniMapOpacity / 100,
                          transition: 'opacity 0.2s ease, width 0.3s ease, height 0.3s ease',
                        }}
                      >
                        <MiniMap
                          nodeColor={(n: any) => {
                            if (n.data?.isInCanonChain) return '#eab308';
                            if (n.data?.nodeType === 'branch') return '#f97316';
                            if (n.data?.nodeType === 'add') return '#64748b';
                            return n.data?.timelineColor || '#10b981';
                          }}
                          nodeStrokeColor={(n: any) => {
                            if (n.data?.isRoot) return '#f472b6';
                            if (n.data?.isInCanonChain) return '#ca8a04';
                            return 'transparent';
                          }}
                          nodeStrokeWidth={2}
                          maskColor="rgba(0, 0, 0, 0.5)"
                          maskStrokeColor="#eab308"
                          maskStrokeWidth={2}
                          style={{
                            background: '#0a0a0a',
                            border: '1px solid #27272a',
                            borderRadius: 8,
                            width: effectiveSize,
                            height: effectiveSize * 0.75,
                            position: 'relative',
                            transition: 'width 0.3s ease, height 0.3s ease',
                            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
                          }}
                          nodeComponent={MiniMapNode}
                          pannable
                          zoomable
                          zoomStep={miniMapZoomStep}
                          onClick={(_event, position) => {
                            setCenter(position.x, position.y, { zoom: getZoom(), duration: 400 });
                          }}
                          onNodeClick={(_event, node) => {
                            setCenter(node.position.x + 160, node.position.y + 136, {
                              zoom: 1,
                              duration: 400,
                            });
                          }}
                        />

                        {/* Stats badge — top-left corner */}
                        <div className="absolute top-1 left-1 flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <div className="flex items-center gap-0.5 bg-zinc-900/90 backdrop-blur-sm rounded px-1 py-0.5 border border-zinc-700/50">
                            <Layers className="h-2.5 w-2.5 text-zinc-400" />
                            <span className="text-[9px] font-mono text-zinc-300">
                              {totalScenes}
                            </span>
                            {canonCount > 0 && (
                              <>
                                <span className="text-[9px] text-zinc-600">·</span>
                                <span className="text-[9px] font-mono text-amber-400">
                                  {canonCount}
                                </span>
                              </>
                            )}
                            {branchCount > 0 && (
                              <>
                                <span className="text-[9px] text-zinc-600">·</span>
                                <span className="text-[9px] font-mono text-orange-400">
                                  {branchCount}
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Controls — visible on hover */}
                        <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setMiniMapShowLegend((v) => !v)}
                            className={`p-1 rounded transition-colors ${miniMapShowLegend ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white'}`}
                            title="Toggle legend"
                          >
                            <Eye className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => setShowMiniMapSettings((v) => !v)}
                            className="p-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                            title="Minimap settings"
                          >
                            <Settings className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => setShowMiniMap(false)}
                            className="p-1 rounded bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                            title="Hide minimap (M)"
                          >
                            <EyeOff className="h-3 w-3" />
                          </button>
                        </div>

                        {/* Legend overlay — below minimap */}
                        {miniMapShowLegend && (!miniMapAutoCollapse || isMiniMapHovered) && (
                          <div className="mt-1 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/50 rounded-md px-2 py-1.5 space-y-0.5">
                            {/* Canon — rounded rect */}
                            <div className="flex items-center gap-1.5">
                              <svg width="10" height="10" className="flex-shrink-0">
                                <rect x="1" y="2" width="8" height="6" rx="1.5" fill="#eab308" />
                              </svg>
                              <span className="text-[9px] text-zinc-400">Canon chain</span>
                            </div>
                            {/* Branch — diamond */}
                            <div className="flex items-center gap-1.5">
                              <svg width="10" height="10" className="flex-shrink-0">
                                <rect
                                  x="2"
                                  y="2"
                                  width="6"
                                  height="6"
                                  rx="0.5"
                                  fill="#f97316"
                                  transform="rotate(45,5,5)"
                                />
                              </svg>
                              <span className="text-[9px] text-zinc-400">Branch</span>
                            </div>
                            {/* Scene — rect */}
                            <div className="flex items-center gap-1.5">
                              <svg width="10" height="10" className="flex-shrink-0">
                                <rect x="1" y="2" width="8" height="6" rx="1.5" fill="#10b981" />
                              </svg>
                              <span className="text-[9px] text-zinc-400">Scene</span>
                            </div>
                            {/* Root — circle with stroke */}
                            <div className="flex items-center gap-1.5">
                              <svg width="10" height="10" className="flex-shrink-0">
                                <circle
                                  cx="5"
                                  cy="5"
                                  r="4"
                                  fill="#10b981"
                                  stroke="#f472b6"
                                  strokeWidth="1.5"
                                />
                              </svg>
                              <span className="text-[9px] text-zinc-400">Root (origin)</span>
                            </div>
                          </div>
                        )}

                        {/* Settings panel */}
                        {showMiniMapSettings && (
                          <div
                            className="absolute z-50 bg-zinc-900/95 backdrop-blur-md border border-zinc-700 rounded-lg shadow-2xl p-3 w-60 space-y-3"
                            style={{
                              [miniMapPosition.includes('bottom') ? 'bottom' : 'top']: '100%',
                              [miniMapPosition.includes('right') ? 'right' : 'left']: 0,
                              marginBottom: miniMapPosition.includes('bottom') ? 4 : undefined,
                              marginTop: miniMapPosition.includes('top') ? 4 : undefined,
                            }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-zinc-300">
                                Minimap Settings
                              </span>
                              <button
                                onClick={() => setShowMiniMapSettings(false)}
                                className="p-0.5 hover:bg-zinc-700 rounded text-zinc-500 hover:text-white"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>

                            {/* Size */}
                            <div className="space-y-1">
                              <label className="text-[11px] text-zinc-400">
                                Size — {miniMapSize}px
                              </label>
                              <Slider
                                value={[miniMapSize]}
                                onValueChange={([v]) => setMiniMapSize(v)}
                                min={100}
                                max={300}
                                step={10}
                                className="w-full"
                              />
                              <div className="flex justify-between text-[10px] text-zinc-500">
                                <span>Small</span>
                                <span>Large</span>
                              </div>
                            </div>

                            {/* Opacity */}
                            <div className="space-y-1">
                              <label className="text-[11px] text-zinc-400">
                                Opacity — {miniMapOpacity}%
                              </label>
                              <Slider
                                value={[miniMapOpacity]}
                                onValueChange={([v]) => setMiniMapOpacity(v)}
                                min={20}
                                max={100}
                                step={5}
                                className="w-full"
                              />
                              <div className="flex justify-between text-[10px] text-zinc-500">
                                <span>Faint</span>
                                <span>Solid</span>
                              </div>
                            </div>

                            {/* Zoom Sensitivity */}
                            <div className="space-y-1">
                              <label className="text-[11px] text-zinc-400">
                                Zoom Sensitivity — {miniMapZoomStep}
                              </label>
                              <Slider
                                value={[miniMapZoomStep]}
                                onValueChange={([v]) => setMiniMapZoomStep(v)}
                                min={1}
                                max={10}
                                step={1}
                                className="w-full"
                              />
                              <div className="flex justify-between text-[10px] text-zinc-500">
                                <span>Fine</span>
                                <span>Coarse</span>
                              </div>
                            </div>

                            {/* Toggles */}
                            <div className="space-y-1.5">
                              <label className="text-[11px] text-zinc-400">Options</label>
                              <div className="space-y-1">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={miniMapAutoCollapse}
                                    onChange={(e) => setMiniMapAutoCollapse(e.target.checked)}
                                    className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-amber-500"
                                  />
                                  <span className="text-[11px] text-zinc-300">
                                    Auto-collapse when idle
                                  </span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={miniMapShowLegend}
                                    onChange={(e) => setMiniMapShowLegend(e.target.checked)}
                                    className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-amber-500"
                                  />
                                  <span className="text-[11px] text-zinc-300">Show legend</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={miniMapShowEdges}
                                    onChange={(e) => setMiniMapShowEdges(e.target.checked)}
                                    className="w-3 h-3 rounded border-zinc-600 bg-zinc-800 accent-amber-500"
                                  />
                                  <span className="text-[11px] text-zinc-300">
                                    Show connections
                                  </span>
                                </label>
                              </div>
                            </div>

                            {/* Position */}
                            <div className="space-y-1">
                              <label className="text-[11px] text-zinc-400">Position</label>
                              <div className="grid grid-cols-2 gap-1">
                                {(
                                  [
                                    ['top-left', 'Top Left'],
                                    ['top-right', 'Top Right'],
                                    ['bottom-left', 'Bottom Left'],
                                    ['bottom-right', 'Bottom Right'],
                                  ] as const
                                ).map(([pos, label]) => (
                                  <button
                                    key={pos}
                                    onClick={() => setMiniMapPosition(pos)}
                                    className={`text-[11px] px-2 py-1 rounded transition-colors ${
                                      miniMapPosition === pos
                                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white border border-zinc-700'
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </Panel>
                  );
                })()}

              {/* Search & Filter Overlay */}
              {showSearch && (
                <Panel position="top-center" className="z-50 mt-2">
                  <NodeFilterBar
                    filter={nodeFilter.filter}
                    isActive={nodeFilter.isActive}
                    arcs={nodeArcs.arcs}
                    matchCount={nodeFilter.matchingNodeIds?.size ?? getSceneNodes(nodes).length}
                    totalCount={getSceneNodes(nodes).length}
                    onSearchTextChange={nodeFilter.setSearchText}
                    onCanonStatusChange={nodeFilter.setCanonStatus}
                    onArcIdChange={nodeFilter.setArcId}
                    onHasVideoChange={nodeFilter.setHasVideo}
                    onClear={() => {
                      nodeFilter.clearFilter();
                    }}
                    onClose={() => {
                      setShowSearch(false);
                      nodeFilter.clearFilter();
                    }}
                  />
                </Panel>
              )}

              {/* Keyboard Shortcuts Help */}
              {showShortcutsHelp && (
                <Panel position="bottom-center" className="z-50 mb-2">
                  <ShortcutsHelpDialog onClose={() => setShowShortcutsHelp(false)} />
                </Panel>
              )}

              <Panel position="top-right">
                <div className="flex gap-2">
                  {/* Canvas Tool Mode */}
                  <div className="flex bg-zinc-900/80 backdrop-blur-sm border border-zinc-700 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setCanvasTool('hand')}
                      className={`p-1.5 transition-colors ${canvasTool === 'hand' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-400 hover:bg-zinc-700 hover:text-white'}`}
                      title="Hand tool — drag to pan (H)"
                    >
                      <Hand className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setCanvasTool('select')}
                      className={`p-1.5 transition-colors ${canvasTool === 'select' ? 'bg-amber-500/20 text-amber-400' : 'text-zinc-400 hover:bg-zinc-700 hover:text-white'}`}
                      title="Select tool — drag to select multiple (V)"
                    >
                      <MousePointer2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Zoom & Layout Controls */}
                  <div className="flex bg-zinc-900/80 backdrop-blur-sm border border-zinc-700 rounded-lg overflow-hidden">
                    <button
                      onClick={() => zoomIn({ duration: 200 })}
                      className="p-1.5 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
                      title="Zoom in (+)"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => zoomOut({ duration: 200 })}
                      className="p-1.5 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
                      title="Zoom out (-)"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => fitView({ padding: 0.15, duration: 300 })}
                      className="p-1.5 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
                      title="Fit to view (F)"
                    >
                      <Locate className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleAutoLayout}
                      className="p-1.5 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
                      title="Auto-layout nodes"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setShowMiniMap((v) => !v)}
                      className={`p-1.5 hover:bg-zinc-700 transition-colors ${showMiniMap ? 'text-amber-400' : 'text-zinc-400 hover:text-white'}`}
                      title={showMiniMap ? 'Hide minimap (M)' : 'Show minimap (M)'}
                    >
                      <Map className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setShowOutlinePanel((v) => !v)}
                      className={`p-1.5 hover:bg-zinc-700 transition-colors ${showOutlinePanel ? 'text-amber-400' : 'text-zinc-400 hover:text-white'}`}
                      title="Node outline (O)"
                    >
                      <List className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        setShowSearch(true);
                      }}
                      className="p-1.5 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
                      title="Search & filter (Ctrl+K)"
                    >
                      <Search className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleUndo}
                      className="p-1.5 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white disabled:opacity-30"
                      title="Undo (Ctrl+Z)"
                      disabled={undoStack.current.length === 0}
                    >
                      <Undo2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={handleRedo}
                      className="p-1.5 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white disabled:opacity-30"
                      title="Redo (Ctrl+Shift+Z)"
                      disabled={redoStack.current.length === 0}
                    >
                      <Redo2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setIsFullscreen(!isFullscreen)}
                      className="p-1.5 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white"
                      title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen canvas'}
                    >
                      {isFullscreen ? (
                        <Minimize2 className="h-4 w-4" />
                      ) : (
                        <Maximize2 className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => setShowShortcutsHelp((v) => !v)}
                      className="p-1.5 hover:bg-zinc-700 transition-colors text-zinc-400 hover:text-white text-xs font-bold"
                      title="Keyboard shortcuts (?)"
                    >
                      ?
                    </button>
                  </div>

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
                    className="hover:bg-blue-500/10 hover:text-blue-400 transition-all duration-300"
                  >
                    <Link to="/wiki" search={{ universe: id }}>
                      <Layers className="h-4 w-4 mr-2" />
                      Wiki
                    </Link>
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

              {/* Selection Toolbar — appears when nodes are selected */}
              {selectedNodeIds.size > 0 && !showSearch && (
                <Panel position="top-center">
                  <BulkOperationsToolbar
                    selectedNodeIds={selectedNodeIds}
                    nodes={nodes}
                    arcs={nodeArcs.arcs}
                    hasVideoInSelection={nodes.some(
                      (n: any) =>
                        selectedNodeIds.has(n.id) && n.data?.videoUrl && n.data.nodeType === 'scene'
                    )}
                    selectedClipsCount={selectedClips.length}
                    onPlaySelected={handlePlaySelected}
                    onDuplicateSelected={handleDuplicateSelected}
                    onDeleteSelected={handleDeleteSelected}
                    onClearSelection={handleClearSelection}
                    onSelectAll={handleSelectAll}
                    onInvertSelection={handleInvertSelection}
                    onToggleCanon={handleToggleCanon}
                    onAssignToArc={handleAssignSelectedToArc}
                    onCreateArc={handleCreateArcAndAssign}
                    onShowAudioToolbar={() => setShowAudioToolbar(true)}
                    onBuildEpisode={() => setShowEpisodeBuilder(true)}
                    onScriptToEpisode={() => setShowScriptToEpisode(true)}
                  />
                </Panel>
              )}

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

            {/* Node Context Menu (portal) */}
            <NodeContextMenu
              state={contextMenu}
              node={
                contextMenu.nodeId
                  ? ((nodes.find((n) => n.id === contextMenu.nodeId) as
                      | Node<TimelineNodeData>
                      | undefined) ?? null)
                  : null
              }
              arcs={nodeArcs.arcs}
              universeId={id}
              onClose={() => setContextMenu((c) => ({ ...c, visible: false }))}
              onEdit={handleEditScene}
              onDuplicate={handleDuplicateSingle}
              onBranch={(eventId) => handleAddEvent('branch', eventId)}
              onToggleCanon={handleToggleCanonSingle}
              onDelete={handleDeleteNode}
              onAssignToArc={nodeArcs.addNodesToArc}
              onCreateArc={(name) => nodeArcs.addArc(name)}
              onPlay={(nodeId) => {
                setSelectedNodeIds(new Set([nodeId]));
                setShowSelectionPlayer(true);
              }}
            />
          </div>
        </div>

        {/* Node Outline Panel (left sidebar) */}
        <NodeOutlinePanel
          open={showOutlinePanel}
          onOpenChange={setShowOutlinePanel}
          nodes={nodes}
          edges={edges}
          arcs={nodeArcs.arcs}
          selectedNodeIds={selectedNodeIds}
          onNavigateToNode={handleNavigateToNode}
          onToggleSelect={handleToggleSelect}
        />

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
              selectedImageModel={selectedImageModel}
              setSelectedImageModel={setSelectedImageModel}
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

        {/* Music Studio Panel */}
        {showMusicStudio && (
          <div className="w-[360px] border-l border-zinc-800 bg-zinc-950 overflow-y-auto flex flex-col shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
              <span className="text-sm font-medium flex items-center gap-2">
                <Music className="h-4 w-4 text-amber-500" />
                Music Studio
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => setShowMusicStudio(false)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="p-3">
              <MusicGenerationPanel
                universeId={id}
                onGenerated={() => {
                  // Could refresh media or show a toast
                }}
              />
            </div>
          </div>
        )}

        {/* Governance Sidebar */}
        <GovernanceSidebar
          isOpen={showGovernanceSidebar}
          onClose={() => setShowGovernanceSidebar(false)}
          finalUniverse={finalUniverse}
          nodes={nodes}
          onRefresh={handleRefreshTimeline}
        />

        {/* Scene Controls Panel — appears when a scene node is selected */}
        {selectedNode &&
          selectedNode.data.nodeType === 'scene' &&
          !showGovernanceSidebar &&
          !showCreatorsRoom &&
          !showCastManager && (
            <div className="w-[320px] border-l border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col shrink-0">
              <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
                <span className="text-sm text-zinc-400 truncate">
                  {selectedNode.data.displayName || selectedNode.data.eventId}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="default"
                    onClick={handleSaveSceneControls}
                    disabled={isSavingControls}
                    className="h-6 text-xs px-2"
                  >
                    {isSavingControls ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedNode(null)}
                    className="text-zinc-500 hover:text-white h-6 w-6 p-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                {/* Motion Brush overlay */}
                {showMotionBrush && selectedNode.data.videoUrl ? (
                  <MotionBrush
                    imageUrl={selectedNode.data.videoUrl}
                    onSave={handleMotionBrushSave}
                    onCancel={() => setShowMotionBrush(false)}
                  />
                ) : (
                  <SceneControlsPanel
                    nodeId={selectedNode.data.eventId || ''}
                    universeId={id}
                    controls={selectedNodeControls}
                    onChange={setSelectedNodeControls}
                    castMembers={
                      castMembersData?.map((m: any) => ({
                        id: m.id,
                        name: m.name,
                        referenceImageUrls: m.referenceImageUrls,
                      })) || []
                    }
                    onOpenCastManager={() => setShowCastManager(true)}
                    onOpenMotionBrush={() => setShowMotionBrush(true)}
                    siblingNodes={nodes
                      .filter((n: any) => n.data.nodeType === 'scene' && n.data.eventId)
                      .map((n: any) => ({
                        id: n.data.eventId,
                        label: n.data.displayName || n.data.eventId,
                        videoUrl: n.data.videoUrl,
                      }))}
                  />
                )}
              </div>
            </div>
          )}

        {/* Cast Manager Sidebar (Feature 3) */}
        <CastManager
          universeId={id}
          isOpen={showCastManager}
          onClose={() => setShowCastManager(false)}
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
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    if (parent && !parent.querySelector('.video-error-msg')) {
                      const msg = document.createElement('div');
                      msg.className =
                        'video-error-msg absolute inset-0 flex items-center justify-center text-red-400 text-sm';
                      msg.textContent = 'Failed to load video — check URL';
                      parent.appendChild(msg);
                    }
                  }}
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

            {/* Regenerate with same context */}
            {editingEventId &&
              (() => {
                const storageKey = `universe_events_${id}`;
                const storedEvents = localStorage.getItem(storageKey);
                const eventsData = storedEvents ? JSON.parse(storedEvents) : {};
                const eventData = eventsData[editingEventId];
                const hasContext =
                  eventData?.videoPrompt || eventData?.imagePrompt || eventData?.description;
                const versions = eventData?.videoVersions || [];

                return hasContext ? (
                  <div className="space-y-3">
                    {/* Regenerate button */}
                    <Button
                      variant="outline"
                      className="w-full gap-2 border-primary/40 hover:bg-primary/10"
                      onClick={() => {
                        setEditVideoDialogOpen(false);
                        handleRegenerateScene(editingEventId);
                      }}
                      disabled={!!regeneratingEventId}
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${regeneratingEventId === editingEventId ? 'animate-spin' : ''}`}
                      />
                      {regeneratingEventId === editingEventId
                        ? 'Regenerating...'
                        : 'Regenerate with Same Context'}
                    </Button>
                    {eventData?.videoPrompt && (
                      <p
                        className="text-xs text-muted-foreground truncate"
                        title={eventData.videoPrompt}
                      >
                        Prompt: "{eventData.videoPrompt}"
                      </p>
                    )}

                    {/* Version history */}
                    {versions.length > 0 && (
                      <div>
                        <div className="flex items-center gap-1.5 mb-2">
                          <History className="h-3.5 w-3.5 text-muted-foreground" />
                          <Label className="text-sm font-medium">Version History</Label>
                          <span className="text-xs text-muted-foreground">
                            ({versions.length + 1} versions)
                          </span>
                        </div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {/* Historical versions */}
                          {versions.map((v: any, idx: number) => {
                            const isCurrent = eventData.currentVersionIndex === idx;
                            return (
                              <button
                                key={idx}
                                className={`flex-shrink-0 w-24 rounded-md overflow-hidden border-2 transition-all ${
                                  isCurrent
                                    ? 'border-primary ring-1 ring-primary/50'
                                    : 'border-transparent hover:border-zinc-500'
                                }`}
                                onClick={() => {
                                  handleSwitchVersion(editingEventId, idx);
                                  setEditVideoPreview(v.videoUrl);
                                }}
                                title={`v${v.versionNumber} — ${v.model || 'unknown'} — ${new Date(v.generatedAt).toLocaleDateString()}`}
                              >
                                <div className="aspect-video bg-zinc-800 relative">
                                  <video
                                    src={v.videoUrl}
                                    className="w-full h-full object-cover"
                                    muted
                                    preload="metadata"
                                  />
                                  <div className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[10px] text-center py-0.5">
                                    v{v.versionNumber}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                          {/* Current / latest version */}
                          <button
                            className={`flex-shrink-0 w-24 rounded-md overflow-hidden border-2 transition-all ${
                              eventData.currentVersionIndex === -1 ||
                              eventData.currentVersionIndex === undefined
                                ? 'border-primary ring-1 ring-primary/50'
                                : 'border-transparent hover:border-zinc-500'
                            }`}
                            onClick={() => {
                              handleSwitchVersion(editingEventId, -1);
                              const latestUrl = eventData.latestVideoUrl || eventData.videoUrl;
                              setEditVideoPreview(latestUrl);
                            }}
                            title="Latest version"
                          >
                            <div className="aspect-video bg-zinc-800 relative">
                              <video
                                src={eventData.latestVideoUrl || eventData.videoUrl}
                                className="w-full h-full object-cover"
                                muted
                                preload="metadata"
                              />
                              <div className="absolute bottom-0 inset-x-0 bg-primary/90 text-white text-[10px] text-center py-0.5">
                                v{versions.length + 1} (latest)
                              </div>
                            </div>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Divider */}
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">
                          or replace manually
                        </span>
                      </div>
                    </div>
                  </div>
                ) : null;
              })()}

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

          <DialogFooter className="mt-4 flex items-center justify-between sm:justify-between">
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteFromDialog}
                disabled={isUploadingEditVideo}
                className="gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete Event
              </Button>
              {editVideoPreview && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemoveVideo}
                  disabled={isUploadingEditVideo}
                  className="gap-1 text-red-400 border-red-500/40 hover:bg-red-500/10"
                >
                  <X className="h-3.5 w-3.5" />
                  Remove Video
                </Button>
              )}
            </div>
            <div className="flex gap-2">
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
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Selection Playlist Player */}
      {showSelectionPlayer && selectionVideos.length > 0 && (
        <SelectionPlayer videos={selectionVideos} onClose={() => setShowSelectionPlayer(false)} />
      )}

      {/* Episode Builder */}
      {showEpisodeBuilder && (
        <EpisodeBuilder
          universeId={id}
          nodes={nodes}
          initialNodeIds={[...selectedNodeIds]}
          onClose={() => setShowEpisodeBuilder(false)}
        />
      )}

      {/* Script-to-Episode */}
      {showScriptToEpisode && (
        <ScriptToEpisode
          universeId={id}
          onClose={() => setShowScriptToEpisode(false)}
          onComplete={(episodeId) => {
            setShowScriptToEpisode(false);
            // Could open EpisodeBuilder with the completed episode here
          }}
        />
      )}

      {/* Audio Toolbar — Music, SFX, Lip Sync */}
      {showAudioToolbar && selectedClips.length > 0 && (
        <AudioToolbar
          universeId={id}
          selectedClips={selectedClips}
          onClearSelection={() => {
            setShowAudioToolbar(false);
          }}
          onSoundNodeCreated={() => {
            // Keep selection so user can add more layers to same clips
          }}
        />
      )}
    </div>
  );
}

function UniverseTimelineEditor() {
  return (
    <ReactFlowProvider>
      <UniverseTimelineEditorInner />
    </ReactFlowProvider>
  );
}

export const Route = createFileRoute('/universe/$id')({
  component: UniverseTimelineEditor,
});
