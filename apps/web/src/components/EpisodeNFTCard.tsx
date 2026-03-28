import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Film, Loader2 } from 'lucide-react';
import { ContentLaneBadge } from '@/components/ContentLaneBadge';

interface EpisodeNFTCardProps {
  episode: {
    id: string;
    title: string;
    description: string;
    mediaUrl?: string;
    thumbnailUrl?: string;
    mintPrice: string; // ETH decimal string, e.g. "0.05"
    maxSupply: number; // 0 = unlimited
    minted: number;
    royaltyBps: number;
    classification?: 'fan' | 'original' | 'licensed';
    reviewStatus?: 'not_required' | 'pending' | 'approved' | 'rejected';
    creatorAddress?: string;
  };
  onMint: (episodeId: string) => void;
  isMinting?: boolean;
  isOwner?: boolean;
}

export function EpisodeNFTCard({ episode, onMint, isMinting, isOwner }: EpisodeNFTCardProps) {
  const supplyLabel =
    episode.maxSupply > 0
      ? `${episode.minted} / ${episode.maxSupply} minted`
      : `${episode.minted} minted`;

  const supplyPercent =
    episode.maxSupply > 0 ? Math.min((episode.minted / episode.maxSupply) * 100, 100) : null;

  const canMint =
    !isOwner &&
    (episode.classification === 'original' ||
      episode.classification === 'licensed' ||
      episode.classification === undefined) &&
    episode.reviewStatus !== 'pending' &&
    episode.reviewStatus !== 'rejected';

  return (
    <Card className="overflow-hidden">
      {/* Thumbnail */}
      <div className="aspect-video bg-muted relative">
        {episode.thumbnailUrl ? (
          <img
            src={episode.thumbnailUrl}
            alt={episode.title}
            className="w-full h-full object-cover"
          />
        ) : episode.mediaUrl ? (
          <video src={episode.mediaUrl} className="w-full h-full object-cover" muted />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <Film className="h-8 w-8" />
          </div>
        )}
        {episode.classification && (
          <div className="absolute bottom-2 left-2">
            <ContentLaneBadge
              classification={episode.classification}
              reviewStatus={episode.reviewStatus}
              size="sm"
            />
          </div>
        )}
      </div>

      <CardContent className="p-4 space-y-3">
        <div>
          <h3 className="font-semibold line-clamp-1">{episode.title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{episode.description}</p>
        </div>

        {/* Supply bar */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{supplyLabel}</span>
            <Badge variant="outline" className="text-xs">
              {episode.royaltyBps / 100}% royalty
            </Badge>
          </div>
          {supplyPercent !== null && (
            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${supplyPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Price + mint */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-bold">{episode.mintPrice} ETH</p>
            {episode.creatorAddress && (
              <p className="text-xs text-muted-foreground">
                {episode.creatorAddress.slice(0, 6)}...{episode.creatorAddress.slice(-4)}
              </p>
            )}
          </div>
          {canMint && (
            <Button
              size="sm"
              onClick={() => onMint(episode.id)}
              disabled={isMinting}
              className="gap-1.5"
            >
              {isMinting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Minting...
                </>
              ) : (
                'Mint NFT'
              )}
            </Button>
          )}
          {isOwner && (
            <Badge variant="secondary" className="text-xs">
              Your listing
            </Badge>
          )}
          {!canMint && !isOwner && episode.reviewStatus === 'pending' && (
            <Badge variant="outline" className="text-xs text-yellow-600">
              Pending Review
            </Badge>
          )}
        </div>

        {/* Mint disclosure */}
        {canMint && (
          <p className="text-xs text-muted-foreground border-t pt-2">
            Creator attests ownership. LOAR does not independently verify IP claims.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
