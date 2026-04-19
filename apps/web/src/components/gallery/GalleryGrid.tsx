/**
 * Gallery Grid — Responsive grid layout for content cards.
 * Click any card to open it in a full-screen lightbox.
 */
import { useState } from 'react';
import { ContentCard } from './ContentCard';
import { MediaLightbox } from './MediaLightbox';
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
  const [lightboxItem, setLightboxItem] = useState<any>(null);

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
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((item) => (
          <ContentCard
            key={item.id}
            content={item}
            onClick={() => setLightboxItem(item)}
            onBuy={onBuy ? () => onBuy(item) : undefined}
            onRent={onRent ? () => onRent(item) : undefined}
            onLicense={onLicense ? () => onLicense(item) : undefined}
          />
        ))}
      </div>
      <MediaLightbox
        content={lightboxItem}
        onClose={() => setLightboxItem(null)}
        onNavigate={(item) => setLightboxItem(item)}
      />
    </>
  );
}
