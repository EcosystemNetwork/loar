/**
 * EpisodeClipTimeline — the Episode Studio clip list.
 *
 * Modeled on `components/segments/VideoTimeline.tsx`'s interaction pattern
 * (native HTML5 drag-and-drop reorder, inline `VideoTrimmer` launch) but
 * built for `EpisodeClip` (server's `episodes.routes.ts` clip shape, trims
 * in seconds) instead of `VideoSegment` (ms-based, single-event scoped),
 * and extended with the two things Episode Studio needs that the segment
 * timeline doesn't: multi-select (for "merge selected clips") and a
 * per-clip download button.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { GripVertical, Trash2, Scissors, Download, Music } from 'lucide-react';
import { VideoTrimmer } from '@/components/segments/VideoTrimmer';
import type { VideoSegment } from '@/types/segments';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import { cn } from '@/lib/utils';

export interface EpisodeClip {
  nodeId: string;
  label: string;
  videoUrl: string;
  audioUrl?: string;
  trimStart: number;
  trimEnd: number;
}

interface EpisodeClipTimelineProps {
  clips: EpisodeClip[];
  selectedIds: Set<string>;
  onReorder: (clips: EpisodeClip[]) => void;
  onRemove: (nodeId: string) => void;
  onTrimChange: (nodeId: string, trimStart: number, trimEnd: number) => void;
  onToggleSelect: (nodeId: string) => void;
  onDownload: (clip: EpisodeClip) => void;
}

// VideoTrimmer works entirely off duration/startTrim/endTrim/videoUrl/id —
// the rest of VideoSegment is unused by it, so a lightweight stand-in
// keeps trims in seconds (server truth) at the boundary, only converting
// to/from ms for the trimmer itself.
function clipToTrimmerSegment(clip: EpisodeClip): VideoSegment {
  return {
    id: clip.nodeId,
    videoUrl: clip.videoUrl,
    description: clip.label,
    prompt: '',
    duration: clip.trimEnd > 0 ? clip.trimEnd : 30,
    order: 0,
    startTrim: clip.trimStart > 0 ? clip.trimStart * 1000 : undefined,
    endTrim: clip.trimEnd > 0 ? clip.trimEnd * 1000 : undefined,
    model: 'fal-veo3',
    generatedAt: Date.now(),
    aspectRatio: '16:9',
    generationMode: 'text-to-video',
  };
}

export function EpisodeClipTimeline({
  clips,
  selectedIds,
  onReorder,
  onRemove,
  onTrimChange,
  onToggleSelect,
  onDownload,
}: EpisodeClipTimelineProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [trimmingId, setTrimmingId] = useState<string | null>(null);

  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    const draggedIndex = clips.findIndex((c) => c.nodeId === draggedId);
    const targetIndex = clips.findIndex((c) => c.nodeId === targetId);
    if (draggedIndex === -1 || targetIndex === -1) return;

    const next = [...clips];
    const [removed] = next.splice(draggedIndex, 1);
    next.splice(targetIndex, 0, removed);
    onReorder(next);
    setDraggedId(null);
    setHoveredId(null);
  };

  if (clips.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No clips yet. Add one from your library, an upload, or a URL below.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {clips.map((clip, index) => {
        const isTrimmed = clip.trimStart > 0 || clip.trimEnd > 0;
        const isSelected = selectedIds.has(clip.nodeId);
        return (
          <div key={clip.nodeId}>
            <div
              draggable
              onDragStart={() => setDraggedId(clip.nodeId)}
              onDragOver={(e) => {
                e.preventDefault();
                if (draggedId && draggedId !== clip.nodeId) setHoveredId(clip.nodeId);
              }}
              onDrop={(e) => {
                e.preventDefault();
                handleDrop(clip.nodeId);
              }}
              className={cn(
                'flex items-center gap-2 rounded-lg border bg-card p-2 transition-all',
                isSelected ? 'border-primary/60 bg-primary/5' : 'border-border',
                draggedId === clip.nodeId && 'opacity-40',
                hoveredId === clip.nodeId && 'ring-2 ring-primary/40'
              )}
            >
              <GripVertical className="h-4 w-4 flex-shrink-0 cursor-move text-muted-foreground" />
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => onToggleSelect(clip.nodeId)}
                aria-label={`Select ${clip.label || `clip ${index + 1}`}`}
              />
              <div className="relative aspect-video w-20 flex-shrink-0 overflow-hidden rounded bg-muted">
                <video
                  src={resolveIpfsUrl(clip.videoUrl)}
                  muted
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{clip.label || `Clip ${index + 1}`}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[9px]">
                    #{index + 1}
                  </Badge>
                  {isTrimmed && (
                    <Badge variant="outline" className="gap-1 text-[9px]">
                      <Scissors className="h-2.5 w-2.5" />
                      {clip.trimStart}s–{clip.trimEnd > 0 ? `${clip.trimEnd}s` : 'end'}
                    </Badge>
                  )}
                  {clip.audioUrl && (
                    <Badge variant="outline" className="gap-1 text-[9px]">
                      <Music className="h-2.5 w-2.5" />
                      audio
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setTrimmingId(trimmingId === clip.nodeId ? null : clip.nodeId)}
                  title="Trim"
                >
                  <Scissors className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => onDownload(clip)}
                  title="Download"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  onClick={() => onRemove(clip.nodeId)}
                  title="Remove from episode"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {trimmingId === clip.nodeId && (
              <div className="mt-1.5">
                <VideoTrimmer
                  segment={clipToTrimmerSegment(clip)}
                  onTrimChange={(_id, startMs, endMs) => {
                    onTrimChange(clip.nodeId, startMs / 1000, endMs / 1000);
                  }}
                  onClose={() => setTrimmingId(null)}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
