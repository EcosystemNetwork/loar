/**
 * ModelViewer — interactive 3D model viewer using Google's <model-viewer>.
 *
 * Renders GLB/GLTF files with orbit controls, auto-rotate, and AR support.
 * Falls back gracefully if the poster (thumbnail) is provided.
 */
import '@google/model-viewer';
import { useRef, useState, useEffect } from 'react';
import { Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ModelViewerProps {
  /** URL to the GLB/GLTF model */
  src: string;
  /** Optional poster image shown while loading */
  poster?: string;
  /** Alt text */
  alt?: string;
  /** CSS class for the container */
  className?: string;
  /** Whether to allow fullscreen */
  allowFullscreen?: boolean;
}

export function ModelViewer({
  src,
  poster,
  alt = '3D Model',
  className = '',
  allowFullscreen = true,
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Create the <model-viewer> element imperatively to avoid JSX type issues
  useEffect(() => {
    if (!viewerRef.current) return;
    const el = document.createElement('model-viewer') as any;
    el.setAttribute('src', src);
    if (poster) el.setAttribute('poster', poster);
    el.setAttribute('alt', alt);
    el.setAttribute('camera-controls', '');
    el.setAttribute('auto-rotate', '');
    el.setAttribute('shadow-intensity', '1');
    el.setAttribute('tone-mapping', 'neutral');
    el.setAttribute('exposure', '1');
    el.setAttribute('touch-action', 'pan-y');
    el.setAttribute('interaction-prompt', 'auto');
    el.setAttribute('loading', 'lazy');
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.minHeight = '300px';
    el.addEventListener('load', () => setLoading(false));

    viewerRef.current.innerHTML = '';
    viewerRef.current.appendChild(el);

    return () => {
      el.remove();
    };
  }, [src, poster, alt]);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`relative rounded-lg overflow-hidden bg-muted/30 border ${className}`}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-muted/50">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <div ref={viewerRef} className="w-full h-full" />

      {/* Controls overlay */}
      <div className="absolute top-2 right-2 flex gap-1">
        {allowFullscreen && (
          <Button
            variant="secondary"
            size="icon"
            className="h-7 w-7 bg-background/80 backdrop-blur-sm"
            onClick={toggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
