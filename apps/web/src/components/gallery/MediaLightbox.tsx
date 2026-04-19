/**
 * Media Lightbox — Full-screen modal for viewing gallery videos and images.
 * Click a gallery card to pop it out into this immersive viewer.
 */
import { useState, useEffect, useCallback } from 'react';
import { X, Download, Heart, Eye, GitBranch, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useGalleryLineage } from '@/hooks/useGallery';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface MediaLightboxProps {
  content: {
    id: string;
    title?: string;
    description?: string;
    thumbnailUrl?: string;
    imageUrl?: string;
    mediaUrl?: string;
    mediaType?: string;
    creatorAddress?: string;
    views?: number;
    likes?: number;
    parentGenerationId?: string | null;
    sourceImageUrl?: string | null;
  } | null;
  onClose: () => void;
  /** Called when the user clicks a lineage tile to jump to another content
   *  doc. The item is passed in full (shape matches the lineage DTO) so the
   *  grid can swap to items that aren't on the currently loaded page. */
  onNavigate?: (item: NonNullable<MediaLightboxProps['content']>) => void;
}

export function MediaLightbox({ content, onClose, onNavigate }: MediaLightboxProps) {
  const [loaded, setLoaded] = useState(false);
  const isVideo = content?.mediaType === 'video' || content?.mediaType === 'ai-video';
  // Prefer the full-quality source; fall back to thumbnail so images always display
  const videoSrc = content?.mediaUrl;
  const imageSrc = content?.mediaUrl || content?.imageUrl || content?.thumbnailUrl;
  const mediaSrc = isVideo ? videoSrc : imageSrc;

  // Lineage — only fetched when a node is open and likely has a family tree
  // (parent ref or source image set). Avoids a flood of requests for the
  // common case where most gallery items are leaf nodes.
  const lineageEnabled = Boolean(content && (content.parentGenerationId || content.sourceImageUrl));
  const { data: lineage } = useGalleryLineage(lineageEnabled ? content?.id : undefined);
  const hasDerivatives = (lineage?.derivatives?.length ?? 0) > 0;
  const hasLineagePanel = lineageEnabled || hasDerivatives || Boolean(content?.sourceImageUrl);

  // Reset loaded state when content changes
  useEffect(() => {
    setLoaded(false);
  }, [mediaSrc]);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!content) return;
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [content, handleKeyDown]);

  if (!content || !mediaSrc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      {/* Backdrop — solid overlay, no backdrop-filter to avoid GPU compositing blur */}
      <div className="absolute inset-0 bg-black/95" />

      {/* Content */}
      <div
        className="relative z-10 flex flex-col items-center max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 p-2 text-white/70 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="h-6 w-6" />
        </button>

        {/* Media */}
        <div className="rounded-lg overflow-hidden shadow-2xl bg-black">
          {isVideo ? (
            <video
              key={mediaSrc}
              src={mediaSrc}
              className="max-w-[85vw] max-h-[75vh] object-contain"
              controls
              autoPlay
              loop
              playsInline
              preload="auto"
            />
          ) : (
            <>
              {!loaded && (
                <div className="flex items-center justify-center w-[50vw] aspect-square max-h-[75vh]">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                </div>
              )}
              <img
                src={mediaSrc}
                alt={content.title || 'Content'}
                className={`max-w-[85vw] max-h-[75vh] object-contain ${loaded ? '' : 'hidden'}`}
                style={{ imageRendering: 'auto' }}
                onLoad={() => setLoaded(true)}
              />
            </>
          )}
        </div>

        {/* Info bar */}
        <div className="mt-4 w-full max-w-2xl flex items-center justify-between text-white">
          <div className="min-w-0">
            <h3 className="font-semibold text-lg truncate">{content.title || 'Untitled'}</h3>
            {content.description && (
              <p className="text-sm text-white/60 line-clamp-2 mt-1">{content.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-white/50">
              {content.creatorAddress && (
                <span>
                  by {content.creatorAddress.slice(0, 6)}...
                  {content.creatorAddress.slice(-4)}
                </span>
              )}
              {content.views !== undefined && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" /> {content.views}
                </span>
              )}
              {content.likes !== undefined && (
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3" /> {content.likes}
                </span>
              )}
              {content.mediaType && (
                <Badge variant="outline" className="text-xs border-white/20 text-white/60">
                  {content.mediaType}
                </Badge>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {mediaSrc && (
              <a href={mediaSrc} target="_blank" rel="noopener noreferrer" download>
                <Button variant="ghost" size="sm" className="text-white/70 hover:text-white">
                  <Download className="h-4 w-4" />
                </Button>
              </a>
            )}
          </div>
        </div>

        {/* Lineage / family tree */}
        {hasLineagePanel && (
          <div className="mt-4 w-full max-w-2xl text-white space-y-3 border-t border-white/10 pt-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/40">
              <GitBranch className="h-3 w-3" />
              Lineage
            </div>

            {/* Parent — either a prior gallery item or just a raw source image. */}
            {(lineage?.parent || content?.sourceImageUrl) && (
              <div>
                <div className="text-xs text-white/50 mb-1">Derived from</div>
                {lineage?.parent ? (
                  <button
                    type="button"
                    onClick={() => onNavigate?.(lineage.parent!)}
                    className="flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-lg p-2 w-full text-left transition-colors"
                  >
                    <img
                      src={resolveIpfsUrl(
                        lineage.parent.thumbnailUrl || lineage.parent.mediaUrl || '/placeholder.jpg'
                      )}
                      alt={lineage.parent.title}
                      className="w-16 h-10 object-cover rounded"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm truncate">{lineage.parent.title}</div>
                      <div className="text-xs text-white/50 truncate">
                        {lineage.parent.mediaType}
                      </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-white/40 flex-shrink-0" />
                  </button>
                ) : content?.sourceImageUrl ? (
                  <a
                    href={content.sourceImageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-lg p-2 transition-colors"
                  >
                    <img
                      src={content.sourceImageUrl}
                      alt="Source image"
                      className="w-16 h-10 object-cover rounded"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">Source image</div>
                      <div className="text-xs text-white/50 truncate">Uploaded reference</div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-white/40 flex-shrink-0" />
                  </a>
                ) : null}
              </div>
            )}

            {/* Derivatives grid */}
            {hasDerivatives && (
              <div>
                <div className="text-xs text-white/50 mb-1">
                  Used as source by {lineage!.derivatives.length}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {lineage!.derivatives.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => onNavigate?.(d)}
                      className="relative aspect-square overflow-hidden rounded bg-white/5 hover:ring-2 hover:ring-white/40 transition-all"
                      title={d.title}
                    >
                      <img
                        src={resolveIpfsUrl(d.thumbnailUrl || d.mediaUrl || '/placeholder.jpg')}
                        alt={d.title}
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
