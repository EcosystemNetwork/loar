/**
 * Content Card — Gallery item display with thumbnail, pricing, and creator info.
 */
import { useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  ShoppingCart,
  Clock,
  FileCheck,
  Eye,
  Heart,
  Film,
  Sparkles,
  Upload,
  Globe,
  Wand2,
  Sun,
  Layers,
  Music,
  Box,
  GitBranch,
  Shield,
  Users,
} from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { useVideoLoad } from '@/hooks/useVideoLoad';
import { useWalletAuth } from '@/lib/wallet-auth';
import { ClaimToUniverseDialog } from './ClaimToUniverseDialog';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import { Price } from '@/components/Price';

interface ContentCardProps {
  content: {
    id: string;
    title?: string;
    description?: string;
    thumbnailUrl?: string;
    imageUrl?: string;
    mediaUrl?: string;
    mediaType?: string;
    classification?: 'original' | 'fan' | 'licensed' | string;
    creatorUid?: string;
    creatorAddress?: string;
    views?: number;
    likes?: number;
    universeId?: string;
    contentHash?: string;
    // Lineage — set when this clip is derived from another generation.
    parentGenerationId?: string | null;
    sourceImageUrl?: string | null;
    sourceVideoGenerationId?: string | null;
    sourceAudioGenerationId?: string | null;
    licensing?: {
      buyPrice?: string;
      rentPricePerDay?: string;
      licenseFee?: string;
      registrationId?: string;
    } | null;
  };
  onBuy?: () => void;
  onRent?: () => void;
  onLicense?: () => void;
  onClick?: () => void;
}

export function ContentCard({ content, onBuy, onRent, onLicense, onClick }: ContentCardProps) {
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const { isAuthenticated } = useWalletAuth();
  const isOrphan = !content.universeId;
  const isVideo = content.mediaType === 'video' || content.mediaType === 'ai-video';
  const isAudio = content.mediaType === 'audio';
  const is3D = content.mediaType === '3d';
  const isAIGenerated = content.mediaType?.startsWith('ai-');
  const isImage = !isVideo && !isAudio && !is3D && (content.mediaUrl || content.imageUrl);
  const editSource = content.mediaUrl || content.imageUrl;
  const canEdit = Boolean(editSource) && (isImage || isVideo);
  const hasLineage = Boolean(
    content.parentGenerationId ||
    content.sourceImageUrl ||
    content.sourceVideoGenerationId ||
    content.sourceAudioGenerationId
  );
  const classification = content.classification ?? 'original';
  const rawThumbnail =
    content.thumbnailUrl || content.imageUrl || content.mediaUrl || '/placeholder.jpg';
  const thumbnail = resolveIpfsUrl(rawThumbnail) || rawThumbnail;
  // Poster shown immediately beneath the video so every video tile is filled
  // the instant the grid paints — the video fades in on top once its own frame
  // is ready, instead of each tile popping in one-by-one as it finishes loading.
  const posterUrl = resolveIpfsUrl(content.thumbnailUrl || content.imageUrl || '') || null;
  // These are hover-to-play tiles, so the poster IS the preview. When a poster
  // exists we DON'T eager-load the video — that's what made a full grid take
  // ~30s (40 videos × metadata fetch over IPFS, 6 at a time). We load the video
  // only on hover. Posterless videos still eager-load (via the shared queue) so
  // they show a first frame instead of an empty tile.
  const [hovered, setHovered] = useState(false);
  const hoveredRef = useRef(false);
  const eagerLoad = isVideo && !!content.mediaUrl && !posterUrl;
  const {
    videoRef,
    ready: videoReady,
    onLoaded: onVideoSlotDone,
  } = useVideoLoad(eagerLoad ? content.mediaUrl : undefined);
  const loadVideo = videoReady || hovered;
  const hasLicensing =
    content.licensing &&
    (content.licensing.buyPrice !== '0' ||
      content.licensing.rentPricePerDay !== '0' ||
      content.licensing.licenseFee !== '0');

  return (
    <Card
      className="group overflow-hidden hover:shadow-lg transition-all duration-300 border-muted/50 cursor-pointer"
      onClick={onClick}
    >
      {/* Thumbnail / Video — every variant sits on the same dark gradient base
          so the grid stays visually even before any media has loaded. */}
      <div className="relative aspect-video overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-900/95 to-zinc-800">
        {isVideo && content.mediaUrl ? (
          <>
            {/* Base layer — the poster shows immediately and uniformly across
                the grid. When a video has no poster we fall back to a shimmer.
                Either way the tile is never empty while the video loads. */}
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={content.title || 'Video'}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                decoding="async"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              !videoLoaded && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_25%,rgba(255,255,255,0.04)_50%,transparent_75%)] bg-[length:200%_100%] animate-shimmer" />
                  <Film className="h-8 w-8 text-white/30" />
                </div>
              )
            )}
            <video
              ref={videoRef}
              src={loadVideo ? `${resolveIpfsUrl(content.mediaUrl)}#t=0.5` : undefined}
              className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${videoLoaded ? 'opacity-100' : 'opacity-0'}`}
              muted
              loop
              playsInline
              preload="metadata"
              onLoadedData={(e) => {
                setVideoLoaded(true);
                onVideoSlotDone();
                // Hover may have triggered the load — start playing now that the
                // first frame is in, but only if the pointer is still over the tile.
                if (hoveredRef.current) {
                  const p = e.currentTarget.play();
                  if (p) p.catch(() => {});
                }
              }}
              onError={() => onVideoSlotDone()}
              onMouseEnter={(e) => {
                hoveredRef.current = true;
                setHovered(true);
                // If the src is already loaded (posterless eager-load case) this
                // plays immediately; otherwise onLoadedData plays once it arrives.
                const playPromise = e.currentTarget.play();
                if (playPromise)
                  playPromise.catch(() => {
                    /* AbortError — hover cancelled before play resolved, or src not ready yet */
                  });
              }}
              onMouseLeave={(e) => {
                hoveredRef.current = false;
                e.currentTarget.pause();
                e.currentTarget.currentTime = 0;
                // For poster-backed tiles, drop the src so the video unloads and
                // the poster shows through again (frees memory + bandwidth).
                if (posterUrl) {
                  setHovered(false);
                  setVideoLoaded(false);
                }
              }}
            />
          </>
        ) : isAudio ? (
          // Audio has no visual preview — animated bars over the shared dark base.
          <div className="w-full h-full flex items-center justify-center">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/15 to-cyan-500/15" />
            <div className="relative flex items-end gap-1 h-10">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span
                  key={i}
                  className="block w-1 bg-emerald-300/70 rounded-sm animate-audio-bar"
                  style={{
                    height: `${30 + ((i * 17) % 70)}%`,
                    animationDelay: `${i * 110}ms`,
                  }}
                />
              ))}
            </div>
            <Music className="absolute bottom-3 right-3 h-4 w-4 text-emerald-200/60" />
          </div>
        ) : is3D ? (
          // 3D: prefer Meshy's rendered thumbnail; fall back to a cube glyph.
          content.thumbnailUrl ? (
            <img
              src={resolveIpfsUrl(content.thumbnailUrl) || content.thumbnailUrl}
              alt={content.title || '3D model'}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = '/placeholder.jpg';
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="absolute inset-0 bg-gradient-to-br from-amber-500/15 to-rose-500/15" />
              <Box className="relative h-10 w-10 text-amber-200/70" />
            </div>
          )
        ) : (
          <img
            src={thumbnail}
            alt={content.title || 'Content'}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = '/placeholder.jpg';
            }}
          />
        )}
        {content.mediaType && (
          <Badge
            variant="secondary"
            className={`absolute top-2 left-2 text-xs gap-1 ${isAIGenerated ? 'bg-violet-500/80 text-white border-violet-400/50' : ''}`}
          >
            {isAIGenerated ? <Sparkles className="h-3 w-3" /> : <Upload className="h-3 w-3" />}
            {isVideo
              ? isAIGenerated
                ? 'AI Video'
                : 'Video'
              : is3D
                ? '3D'
                : isAudio
                  ? 'Audio'
                  : isAIGenerated
                    ? 'AI Image'
                    : 'Image'}
          </Badge>
        )}
        {/* Rights classification badge — `original` is the default and implied,
            so we only surface `fan` (derivative) and `licensed` to avoid noise. */}
        {classification === 'fan' && (
          <Badge
            variant="secondary"
            className="absolute top-2 left-[72px] text-xs gap-1 bg-amber-500/80 text-white border-amber-400/50"
            title="Fan / derivative — uses third-party IP"
          >
            <Users className="h-3 w-3" />
            Fan
          </Badge>
        )}
        {classification === 'licensed' && (
          <Badge
            variant="secondary"
            className="absolute top-2 left-[72px] text-xs gap-1 bg-sky-500/80 text-white border-sky-400/50"
            title="Licensed — used under grant"
          >
            <Shield className="h-3 w-3" />
            Licensed
          </Badge>
        )}
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none group-hover:opacity-0 transition-opacity">
            <div className="w-10 h-10 rounded-full bg-black/50 flex items-center justify-center">
              <Film className="h-5 w-5 text-white" />
            </div>
          </div>
        )}
        {/* Stats overlay */}
        <div className="absolute bottom-2 right-2 flex items-center gap-2 text-xs text-white">
          {content.views !== undefined && (
            <span className="flex items-center gap-0.5 bg-black/50 rounded px-1.5 py-0.5">
              <Eye className="h-3 w-3" /> {content.views}
            </span>
          )}
          {content.likes !== undefined && (
            <span className="flex items-center gap-0.5 bg-black/50 rounded px-1.5 py-0.5">
              <Heart className="h-3 w-3" /> {content.likes}
            </span>
          )}
        </div>

        {/* Edit (inpaint) + Relight CTAs — visible on hover */}
        {canEdit && editSource && isAuthenticated && (
          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Link
              to="/edit/inpaint"
              search={{ src: editSource, sourceGenerationId: content.id }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-black/60 hover:bg-black/80 text-white text-[11px] px-2 py-1 rounded flex items-center gap-1"
              title={
                isVideo
                  ? 'Capture a frame, then inpaint/remove/replace/fill'
                  : 'Inpaint, remove, replace, or fill'
              }
            >
              <Wand2 className="h-3 w-3" />
              Edit
            </Link>
            {isImage && (
              <Link
                to="/relight"
                search={{
                  image: editSource,
                  generation: content.id,
                  ...(content.universeId ? { universe: content.universeId } : {}),
                }}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                className="bg-black/60 hover:bg-black/80 text-white text-[11px] px-2 py-1 rounded flex items-center gap-1"
                title="Relight, time-shift, swap backdrop, or color mood"
              >
                <Sun className="h-3 w-3" />
                Relight
              </Link>
            )}
            <Link
              to="/studio/edit/$assetId"
              params={{ assetId: content.id }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className="bg-primary/70 hover:bg-primary/90 text-white text-[11px] px-2 py-1 rounded flex items-center gap-1"
              title="Open versioned Edit Canvas (owners only)"
            >
              <Layers className="h-3 w-3" />
              Studio
            </Link>
          </div>
        )}
      </div>

      <CardContent className="p-3 space-y-2">
        {/* Title */}
        <h3 className="font-medium text-sm truncate">{content.title || 'Untitled'}</h3>

        {/* Creator */}
        {content.creatorAddress && (
          <Link
            to={`/profile/${content.creatorUid || content.creatorAddress}` as any}
            className="text-xs text-muted-foreground hover:text-foreground truncate block"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            by {content.creatorAddress.slice(0, 6)}...{content.creatorAddress.slice(-4)}
          </Link>
        )}

        {/* Lineage chip — derived from a prior generation/source asset. */}
        {hasLineage && (
          <div
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
            title={
              content.parentGenerationId
                ? `Derived from generation ${content.parentGenerationId}`
                : content.sourceImageUrl
                  ? 'Derived from an uploaded image'
                  : 'Derived from a prior generation'
            }
          >
            <GitBranch className="h-3 w-3" />
            <span className="truncate">Derived</span>
          </div>
        )}

        {/* Claim CTA — orphan AI-generated content only. Uploads stay where the
            uploader filed them; only AI-gen output is swappable into a universe. */}
        {isOrphan && isAIGenerated && isAuthenticated && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs w-full"
            onClick={(e) => {
              e.stopPropagation();
              setClaimOpen(true);
            }}
          >
            <Globe className="h-3 w-3 mr-1.5" />
            Claim to my universe
          </Button>
        )}

        {/* Pricing */}
        {hasLicensing && (
          <div className="flex flex-wrap gap-1">
            {content.licensing!.buyPrice && content.licensing!.buyPrice !== '0' && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onBuy?.();
                }}
              >
                <ShoppingCart className="h-3 w-3 mr-1" />
                <Price wei={content.licensing!.buyPrice} hideChain />
              </Button>
            )}
            {content.licensing!.rentPricePerDay && content.licensing!.rentPricePerDay !== '0' && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onRent?.();
                }}
              >
                <Clock className="h-3 w-3 mr-1" />
                <Price wei={content.licensing!.rentPricePerDay} hideChain />
                /day
              </Button>
            )}
            {content.licensing!.licenseFee && content.licensing!.licenseFee !== '0' && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onLicense?.();
                }}
              >
                <FileCheck className="h-3 w-3 mr-1" />
                License
              </Button>
            )}
          </div>
        )}
      </CardContent>

      {claimOpen && (
        <ClaimToUniverseDialog
          open={claimOpen}
          onOpenChange={setClaimOpen}
          contentId={content.id}
          contentTitle={content.title}
        />
      )}
    </Card>
  );
}
