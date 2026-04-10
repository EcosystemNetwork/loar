/**
 * Gallery Grid — Responsive grid layout for content cards.
 */
import { ContentCard } from './ContentCard';
import { Loader2 } from 'lucide-react';

interface GalleryGridProps {
  items: any[];
  isLoading?: boolean;
  onBuy?: (content: any) => void;
  onRent?: (content: any) => void;
  onLicense?: (content: any) => void;
  emptyMessage?: string;
}

export function GalleryGrid({
  items,
  isLoading,
  onBuy,
  onRent,
  onLicense,
  emptyMessage = 'No content found',
}: GalleryGridProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {items.map((item) => (
        <ContentCard
          key={item.id}
          content={item}
          onBuy={onBuy ? () => onBuy(item) : undefined}
          onRent={onRent ? () => onRent(item) : undefined}
          onLicense={onLicense ? () => onLicense(item) : undefined}
        />
      ))}
    </div>
  );
}
