import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useUniverseBlockchain } from '../../hooks/useUniverseBlockchain';
import { trpc } from '../../utils/trpc';
import { ChoiceOverlay } from './ChoiceOverlay';
import { PlayerControls } from './PlayerControls';
import { BranchStats } from './BranchStats';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@tanstack/react-router';

interface NodeData {
  id: number;
  contentHash: string;
  plotHash: string;
  previousId: number;
  nextIds: number[];
  canon: boolean;
  mediaUrl?: string;
}

export function BranchingPlayer({ universeId }: { universeId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentNodeId, setCurrentNodeId] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showChoices, setShowChoices] = useState(false);
  const [progress, setProgress] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Get the full graph from the blockchain
  const { graphData: fullGraph } = useUniverseBlockchain({
    universeId,
    contractAddress: undefined,
    isBlockchainUniverse: true,
  });

  // Session management
  const startSession = useMutation(trpc.player.startSession.mutationOptions());
  const recordChoice = useMutation(trpc.player.recordChoice.mutationOptions());

  const [sessionId, setSessionId] = useState<string | null>(null);

  // Build node map from graph data
  const [nodeMap, setNodeMap] = useState<Map<number, NodeData>>(new Map());

  useEffect(() => {
    if (!fullGraph) return;
    const map = new Map<number, NodeData>();
    const data = fullGraph as any;

    if (data?.nodeIds) {
      for (let i = 0; i < data.nodeIds.length; i++) {
        const id = Number(data.nodeIds[i]);
        map.set(id, {
          id,
          contentHash: data.contentHashes?.[i] || '',
          plotHash: data.plotHashes?.[i] || '',
          previousId: Number(data.previousIds?.[i] || 0),
          nextIds: (data.nextIds?.[i] || []).map(Number),
          canon: data.canonFlags?.[i] || false,
        });
      }
    }
    setNodeMap(map);
  }, [fullGraph]);

  // Start session on mount
  useEffect(() => {
    startSession.mutate(
      { universeId },
      {
        onSuccess: (data) => {
          setSessionId(data.sessionId);
          if (data.resumed && 'currentNodeId' in data && data.currentNodeId) {
            setCurrentNodeId(data.currentNodeId as number);
          }
        },
      }
    );
  }, [universeId]);

  const currentNode = nodeMap.get(currentNodeId);
  const hasBranches = currentNode && currentNode.nextIds.length > 1;

  // Handle video time updates — show choices near end
  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const pct = video.duration > 0 ? (video.currentTime / video.duration) * 100 : 0;
    setProgress(pct);

    // Show choice overlay 5 seconds before end (or at 90%)
    if (hasBranches && video.duration > 0) {
      const timeRemaining = video.duration - video.currentTime;
      if (timeRemaining <= 5 && !showChoices) {
        setShowChoices(true);
      }
    }
  }, [hasBranches, showChoices, currentNodeId]);

  // Track timeout for cleanup
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    };
  }, []);

  // Handle branch selection
  const handleChooseNode = (nextNodeId: number) => {
    setShowChoices(false);
    setShowStats(true);

    if (sessionId) {
      recordChoice.mutate({
        sessionId,
        nodeId: nextNodeId,
        fromNodeId: currentNodeId,
      });
    }

    // Brief delay to show stats, then transition
    transitionTimerRef.current = setTimeout(() => {
      setCurrentNodeId(nextNodeId);
      setShowStats(false);
      setProgress(0);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play();
      }
    }, 2000);
  };

  // Handle video end (auto-advance if single path, show choices if branch)
  const handleVideoEnd = () => {
    setIsPlaying(false);
    if (currentNode?.nextIds.length === 1) {
      // Single path — auto-advance
      handleChooseNode(currentNode.nextIds[0]);
    } else if (currentNode?.nextIds.length === 0) {
      // Leaf node — end of path
      setShowChoices(false);
    } else {
      setShowChoices(true);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const isLeaf = currentNode?.nextIds.length === 0;

  return (
    <div className="relative w-full h-screen bg-black flex items-center justify-center">
      {/* Back button */}
      <Link
        to="/universe/$id"
        params={{ id: universeId }}
        className="absolute top-4 left-4 z-30 p-2 bg-black/50 rounded-full text-white/70 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-5 h-5" />
      </Link>

      {/* Node info */}
      <div className="absolute top-4 right-4 z-30 px-3 py-1.5 bg-black/50 rounded-lg text-xs text-white/70">
        Node {currentNodeId} {currentNode?.canon && '(Canon)'}
      </div>

      {/* Video */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        src={currentNode?.mediaUrl || ''}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleVideoEnd}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        playsInline
      />

      {/* Choice overlay */}
      {showChoices && hasBranches && !showStats && (
        <ChoiceOverlay
          choices={currentNode!.nextIds.map((id) => ({
            nodeId: id,
            label: `Path ${id}`,
            isCanon: nodeMap.get(id)?.canon || false,
          }))}
          onChoose={handleChooseNode}
        />
      )}

      {/* Branch stats overlay */}
      {showStats && <BranchStats universeId={universeId} nodeId={currentNodeId} />}

      {/* End of path */}
      {isLeaf && !isPlaying && progress > 90 && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-white mb-4">End of this path</h2>
            <p className="text-zinc-400 mb-6">You've reached a leaf node in the story</p>
            <button
              onClick={() => {
                setCurrentNodeId(1);
                setProgress(0);
              }}
              className="px-6 py-3 bg-violet-600 hover:bg-violet-700 rounded-xl text-white font-medium transition-colors"
            >
              Restart from beginning
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <PlayerControls
        isPlaying={isPlaying}
        progress={progress}
        onTogglePlay={togglePlay}
        onSeek={(pct) => {
          if (videoRef.current && videoRef.current.duration) {
            videoRef.current.currentTime = (pct / 100) * videoRef.current.duration;
          }
        }}
      />
    </div>
  );
}
