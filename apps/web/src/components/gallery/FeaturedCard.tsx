/**
 * Featured Card — A single featured item with queued video loading.
 */
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

  return (
    <div className="relative aspect-video rounded-lg overflow-hidden group cursor-pointer">
      {isVideo && item.mediaUrl ? (
        <video
          ref={videoRef}
          src={ready ? `${item.mediaUrl}#t=0.5` : undefined}
          className="w-full h-full object-cover"
          muted
          loop
          playsInline
          preload="none"
          poster={item.thumbnailUrl || undefined}
          onLoadedData={() => onLoaded()}
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
