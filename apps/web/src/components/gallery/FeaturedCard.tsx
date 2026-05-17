/**
 * Featured Card — A single featured item with queued video loading.
 */
import { useState } from 'react';
import { Film } from 'lucide-react';
import { useVideoLoad } from '@/hooks/useVideoLoad';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

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
  const { videoRef, ready, onLoaded } = useVideoLoad(isVideo ? item.mediaUrl : undefined);
  const [loaded, setLoaded] = useState(false);

  return (
    <div className="relative aspect-video rounded-lg overflow-hidden group cursor-pointer bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-800">
      {isVideo && item.mediaUrl ? (
        <>
          <video
            ref={videoRef}
            src={ready ? `${resolveIpfsUrl(item.mediaUrl)}#t=0.5` : undefined}
            className={`w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            muted
            loop
            playsInline
            preload="metadata"
            poster={resolveIpfsUrl(item.thumbnailUrl) || undefined}
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
      ) : (
        <img
          src={resolveIpfsUrl(item.thumbnailUrl || item.mediaUrl || '/placeholder.jpg')}
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
