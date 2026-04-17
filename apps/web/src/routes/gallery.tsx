/**
 * Global Gallery Page — Browse all public content across universes.
 * Filterable by media type, sortable by trending/newest/price.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { GalleryGrid } from '@/components/gallery/GalleryGrid';
import { GalleryFilters } from '@/components/gallery/GalleryFilters';
import { useGalleryBrowse, useGalleryTrending } from '@/hooks/useGallery';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Sparkles, TrendingUp } from 'lucide-react';

export const Route = createFileRoute('/gallery')({
  component: GalleryPage,
});

function GalleryPage() {
  const [mediaType, setMediaType] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [originFilter, setOriginFilter] = useState('all');

  const { data: browseData, isLoading } = useGalleryBrowse({
    mediaType: mediaType as any,
    origin: originFilter as any,
    sortBy: sortBy as any,
    limit: 40,
  });

  const { data: trending } = useGalleryTrending(undefined, 8);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Sparkles className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">Gallery</h1>
        <span className="text-muted-foreground text-sm">Discover content across all universes</span>
      </div>

      {/* Trending Section */}
      {trending && trending.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              Trending
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {trending.slice(0, 4).map((item: any) => {
                const isVideo = item.mediaType === 'video' || item.mediaType === 'ai-video';
                const thumbnail =
                  item.thumbnailUrl || item.imageUrl || item.mediaUrl || '/placeholder.jpg';
                return (
                  <div
                    key={item.id}
                    className="relative aspect-video rounded-lg overflow-hidden group cursor-pointer"
                  >
                    {isVideo && item.mediaUrl ? (
                      <video
                        src={
                          item.thumbnailUrl || item.imageUrl
                            ? item.mediaUrl
                            : `${item.mediaUrl}#t=0.5`
                        }
                        className="w-full h-full object-cover"
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        poster={item.thumbnailUrl || item.imageUrl || undefined}
                        onMouseEnter={(e) => e.currentTarget.play()}
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                      />
                    ) : (
                      <img
                        src={thumbnail}
                        alt={item.title || 'Trending'}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                    <div className="absolute bottom-2 left-2 text-white text-xs font-medium">
                      {item.title || 'Untitled'}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <GalleryFilters
        mediaType={mediaType}
        onMediaTypeChange={setMediaType}
        sortBy={sortBy}
        onSortByChange={setSortBy}
        originFilter={originFilter}
        onOriginFilterChange={setOriginFilter}
      />

      {/* Grid */}
      <GalleryGrid
        items={browseData?.items || []}
        isLoading={isLoading}
        emptyMessage="No content yet. Be the first to create something!"
      />
    </div>
  );
}
