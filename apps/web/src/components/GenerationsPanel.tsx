/**
 * Generations Panel
 *
 * Slideout panel showing all video generations for a universe.
 * Each generation card is draggable — drop onto the timeline to
 * pre-fill the creation dialog and save as a timeline event.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, Film, GripVertical, Play, Clock, Sparkles, ExternalLink, Loader2 } from 'lucide-react';

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

export function GenerationsPanel({
  universeId,
  isOpen,
  onClose,
  onSelectGeneration,
}: GenerationsPanelProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Fetch all generations for this universe
  const { data: generations, isLoading } = useQuery({
    queryKey: ['universe-generations', universeId],
    queryFn: () =>
      trpcClient.generation.history.query({
        universeId,
        limit: 50,
      }),
    enabled: isOpen && !!universeId,
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

  const videoMedia = (mediaAttachments || []).filter((m: any) => m.category === 'video' && m.url);

  // Merge: prefer generations (have more metadata), add any media-only videos
  const generationIds = new Set(videoGenerations.map((g: any) => g.id));
  const extraMedia = videoMedia.filter(
    (m: any) => !m.generationId || !generationIds.has(m.generationId)
  );

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

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-background border-l border-border shadow-xl z-50 flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-purple-500" />
          <h2 className="font-semibold text-sm">Generations</h2>
          {videoGenerations.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {videoGenerations.length + extraMedia.length}
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
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
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && videoGenerations.length === 0 && extraMedia.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Film className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No generations yet</p>
            <p className="text-xs mt-1">Create your first video from the timeline</p>
          </div>
        )}

        {/* Generation cards */}
        {videoGenerations.map((gen: any) => (
          <div
            key={gen.id}
            draggable
            onDragStart={(e) => handleDragStart(e, gen)}
            className="group relative rounded-lg border border-border bg-card hover:border-purple-400 hover:shadow-md transition-all duration-200 cursor-grab active:cursor-grabbing"
          >
            {/* Drag handle */}
            <div className="absolute left-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-60 transition-opacity">
              <GripVertical className="h-4 w-4 text-muted-foreground" />
            </div>

            {/* Video preview */}
            <div className="relative aspect-video bg-black rounded-t-lg overflow-hidden">
              {playingId === gen.id ? (
                <video
                  src={gen.permanentVideoUrl || gen.videoUrl}
                  className="w-full h-full object-cover"
                  autoPlay
                  muted
                  loop
                  onEnded={() => setPlayingId(null)}
                />
              ) : (
                <div
                  className="w-full h-full flex items-center justify-center bg-gradient-to-br from-purple-950/80 to-slate-950 cursor-pointer"
                  onClick={() => setPlayingId(gen.id)}
                >
                  <Play className="h-8 w-8 text-white/70 hover:text-white transition-colors" />
                </div>
              )}

              {/* Model badge */}
              <Badge
                variant="secondary"
                className="absolute top-1.5 right-1.5 text-[10px] bg-black/60 text-white border-0"
              >
                {modelDisplayNames[gen.finalModelId] || gen.finalModelId || 'AI'}
              </Badge>

              {/* Duration badge */}
              {gen.durationSec && (
                <Badge
                  variant="secondary"
                  className="absolute bottom-1.5 right-1.5 text-[10px] bg-black/60 text-white border-0"
                >
                  {gen.durationSec}s
                </Badge>
              )}

              {/* Persisted indicator */}
              {gen.storagePersisted && (
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
                {gen.prompt?.slice(0, 100) || 'Untitled generation'}
                {gen.prompt?.length > 100 ? '...' : ''}
              </p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDate(gen.createdAt)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950/30"
                  onClick={() => handleClickAdd(gen)}
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  Add to Timeline
                </Button>
              </div>
            </div>
          </div>
        ))}

        {/* Extra media (not from tracked generations) */}
        {extraMedia.map((media: any) => (
          <div
            key={media.id}
            draggable
            onDragStart={(e) => handleDragStart(e, media)}
            className="group relative rounded-lg border border-border bg-card hover:border-purple-400 hover:shadow-md transition-all duration-200 cursor-grab active:cursor-grabbing"
          >
            <div className="relative aspect-video bg-black rounded-t-lg overflow-hidden">
              <div
                className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-950/80 to-slate-900 cursor-pointer"
                onClick={() => setPlayingId(media.id)}
              >
                {playingId === media.id ? (
                  <video
                    src={media.url}
                    className="w-full h-full object-cover"
                    autoPlay
                    muted
                    loop
                  />
                ) : (
                  <Play className="h-8 w-8 text-white/70 hover:text-white transition-colors" />
                )}
              </div>
            </div>
            <div className="p-2.5">
              <p className="text-xs text-foreground line-clamp-2">
                {media.label || 'Video attachment'}
              </p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-muted-foreground">
                  {formatDate(media.createdAt)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-purple-600 hover:text-purple-700"
                  onClick={() => handleClickAdd(media)}
                >
                  <Sparkles className="h-3 w-3 mr-1" />
                  Add to Timeline
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
