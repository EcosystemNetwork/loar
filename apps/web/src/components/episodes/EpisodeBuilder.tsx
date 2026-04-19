/**
 * Episode Builder
 *
 * Lets users arrange selected timeline nodes (video + audio) into an
 * ordered episode, preview the sequence, and export as a single MP4.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  X,
  GripVertical,
  Play,
  Pause,
  Download,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Film,
  Loader2,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Music,
  Volume2,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { Node } from 'reactflow';
import type { TimelineNodeData } from '@/components/flow/TimelineNodes';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

export interface EpisodeClip {
  nodeId: string;
  label: string;
  videoUrl: string;
  audioUrl?: string;
  trimStart: number;
  trimEnd: number;
}

interface EpisodeBuildProps {
  universeId: string;
  /** All nodes on the canvas (to pick from) */
  nodes: Node<TimelineNodeData>[];
  /** Pre-selected node IDs (from multi-select) */
  initialNodeIds?: string[];
  onClose: () => void;
}

export function EpisodeBuilder({ universeId, nodes, initialNodeIds, onClose }: EpisodeBuildProps) {
  const [title, setTitle] = useState('');
  const [clips, setClips] = useState<EpisodeClip[]>(() => {
    if (!initialNodeIds?.length) return [];
    return initialNodeIds
      .map((id) => {
        const node = nodes.find((n) => n.id === id);
        if (!node?.data?.videoUrl) return null;
        return {
          nodeId: node.data.eventId || id,
          label: node.data.label || node.data.description || `Node ${id}`,
          videoUrl: node.data.videoUrl,
          audioUrl: undefined,
          trimStart: 0,
          trimEnd: 0,
        };
      })
      .filter(Boolean) as EpisodeClip[];
  });

  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showNodePicker, setShowNodePicker] = useState(false);
  const [savedEpisodeId, setSavedEpisodeId] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);

  // Available nodes that have video and aren't already in the episode
  const availableNodes = nodes.filter(
    (n) =>
      n.data?.videoUrl &&
      n.data?.nodeType !== 'add' &&
      !clips.some((c) => c.nodeId === (n.data.eventId || n.id))
  );

  // Total estimated duration
  const totalDuration = clips.length * 10; // ~10s per clip

  // ── Mutations ─────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (savedEpisodeId) {
        await trpcClient.episodes.update.mutate({
          episodeId: savedEpisodeId,
          title: title || 'Untitled Episode',
          clips,
        });
        return savedEpisodeId;
      }
      const result = await trpcClient.episodes.create.mutate({
        universeId,
        title: title || 'Untitled Episode',
        clips,
      });
      return result.id;
    },
    onSuccess: (id) => {
      setSavedEpisodeId(id);
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      // Save first if needed
      let epId = savedEpisodeId;
      if (!epId) {
        const result = await trpcClient.episodes.create.mutate({
          universeId,
          title: title || 'Untitled Episode',
          clips,
        });
        epId = result.id;
        setSavedEpisodeId(epId);
      } else {
        await trpcClient.episodes.update.mutate({
          episodeId: epId,
          title: title || 'Untitled Episode',
          clips,
        });
      }

      const { jobId } = await trpcClient.episodes.export.mutate({ episodeId: epId });
      return jobId;
    },
    onSuccess: (jobId) => {
      setExportJobId(jobId);
    },
  });

  // Poll export status
  const { data: exportStatus } = useQuery({
    queryKey: ['episodeExport', exportJobId],
    queryFn: () => trpcClient.episodes.exportStatus.query({ jobId: exportJobId! }),
    enabled: !!exportJobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === 'completed' || status === 'failed') return false;
      return 2000;
    },
  });

  // ── Clip management ───────────────────────────────────────────────────

  const addClip = useCallback((node: Node<TimelineNodeData>) => {
    setClips((prev) => [
      ...prev,
      {
        nodeId: node.data.eventId || node.id,
        label: node.data.label || node.data.description || `Node ${node.id}`,
        videoUrl: node.data.videoUrl!,
        trimStart: 0,
        trimEnd: 0,
      },
    ]);
    setShowNodePicker(false);
  }, []);

  const removeClip = useCallback((index: number) => {
    setClips((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveClip = useCallback((from: number, to: number) => {
    setClips((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(from, 1);
      updated.splice(to, 0, moved);
      return updated;
    });
  }, []);

  // Drag & drop reorder
  const handleDragStart = (index: number) => {
    dragItem.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverItem.current = index;
  };

  const handleDragEnd = () => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      moveClip(dragItem.current, dragOverItem.current);
    }
    dragItem.current = null;
    dragOverItem.current = null;
  };

  // Preview
  const handlePreview = useCallback(
    (index: number) => {
      if (previewIndex === index && isPlaying) {
        videoRef.current?.pause();
        setIsPlaying(false);
      } else {
        setPreviewIndex(index);
        setIsPlaying(true);
      }
    },
    [previewIndex, isPlaying]
  );

  useEffect(() => {
    if (previewIndex !== null && videoRef.current) {
      videoRef.current.load();
      if (isPlaying) videoRef.current.play();
    }
  }, [previewIndex, isPlaying]);

  // Auto-advance preview
  const handleVideoEnded = useCallback(() => {
    if (previewIndex !== null && previewIndex < clips.length - 1) {
      setPreviewIndex(previewIndex + 1);
    } else {
      setIsPlaying(false);
    }
  }, [previewIndex, clips.length]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-background border border-border rounded-xl w-[900px] max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <Film className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Episode Builder</h2>
            <Badge variant="outline" className="text-xs">
              {clips.length} clips ~ {Math.round(totalDuration)}s
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Title input */}
        <div className="px-5 py-3 border-b border-border">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Episode title..."
            className="text-base"
          />
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Clip list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {clips.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                <Film className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">No clips yet. Add nodes from your timeline.</p>
              </div>
            ) : (
              clips.map((clip, i) => (
                <div
                  key={`${clip.nodeId}-${i}`}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragEnter={() => handleDragEnter(i)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => e.preventDefault()}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors cursor-move ${
                    previewIndex === i
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-muted-foreground/30 bg-card'
                  }`}
                >
                  {/* Drag handle */}
                  <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />

                  {/* Index */}
                  <span className="text-xs text-muted-foreground w-6 text-center font-mono">
                    {i + 1}
                  </span>

                  {/* Thumbnail */}
                  <div className="w-16 h-9 bg-muted rounded overflow-hidden flex-shrink-0">
                    <video
                      src={resolveIpfsUrl(clip.videoUrl)}
                      className="w-full h-full object-cover"
                      muted
                      preload="metadata"
                    />
                  </div>

                  {/* Label */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{clip.label}</p>
                    <div className="flex items-center gap-2">
                      {clip.audioUrl && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Music className="w-3 h-3" /> Audio
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handlePreview(i)}
                    >
                      {previewIndex === i && isPlaying ? (
                        <Pause className="w-3 h-3" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={i === 0}
                      onClick={() => moveClip(i, i - 1)}
                    >
                      <ArrowUp className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={i === clips.length - 1}
                      onClick={() => moveClip(i, i + 1)}
                    >
                      <ArrowDown className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive"
                      onClick={() => removeClip(i)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}

            {/* Add clip button */}
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2"
              onClick={() => setShowNodePicker(!showNodePicker)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Clip
              {showNodePicker ? (
                <ChevronUp className="w-4 h-4 ml-2" />
              ) : (
                <ChevronDown className="w-4 h-4 ml-2" />
              )}
            </Button>

            {/* Node picker */}
            {showNodePicker && (
              <div className="border border-border rounded-lg p-2 mt-1 max-h-48 overflow-y-auto space-y-1 bg-muted/30">
                {availableNodes.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-2">
                    All video nodes are already in the episode
                  </p>
                ) : (
                  availableNodes.map((node) => (
                    <button
                      key={node.id}
                      onClick={() => addClip(node)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-left transition-colors"
                    >
                      <div className="w-12 h-7 bg-muted rounded overflow-hidden flex-shrink-0">
                        <video
                          src={resolveIpfsUrl(node.data.videoUrl)}
                          className="w-full h-full object-cover"
                          muted
                          preload="metadata"
                        />
                      </div>
                      <span className="text-sm truncate">
                        {node.data.label || node.data.description || `Node ${node.id}`}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Preview panel */}
          <div className="w-[340px] border-l border-border flex flex-col">
            <div className="p-3 border-b border-border">
              <p className="text-xs text-muted-foreground font-medium">Preview</p>
            </div>
            <div className="flex-1 flex items-center justify-center bg-black">
              {previewIndex !== null && clips[previewIndex] ? (
                <video
                  ref={videoRef}
                  src={resolveIpfsUrl(clips[previewIndex].videoUrl)}
                  className="w-full aspect-video"
                  onEnded={handleVideoEnded}
                  playsInline
                />
              ) : (
                <p className="text-sm text-muted-foreground">Click play on a clip</p>
              )}
            </div>

            {/* Export status */}
            {exportJobId && exportStatus && (
              <div className="p-3 border-t border-border">
                <div className="flex items-center gap-2 mb-2">
                  {exportStatus.status === 'completed' ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : exportStatus.status === 'failed' ? (
                    <AlertCircle className="w-4 h-4 text-red-500" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  <span className="text-sm capitalize">{exportStatus.status}</span>
                </div>

                {exportStatus.status !== 'completed' && exportStatus.status !== 'failed' && (
                  <div className="w-full bg-muted rounded-full h-2 mb-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${exportStatus.progress}%` }}
                    />
                  </div>
                )}

                {exportStatus.status === 'completed' && exportStatus.outputUrl && (
                  <a
                    href={exportStatus.outputUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Download className="w-4 h-4" />
                    Download Episode
                  </a>
                )}

                {exportStatus.status === 'failed' && exportStatus.error && (
                  <p className="text-xs text-destructive">{exportStatus.error}</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={clips.length === 0 || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : savedEpisodeId ? (
                <Check className="w-4 h-4 mr-2" />
              ) : null}
              {savedEpisodeId ? 'Saved' : 'Save'}
            </Button>
            <Button
              size="sm"
              disabled={
                clips.length === 0 ||
                exportMutation.isPending ||
                (exportStatus?.status !== undefined &&
                  exportStatus.status !== 'completed' &&
                  exportStatus.status !== 'failed')
              }
              onClick={() => exportMutation.mutate()}
            >
              {exportMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Export MP4 ({EXPORT_BASE_CREDITS + clips.length} credits)
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const EXPORT_BASE_CREDITS = 5;
