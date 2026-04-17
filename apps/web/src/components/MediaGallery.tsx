/**
 * MediaGallery — displays all media attached to a universe or entity.
 * Groups files by category with support for variants, versioning, and ordering.
 *
 * Categories: images, video, music, sound, environments, 3D models, textures,
 * animations, rigs, docs, design.
 *
 * Rich previews:
 *   - Images render inline as thumbnails
 *   - 3D models (GLB) render in an interactive <model-viewer>
 *   - Audio/music get inline playback
 */
import { useState } from 'react';
import {
  useMediaAttachments,
  useDetachMedia,
  groupByCategory,
  groupByVariant,
} from '@/hooks/useMediaAttachments';
import type {
  MediaAttachment,
  MediaCategory,
  AttachmentTargetType,
} from '@/hooks/useMediaAttachments';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ModelViewer } from '@/components/ModelViewer';
import {
  ExternalLink,
  X,
  Music,
  Volume2,
  FileText,
  Layers,
  Video,
  File,
  ChevronDown,
  ChevronRight,
  Paintbrush,
  Clapperboard,
  Bone,
  Image as ImageIcon,
} from 'lucide-react';
import { LoarIcon } from '@/components/loar-icons';

const CATEGORY_ICONS: Record<MediaCategory, React.ReactNode> = {
  image: <LoarIcon name="gallery" size={14} />,
  video: <Video className="w-3.5 h-3.5" />,
  music: <Music className="w-3.5 h-3.5" />,
  sound: <Volume2 className="w-3.5 h-3.5" />,
  environment: <Volume2 className="w-3.5 h-3.5" />,
  '3d': <Layers className="w-3.5 h-3.5" />,
  texture: <Paintbrush className="w-3.5 h-3.5" />,
  animation: <Clapperboard className="w-3.5 h-3.5" />,
  rig: <Bone className="w-3.5 h-3.5" />,
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
  texture: 'Textures',
  animation: 'Animations',
  rig: 'Rigs / Skeletons',
  document: 'Documents',
  design: 'Design Files',
  other: 'Other',
};

const CATEGORY_ORDER: MediaCategory[] = [
  'image',
  '3d',
  'texture',
  'animation',
  'rig',
  'video',
  'music',
  'sound',
  'environment',
  'document',
  'design',
  'other',
];

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentRowProps {
  item: MediaAttachment;
  variants: MediaAttachment[];
  isOwner: boolean;
  targetType: AttachmentTargetType;
  targetId: string;
  onDetach: (id: string) => void;
  detaching: boolean;
}

/** Check if an attachment is a displayable image */
function isImage(item: MediaAttachment): boolean {
  return item.category === 'image' || item.mimeType?.startsWith('image/');
}

/** Check if an attachment is a GLB/GLTF 3D model */
function isGlb(item: MediaAttachment): boolean {
  return (
    item.mimeType === 'model/gltf-binary' ||
    item.originalFilename?.endsWith('.glb') ||
    item.originalFilename?.endsWith('.gltf') ||
    false
  );
}

/** Find the best GLB model from a list of 3D attachments (prefer textured) */
function findBestGlb(items: MediaAttachment[]): MediaAttachment | null {
  // Prefer textured model, then game_ready, then any GLB
  const glbs = items.filter(isGlb);
  return (
    glbs.find((g) => g.label?.toLowerCase().includes('textured')) ||
    glbs.find((g) => g.subCategory === 'game_ready') ||
    glbs[0] ||
    null
  );
}

/** Find a thumbnail among sibling attachments (for 3D model poster) */
function findThumbnail(items: MediaAttachment[], generationId: string | null): string | undefined {
  if (!generationId) return undefined;
  const thumb = items.find(
    (a) =>
      a.generationId === generationId &&
      isImage(a) &&
      (a.label?.toLowerCase().includes('thumbnail') || a.subCategory === 'concept_art')
  );
  return thumb?.url;
}

function AttachmentRow({ item, variants, isOwner, onDetach, detaching }: AttachmentRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasVariants = variants.length > 0;

  const displayName =
    item.label && item.label !== item.originalFilename ? item.label : item.originalFilename;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-md border bg-card text-sm">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Inline image thumbnail */}
          {isImage(item) && item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="shrink-0">
              <img
                src={item.url}
                alt={displayName}
                className="w-12 h-12 rounded object-cover border"
              />
            </a>
          )}
          {hasVariants && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-medium truncate">{displayName}</p>
              {item.version > 1 && (
                <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                  v{item.version}
                </Badge>
              )}
              {item.variantLabel && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                  {item.variantLabel}
                </Badge>
              )}
              {item.subCategory && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1 py-0 shrink-0 text-muted-foreground"
                >
                  {item.subCategory}
                </Badge>
              )}
            </div>
            {item.label && item.label !== item.originalFilename && (
              <p className="text-xs text-muted-foreground truncate">{item.originalFilename}</p>
            )}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {formatBytes(item.size) && <span>{formatBytes(item.size)}</span>}
              {hasVariants && (
                <span>
                  {variants.length} variant{variants.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
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
              disabled={detaching}
              onClick={() => onDetach(item.id)}
            >
              <X className="w-3 h-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Expanded variant list */}
      {expanded && variants.length > 0 && (
        <div className="ml-6 mt-1 space-y-1">
          {variants.map((v) => (
            <div
              key={v.id}
              className="flex items-center justify-between gap-3 px-3 py-1.5 rounded-md border border-dashed bg-muted/30 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                {isImage(v) && v.url && (
                  <a href={v.url} target="_blank" rel="noreferrer" className="shrink-0">
                    <img
                      src={v.url}
                      alt={v.label || v.originalFilename}
                      className="w-8 h-8 rounded object-cover border"
                    />
                  </a>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium truncate">
                      {v.variantLabel ?? v.label ?? v.originalFilename}
                    </p>
                    {v.version > 1 && (
                      <Badge variant="outline" className="text-[10px] px-1 py-0">
                        v{v.version}
                      </Badge>
                    )}
                    {v.subCategory && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1 py-0 text-muted-foreground"
                      >
                        {v.subCategory}
                      </Badge>
                    )}
                  </div>
                  {formatBytes(v.size) && (
                    <p className="text-xs text-muted-foreground">{formatBytes(v.size)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <a href={v.url} target="_blank" rel="noreferrer">
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <ExternalLink className="w-2.5 h-2.5" />
                  </Button>
                </a>
                {isOwner && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive hover:text-destructive"
                    disabled={detaching}
                    onClick={() => onDetach(v.id)}
                  >
                    <X className="w-2.5 h-2.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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

  const byCategory = groupByCategory(attachments as MediaAttachment[]);

  if (Object.keys(byCategory).length === 0) return null;

  // Find best GLB for the hero 3D viewer
  const all3d = byCategory['3d'] || [];
  const heroGlb = findBestGlb(all3d);
  const heroThumbnail = heroGlb
    ? findThumbnail(attachments as MediaAttachment[], heroGlb.generationId)
    : undefined;

  // Collect all images for a visual gallery strip
  const allImages = (byCategory['image'] || []).filter((a) => a.url);

  return (
    <div className="space-y-4">
      {/* Hero image strip — show all attached images as a visual grid */}
      {allImages.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
            {CATEGORY_ICONS['image']}
            <span className="text-xs font-semibold uppercase tracking-wider">
              {CATEGORY_LABELS['image']}
            </span>
            <span className="text-xs text-muted-foreground/60">({allImages.length})</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {allImages.map((img) => (
              <a
                key={img.id}
                href={img.url}
                target="_blank"
                rel="noreferrer"
                className="group relative aspect-square rounded-lg overflow-hidden border bg-muted/30 hover:ring-2 hover:ring-primary transition-all"
              >
                <img
                  src={img.url}
                  alt={img.label || img.originalFilename}
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-white text-xs truncate">{img.label || img.originalFilename}</p>
                  {img.subCategory && (
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 mt-0.5">
                      {img.subCategory}
                    </Badge>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Hero 3D model viewer — interactive GLB preview */}
      {heroGlb && (
        <div>
          <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
            {CATEGORY_ICONS['3d']}
            <span className="text-xs font-semibold uppercase tracking-wider">3D Model Preview</span>
          </div>
          <ModelViewer
            src={heroGlb.url}
            poster={heroThumbnail}
            alt={heroGlb.label || '3D Model'}
            className="aspect-square max-h-[400px]"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {heroGlb.label || heroGlb.originalFilename}
            {heroGlb.subCategory && ` — ${heroGlb.subCategory}`}
          </p>
        </div>
      )}

      {/* Remaining categories as file lists (skip image since we rendered the grid above) */}
      {CATEGORY_ORDER.map((cat) => {
        // Images already rendered as grid above
        if (cat === 'image') return null;

        const items = byCategory[cat];
        if (!items || items.length === 0) return null;

        // Group by variants within this category
        const variantGroups = groupByVariant(items);

        return (
          <div key={cat}>
            <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
              {CATEGORY_ICONS[cat]}
              <span className="text-xs font-semibold uppercase tracking-wider">
                {CATEGORY_LABELS[cat]}
              </span>
              <span className="text-xs text-muted-foreground/60">({items.length})</span>
            </div>
            <div className="space-y-1.5">
              {variantGroups.map(({ root, variants }) => (
                <AttachmentRow
                  key={root.id}
                  item={root}
                  variants={variants}
                  isOwner={!!isOwner}
                  targetType={targetType}
                  targetId={targetId}
                  onDetach={(id) => detach.mutate({ id, targetType, targetId })}
                  detaching={detach.isPending}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
