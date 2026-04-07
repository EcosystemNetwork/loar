/**
 * MediaGallery — displays all media attached to a universe or entity.
 * Groups files by category: images, video, music, sound, environments, 3D, docs, design.
 */
import { useMediaAttachments, useDetachMedia } from '@/hooks/useMediaAttachments';
import type { MediaAttachment, MediaCategory, AttachmentTargetType } from '@/hooks/useMediaAttachments';
import { Button } from '@/components/ui/button';
import { ExternalLink, X, Music, Volume2, FileText, Layers, Video, File } from 'lucide-react';

const CATEGORY_ICONS: Record<MediaCategory, React.ReactNode> = {
  image: <span className="text-base leading-none">🖼</span>,
  video: <Video className="w-3.5 h-3.5" />,
  music: <Music className="w-3.5 h-3.5" />,
  sound: <Volume2 className="w-3.5 h-3.5" />,
  environment: <Volume2 className="w-3.5 h-3.5" />,
  '3d': <Layers className="w-3.5 h-3.5" />,
  document: <FileText className="w-3.5 h-3.5" />,
  design: <Layers className="w-3.5 h-3.5" />,
  other: <File className="w-3.5 h-3.5" />,
};

const CATEGORY_LABELS: Record<MediaCategory, string> = {
  image: 'Images',
  video: 'Video',
  music: 'Music',
  sound: 'Sound Effects',
  environment: 'Environments',
  '3d': '3D Models',
  document: 'Documents',
  design: 'Design Files',
  other: 'Other',
};

const CATEGORY_ORDER: MediaCategory[] = [
  'image',
  'video',
  'music',
  'sound',
  'environment',
  '3d',
  'document',
  'design',
  'other',
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface MediaGalleryProps {
  targetType: AttachmentTargetType;
  targetId: string;
  isOwner?: boolean;
}

export function MediaGallery({ targetType, targetId, isOwner }: MediaGalleryProps) {
  const { data: attachments = [], isLoading } = useMediaAttachments(targetType, targetId);
  const detach = useDetachMedia();

  if (isLoading || attachments.length === 0) return null;

  const byCategory = CATEGORY_ORDER.reduce(
    (acc, cat) => {
      const items = (attachments as MediaAttachment[]).filter((a) => a.category === cat);
      if (items.length > 0) acc[cat] = items;
      return acc;
    },
    {} as Partial<Record<MediaCategory, MediaAttachment[]>>
  );

  if (Object.keys(byCategory).length === 0) return null;

  return (
    <div className="space-y-4">
      {Object.entries(byCategory).map(([cat, items]) => (
        <div key={cat}>
          <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
            {CATEGORY_ICONS[cat as MediaCategory]}
            <span className="text-xs font-semibold uppercase tracking-wider">
              {CATEGORY_LABELS[cat as MediaCategory]}
            </span>
          </div>
          <div className="space-y-1.5">
            {items!.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border bg-card text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">
                    {item.label && item.label !== item.originalFilename
                      ? item.label
                      : item.originalFilename}
                  </p>
                  {item.label && item.label !== item.originalFilename && (
                    <p className="text-xs text-muted-foreground truncate">{item.originalFilename}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{formatBytes(item.size)}</p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <a href={item.url} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="icon" className="h-7 w-7">
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                  </a>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      disabled={detach.isPending}
                      onClick={() => detach.mutate({ id: item.id, targetType, targetId })}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
