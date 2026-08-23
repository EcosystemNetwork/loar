/**
 * Generations Panel
 *
 * Slideout panel showing all video generations for a universe.
 * Each generation card is draggable — drop onto the timeline to
 * pre-fill the creation dialog and save as a timeline event.
 */

import { useState, memo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  X,
  Film,
  GripVertical,
  Play,
  Clock,
  Sparkles,
  Loader2,
  XCircle,
  ListChecks,
} from 'lucide-react';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

/** How many generations to load per page */
const PAGE_SIZE = 20;

/** Statuses that mean "still working" — everything else is terminal. */
const IN_PROGRESS_STATUSES = new Set(['queued', 'running', 'pending', 'processing']);

/** Poll cadence for the review queue while the panel is open. */
const QUEUE_POLL_MS = 4000;

interface GenerationsPanelProps {
  universeId: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectGeneration: (generation: {
    videoUrl: string;
    title: string;
    description: string;
    generationId: string;
    model: string;
  }) => void;
}

function GenerationsPanelImpl({
  universeId,
  isOpen,
  onClose,
  onSelectGeneration,
}: GenerationsPanelProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const queryClient = useQueryClient();

  // Fetch all generations for this universe. Polls while open so the review
  // queue (in-progress jobs) below reflects status changes without a manual
  // refresh — see IN_PROGRESS_STATUSES / QUEUE_POLL_MS.
  const { data: generations, isLoading } = useQuery({
    queryKey: ['universe-generations', universeId],
    queryFn: () =>
      trpcClient.generation.history.query({
        universeId,
        limit: 50,
      }),
    enabled: isOpen && !!universeId,
    refetchInterval: isOpen ? QUEUE_POLL_MS : false,
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => trpcClient.generation.cancel.mutate({ jobId }),
    onSuccess: () => {
      toast.success('Generation cancelled');
      queryClient.invalidateQueries({ queryKey: ['universe-generations', universeId] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to cancel generation'),
  });

  // Also fetch media attachments for this universe
  const { data: mediaAttachments } = useQuery({
    queryKey: ['universe-media', universeId],
    queryFn: () =>
      trpcClient.media.listByTarget.query({
        targetType: 'universe',
        targetId: universeId,
      }),
    enabled: isOpen && !!universeId,
  });

  if (!isOpen) return null;

  const videoGenerations = (generations || []).filter(
    (g: any) => g.status === 'completed' && (g.videoUrl || g.permanentVideoUrl)
  );

  // Review queue — tasks currently in motion, so the owner can see what's
  // running and cancel it without leaving the canvas.
  const inProgressItems = (generations || []).filter((g: any) =>
    IN_PROGRESS_STATUSES.has(g.status)
  );

  const videoMedia = (mediaAttachments || []).filter((m: any) => m.category === 'video' && m.url);

  // Merge: prefer generations (have more metadata), add any media-only videos
  const generationIds = new Set(videoGenerations.map((g: any) => g.id));
  const extraMedia = videoMedia.filter(
    (m: any) => !m.generationId || !generationIds.has(m.generationId)
  );

  const allItems = [...videoGenerations, ...extraMedia];
  const visibleItems = allItems.slice(0, visibleCount);
  const hasMore = visibleCount < allItems.length;

  const handleDragStart = (e: React.DragEvent, gen: any) => {
    const data = {
      videoUrl: gen.permanentVideoUrl || gen.videoUrl || gen.url,
      title: (gen.prompt || gen.label || '').slice(0, 60),
      description: gen.prompt || gen.label || '',
      generationId: gen.id,
      model: gen.finalModelId || gen.provider || 'unknown',
    };
    e.dataTransfer.setData('application/json', JSON.stringify(data));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleClickAdd = (gen: any) => {
    onSelectGeneration({
      videoUrl: gen.permanentVideoUrl || gen.videoUrl || gen.url,
      title: (gen.prompt || gen.label || '').slice(0, 60),
      description: gen.prompt || gen.label || '',
      generationId: gen.id,
      model: gen.finalModelId || gen.provider || 'unknown',
    });
  };

  const formatDate = (date: any) => {
    if (!date) return '';
    const d = date._seconds ? new Date(date._seconds * 1000) : new Date(date);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const modelDisplayNames: Record<string, string> = {
    'seedance2-t2v': 'Seedance 2.0',
    'seedance2-i2v': 'Seedance 2.0',
    'seedance2-fast-t2v': 'Seedance Fast',
    'seedance2-fast-i2v': 'Seedance Fast',
    'seedance2-ref': 'Seedance Ref',
    'veo31-t2v': 'Veo 3.1',
    'veo31-i2v': 'Veo 3.1',
    'sora2-t2v': 'Sora 2',
    'sora2-i2v': 'Sora 2',
  };

  const isGeneration = (item: any) => 'prompt' in item;

  const formatElapsed = (date: any) => {
    if (!date) return '';
    const started = date._seconds ? date._seconds * 1000 : new Date(date).getTime();
    if (Number.isNaN(started)) return '';
    const secs = Math.max(0, Math.floor((Date.now() - started) / 1000));
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ${secs % 60}s`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-background border-l border-border shadow-xl z-[55] flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-purple-500" />
          <h2 className="font-semibold text-sm">Generations</h2>
          {allItems.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {allItems.length}
            </Badge>
          )}
          {inProgressItems.length > 0 && (
            <Badge className="text-xs bg-amber-500/90 hover:bg-amber-600 text-white border-0 flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              {inProgressItems.length} running
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          aria-label="Close generations panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Instructions */}
      <div className="px-4 py-2 bg-muted/50 border-b border-border">
        <p className="text-xs text-muted-foreground">
          Drag a video onto the timeline or click to add as an event.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Review queue — tasks in motion */}
        {inProgressItems.length > 0 && (
          <div className="mb-3 pb-3 border-b border-border space-y-2">
            <div className="flex items-center gap-1.5 px-0.5">
              <ListChecks className="h-3.5 w-3.5 text-amber-500" />
              <h3 className="text-xs font-medium text-foreground">In progress</h3>
            </div>
            {inProgressItems.map((item: any) => (
              <div
                key={item.id}
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1.5"
              >
                <div className="flex items-start gap-2">
                  <Loader2 className="h-3.5 w-3.5 text-amber-500 animate-spin mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-foreground line-clamp-2 flex-1">
                    {(item.prompt || item.label || 'Generating…').slice(0, 100)}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize">
                      {item.status}
                    </Badge>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {formatElapsed(item.createdAt)}
                    </span>
                    {modelDisplayNames[item.finalModelId] && (
                      <span>{modelDisplayNames[item.finalModelId]}</span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    disabled={cancelMutation.isPending}
                    onClick={() => cancelMutation.mutate(item.id)}
                  >
                    <XCircle className="h-3 w-3 mr-1" />
                    Cancel
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && allItems.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Film className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No generations yet</p>
            <p className="text-xs mt-1">Create your first video from the timeline</p>
          </div>
        )}

        {/* Generation / media cards */}
        {visibleItems.map((item: any) => (
          <div
            key={item.id}
            draggable
            onDragStart={(e) => handleDragStart(e, item)}
            className="group relative rounded-lg border border-border bg-card hover:border-purple-400 hover:shadow-md transition-all duration-200 cursor-grab active:cursor-grabbing"
          >
            {/* Drag handle */}
            <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 transition-opacity">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>

            {/* Video preview */}
            <div className="relative aspect-video bg-black rounded-t-lg overflow-hidden">
              {playingId === item.id ? (
                <video
                  src={resolveIpfsUrl(item.permanentVideoUrl || item.videoUrl || item.url)}
                  className="w-full h-full object-cover"
                  autoPlay
                  muted
                  loop
                  onEnded={() => setPlayingId(null)}
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-950/80 to-slate-950 cursor-pointer"
                  onClick={() => setPlayingId(item.id)}
                >
                  <Play className="h-8 w-8 text-white/70 hover:text-white transition-colors" />
                </div>
              )}

              {/* Model badge */}
              {isGeneration(item) && (
                <Badge
                  variant="secondary"
                  className="absolute top-1.5 right-1.5 text-[10px] bg-black/60 text-white border-0"
                >
                  {modelDisplayNames[item.finalModelId] || item.finalModelId || 'AI'}
                </Badge>
              )}

              {/* Duration badge */}
              {item.durationSec && (
                <Badge
                  variant="secondary"
                  className="absolute bottom-1.5 right-1.5 text-[10px] bg-black/60 text-white border-0"
                >
                  {item.durationSec}s
                </Badge>
              )}

              {/* Persisted indicator */}
              {item.storagePersisted && (
                <Badge
                  variant="secondary"
                  className="absolute bottom-1.5 left-1.5 text-[10px] bg-green-600/80 text-white border-0"
                >
                  IPFS
                </Badge>
              )}
            </div>

            {/* Info */}
            <div className="p-2.5">
              <p className="text-xs text-foreground line-clamp-2 leading-relaxed">
                {((item.prompt || item.label || 'Untitled generation') as string).slice(0, 100)}
                {(item.prompt || item.label || '').length > 100 ? '...' : ''}
              </p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDate(item.createdAt)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                  onClick={() => handleClickAdd(item)}
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  Add to Timeline
                </Button>
              </div>
            </div>
          </div>
        ))}

        {/* Load more button */}
        {hasMore && (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          >
            Show more ({allItems.length - visibleCount} remaining)
          </Button>
        )}
      </div>
    </div>
  );
}

export const GenerationsPanel = memo(GenerationsPanelImpl);
