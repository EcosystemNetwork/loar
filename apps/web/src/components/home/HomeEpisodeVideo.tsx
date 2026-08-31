import { useResolvedIpfsUrl } from '@/hooks/useResolvedIpfsUrl';
import { proxiedImage } from '@/utils/img-proxy';

/**
 * The home feed renders dozens of `<video>` thumbnails at once. Resolving the
 * src synchronously (`resolveIpfsUrlPreferred`) always hands back a *public*
 * gateway URL on a cold cache (ipfs.io / gateway.pinata.cloud) and never
 * re-renders when the dedicated-gateway URL lands — so a whole page of clips
 * hammers the public gateways, which rate-limit (429) and time out (504).
 *
 * `useResolvedIpfsUrl` races the gateways in the background and upgrades the
 * src to the dedicated (fast, authenticated) gateway once it wins, without
 * waiting for a failed request first. Centralised here so every home `<video>`
 * gets the same behaviour.
 */
export function HomeEpisodeVideo({
  videoUrl,
  thumbnailUrl,
  startTime = 0.1,
  loop = true,
  hoverPlay = true,
  className = 'w-full h-full object-cover',
}: {
  videoUrl: string;
  thumbnailUrl?: string | null;
  startTime?: number;
  loop?: boolean;
  hoverPlay?: boolean;
  className?: string;
}) {
  const resolved = useResolvedIpfsUrl(videoUrl);

  return (
    <video
      src={resolved ? `${resolved}#t=${startTime}` : undefined}
      poster={proxiedImage(thumbnailUrl) || undefined}
      className={className}
      muted
      loop={loop}
      playsInline
      preload="metadata"
      onMouseEnter={
        hoverPlay
          ? (e) => {
              const p = e.currentTarget.play();
              if (p) p.catch(() => {});
            }
          : undefined
      }
      onMouseLeave={
        hoverPlay
          ? (e) => {
              e.currentTarget.pause();
              e.currentTarget.currentTime = 0;
            }
          : undefined
      }
    />
  );
}
