/**
 * Featured Card — A single featured item with queued video loading.
 */
import { useState } from 'react';
import { Film, Box } from 'lucide-react';
import { useVideoLoad } from '@/hooks/useVideoLoad';
import { proxiedImage, proxiedSrcSet } from '@/utils/img-proxy';

interface FeaturedCardProps {
  item: {
    id: string;
    title?: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    mediaType?: string;
  };
}

export function FeaturedCard({ item }: FeaturedCardProps) {
  const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';
  // 3D items' `mediaUrl` is a .glb/.fbx binary, not a decodable image —
  // only ever fall back to it for non-3D media (see components/gallery/
  // ContentCard.tsx's `is3D` branch for the pattern this mirrors).
  const is3D = item.mediaType === '3d';
  const {
    videoRef,
    ready,
    resolvedSrc: videoSrc,
    onLoaded,
  } = useVideoLoad(isVideo ? item.mediaUrl : undefined);
  const [loaded, setLoaded] = useState(false);
  const rawThumbnail = is3D
    ? item.thumbnailUrl
    : item.thumbnailUrl || item.mediaUrl || '/placeholder.jpg';

  return (
    <div className="relative aspect-video rounded-lg overflow-hidden group cursor-pointer bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-800">
      {isVideo && item.mediaUrl ? (
        <>
          <video
            ref={videoRef}
            src={ready && videoSrc ? `${videoSrc}#t=0.5` : undefined}
            className={`w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            muted
            loop
            playsInline
            preload="metadata"
            poster={proxiedImage(item.thumbnailUrl) || undefined}
            onLoadedData={() => {
              setLoaded(true);
              onLoaded();
            }}
            onError={() => onLoaded()}
            onMouseEnter={(e) => {
              const playPromise = e.currentTarget.play();
              if (playPromise)
                playPromise.catch(() => {
                  /* AbortError — hover cancelled */
                });
            }}
            onMouseLeave={(e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }}
          />
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.04)_50%,transparent_75%)] bg-[length:200%_100%] animate-shimmer" />
              <Film className="h-8 w-8 text-white/30" />
            </div>
          )}
        </>
      ) : is3D && !rawThumbnail ? (
        // 3D with no Meshy-rendered thumbnail: no image-decodable source
        // exists (mediaUrl is a .glb/.fbx binary) — show a cube glyph
        // instead of proxying the model URL through the image resize proxy,
        // which can only ever fail.
        <div className="w-full h-full flex items-center justify-center relative">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/15 to-rose-500/15" />
          <Box className="relative h-8 w-8 text-amber-200/70" />
        </div>
      ) : (
        <img
          src={proxiedImage(rawThumbnail)}
          srcSet={proxiedSrcSet(rawThumbnail)}
          sizes="(max-width: 768px) 100vw, 640px"
          alt={item.title || 'Featured'}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src = '/placeholder.jpg';
          }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
      <div className="absolute bottom-2 left-2 text-white text-xs font-medium">
        {item.title || 'Untitled'}
      </div>
    </div>
  );
}
