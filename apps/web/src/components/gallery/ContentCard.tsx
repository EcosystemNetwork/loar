/**
 * Content Card — Gallery item display with thumbnail, pricing, and creator info.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ShoppingCart, Clock, FileCheck, Eye, Heart } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { formatEther } from 'viem';

interface ContentCardProps {
  content: {
    id: string;
    title?: string;
    description?: string;
    thumbnailUrl?: string;
    imageUrl?: string;
    mediaType?: string;
    creatorUid?: string;
    creatorAddress?: string;
    views?: number;
    likes?: number;
    universeId?: string;
    contentHash?: string;
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
}

function formatPrice(wei: string | undefined): string {
  if (!wei || wei === '0') return '';
  try {
    return `${formatEther(BigInt(wei))} ETH`;
  } catch {
    return wei;
  }
}

export function ContentCard({ content, onBuy, onRent, onLicense }: ContentCardProps) {
  const thumbnail = content.thumbnailUrl || content.imageUrl || '/placeholder.jpg';
  const hasLicensing =
    content.licensing &&
    (content.licensing.buyPrice !== '0' ||
      content.licensing.rentPricePerDay !== '0' ||
      content.licensing.licenseFee !== '0');

  return (
    <Card className="group overflow-hidden hover:shadow-lg transition-all duration-300 border-muted/50">
      {/* Thumbnail */}
      <div className="relative aspect-video overflow-hidden bg-muted">
        <img
          src={thumbnail}
          alt={content.title || 'Content'}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
        {content.mediaType && (
          <Badge variant="secondary" className="absolute top-2 left-2 text-xs capitalize">
            {content.mediaType}
          </Badge>
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
      </div>

      <CardContent className="p-3 space-y-2">
        {/* Title */}
        <h3 className="font-medium text-sm truncate">{content.title || 'Untitled'}</h3>

        {/* Creator */}
        {content.creatorAddress && (
          <Link
            to={`/profile/${content.creatorUid || content.creatorAddress}`}
            className="text-xs text-muted-foreground hover:text-foreground truncate block"
          >
            by {content.creatorAddress.slice(0, 6)}...{content.creatorAddress.slice(-4)}
          </Link>
        )}

        {/* Pricing */}
        {hasLicensing && (
          <div className="flex flex-wrap gap-1">
            {content.licensing!.buyPrice && content.licensing!.buyPrice !== '0' && (
              <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={onBuy}>
                <ShoppingCart className="h-3 w-3 mr-1" />
                {formatPrice(content.licensing!.buyPrice)}
              </Button>
            )}
            {content.licensing!.rentPricePerDay && content.licensing!.rentPricePerDay !== '0' && (
              <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={onRent}>
                <Clock className="h-3 w-3 mr-1" />
                {formatPrice(content.licensing!.rentPricePerDay)}/day
              </Button>
            )}
            {content.licensing!.licenseFee && content.licensing!.licenseFee !== '0' && (
              <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={onLicense}>
                <FileCheck className="h-3 w-3 mr-1" />
                License
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
