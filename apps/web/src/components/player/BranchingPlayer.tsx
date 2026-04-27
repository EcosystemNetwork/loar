import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useUniverseBlockchain } from '../../hooks/useUniverseBlockchain';
import { trpc } from '../../utils/trpc';
import { ChoiceOverlay } from './ChoiceOverlay';
import { PlayerControls } from './PlayerControls';
import { BranchStats } from './BranchStats';
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { getIpfsUrlCandidates, resolveIpfsUrl } from '@/utils/ipfs-url';
import { useHlsVideo, isHlsUrl } from '@/hooks/useHlsVideo';

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
  const [isBuffering, setIsBuffering] = useState(false);
  const [srcIndex, setSrcIndex] = useState(0);
  const [hasError, setHasError] = useState(false);

  // Get the full graph from the blockchain — universeId IS the contract address
  const { graphData: fullGraph } = useUniverseBlockchain({
    universeId,
    contractAddress: universeId.startsWith('0x') ? universeId : undefined,
    isBlockchainUniverse: universeId.startsWith('0x'),
  });

  // Session management
  const startSession = useMutation(trpc.player.startSession.mutationOptions());
  const recordChoice = useMutation(trpc.player.recordChoice.mutationOptions());

  const [sessionId, setSessionId] = useState<string | null>(null);

  // Build node map from graph data — uses resolved URLs and descriptions
  const [nodeMap, setNodeMap] = useState<Map<number, NodeData>>(new Map());

  useEffect(() => {
    if (!fullGraph) return;
    const map = new Map<number, NodeData>();
    const data = fullGraph as any;

    if (data?.nodeIds) {
      for (let i = 0; i < data.nodeIds.length; i++) {
        const id = Number(data.nodeIds[i]);

        // Resolve media URL: prefer resolved URLs from indexer, fall back to contentHash
        const resolvedUrl = data.urls?.[i] || '';
        const contentHash = data.contentHashes?.[i] || '';
        const isHash = (val: string) => /^0x[0-9a-fA-F]{64}$/.test(val);
        const mediaUrl = resolvedUrl && !isHash(resolvedUrl) ? resolvedUrl : '';

        // Also check localStorage for locally-saved events
        let localUrl = '';
        try {
          const localKey = `universe_events_${universeId}`;
          const stored = localStorage.getItem(localKey);
          if (stored) {
            const events = JSON.parse(stored);
            const localEvent = events[id.toString()] || events[String(id)];
            if (localEvent?.videoUrl) localUrl = localEvent.videoUrl;
          }
        } catch {
          /* ignore */
        }

        map.set(id, {
          id,
          contentHash,
          plotHash: data.plotHashes?.[i] || '',
          previousId: Number(data.previousNodes?.[i] || data.previousIds?.[i] || 0),
          nextIds: (data.children?.[i] || data.nextIds?.[i] || []).map(Number),
          canon: data.flags?.[i] || data.canonFlags?.[i] || false,
          mediaUrl: localUrl || mediaUrl,
        });
      }
    }
    setNodeMap(map);
  }, [fullGraph, universeId]);

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

  // Collect every node's contentHash (normalized to raw lowercase 64-hex) so
  // we can ask the server which ones have a finished HLS rendition. Cap at
  // 60 — the endpoint chunks Firestore `in` queries internally up to that.
  const contentHashes = useMemo(() => {
    const out = new Set<string>();
    for (const node of nodeMap.values()) {
      const stripped = String(node.contentHash || '')
        .replace(/^0x/, '')
        .toLowerCase();
      if (/^[0-9a-f]{64}$/.test(stripped)) out.add(stripped);
      if (out.size >= 60) break;
    }
    return Array.from(out);
  }, [nodeMap]);

  const { data: hlsLookup } = useQuery({
    ...trpc.content.hlsByHashes.queryOptions({ contentHashes }),
    enabled: contentHashes.length > 0,
    staleTime: 60_000,
  });

  // Prefer the HLS master playlist when the transcoder has finished for this
  // node; otherwise fall back to the progressive mediaUrl from the chain.
  const sourceUrl = useMemo(() => {
    const hash = String(currentNode?.contentHash || '')
      .replace(/^0x/, '')
      .toLowerCase();
    const hlsUrl = hash && hlsLookup ? hlsLookup[hash]?.hlsUrl : null;
    return hlsUrl || currentNode?.mediaUrl || '';
  }, [currentNode?.contentHash, currentNode?.mediaUrl, hlsLookup]);

  const srcCandidates = useMemo(() => getIpfsUrlCandidates(sourceUrl), [sourceUrl]);
  const activeSrc = srcCandidates[srcIndex] || resolveIpfsUrl(sourceUrl);
  const playingHls = isHlsUrl(activeSrc);

  // hls.js attaches itself to the <video> element when src is .m3u8. For
  // progressive sources this hook is a no-op and React's `src` prop wins.
  useHlsVideo(videoRef, playingHls ? activeSrc : null);

  // Reset src/error state whenever the source URL changes (branch switch
  // OR HLS just became available for the current node).
  useEffect(() => {
    setSrcIndex(0);
    setHasError(false);
    setIsBuffering(false);
  }, [sourceUrl]);

  const handleVideoError = useCallback(() => {
    if (srcIndex + 1 < srcCandidates.length) {
      setSrcIndex(srcIndex + 1);
      setIsBuffering(true);
    } else {
      setIsBuffering(false);
      setHasError(true);
    }
  }, [srcIndex, srcCandidates.length]);

  const retryPlayback = useCallback(() => {
    setHasError(false);
    setSrcIndex(0);
    setIsBuffering(true);
    // Force the <video> element to re-load the first candidate.
    const v = videoRef.current;
    if (v) {
      v.load();
      void v.play();
    }
  }, []);

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
        to="/universe/$id/watch"
        params={{ id: universeId }}
        aria-label="Back to universe"
        className="absolute top-4 left-4 z-30 p-3 bg-black/60 rounded-full text-white/80 active:bg-black/80 transition-colors"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <ArrowLeft className="w-5 h-5" />
      </Link>

      {/* Node info */}
      <div
        className="absolute top-4 right-4 z-30 px-3 py-1.5 bg-black/60 rounded-lg text-xs text-white/80"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        Node {currentNodeId} {currentNode?.canon && '(Canon)'}
      </div>

      {/* Video */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        // For HLS, useHlsVideo manages the source via MSE / native attach,
        // so we don't pass `src` here (would conflict with hls.js).
        src={playingHls ? undefined : activeSrc}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleVideoEnd}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onStalled={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onPlaying={() => setIsBuffering(false)}
        onError={handleVideoError}
        preload="metadata"
        playsInline
      />

      {/* Buffering spinner — shown while the video is fetching/decoding. */}
      {isBuffering && !hasError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
          <div className="bg-black/40 rounded-full p-4 backdrop-blur-sm">
            <Loader2 className="w-10 h-10 text-white animate-spin" />
          </div>
        </div>
      )}

      {/* Playback error — all gateway candidates exhausted. */}
      {hasError && (
        <div className="absolute inset-0 z-20 bg-black/80 flex items-center justify-center">
          <div className="text-center max-w-sm px-6">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-white mb-1">Playback failed</h3>
            <p className="text-sm text-zinc-400 mb-5">
              Couldn't reach any IPFS gateway for this clip.
            </p>
            <button
              onClick={retryPlayback}
              className="px-5 py-2.5 bg-violet-600 hover:bg-violet-700 rounded-xl text-white font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

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
