/**
 * Media Lightbox — Full-screen modal for viewing gallery videos and images.
 * Click a gallery card to pop it out into this immersive viewer.
 */
import { useState, useEffect, useCallback } from 'react';
import { X, Download, Heart, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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
  } | null;
  onClose: () => void;
}

export function MediaLightbox({ content, onClose }: MediaLightboxProps) {
  const [loaded, setLoaded] = useState(false);
  const isVideo = content?.mediaType === 'video' || content?.mediaType === 'ai-video';
  // Prefer the full-quality source; fall back to thumbnail so images always display
  const videoSrc = content?.mediaUrl;
  const imageSrc = content?.mediaUrl || content?.imageUrl || content?.thumbnailUrl;
  const mediaSrc = isVideo ? videoSrc : imageSrc;

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
      </div>
    </div>
  );
}
