/**
 * Universe Gallery Page
 *
 * Browse all public content generated within a specific universe.
 * Features trending, featured, and filterable grid views.
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { GalleryGrid } from '@/components/gallery/GalleryGrid';
import { GalleryFilters } from '@/components/gallery/GalleryFilters';
import { CommissionDialog } from '@/components/gallery/CommissionDialog';
import { useGalleryBrowse, useGalleryFeatured, useGalleryTrending } from '@/hooks/useGallery';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Star, TrendingUp, Film } from 'lucide-react';

export const Route = createFileRoute('/universe/$id/gallery')({
  component: UniverseGalleryPage,
});

function UniverseGalleryPage() {
  const { id } = useParams({ from: '/universe/$id/gallery' });
  const [mediaType, setMediaType] = useState('all');
  const [sortBy, setSortBy] = useState('newest');
  const [commissionTarget, setCommissionTarget] = useState<any>(null);

  const { data: browseData, isLoading } = useGalleryBrowse({
    universeId: id,
    mediaType: mediaType as any,
    sortBy: sortBy as any,
    limit: 40,
  });

  const { data: featured } = useGalleryFeatured(id);
  const { data: trending } = useGalleryTrending(id, 6);

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to={`/universe/${id}` as any}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Film className="h-5 w-5 text-pink-500" />
        <h1 className="text-xl font-bold">Universe Gallery</h1>
      </div>

      {/* Featured Section */}
      {featured && featured.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 text-yellow-500" />
              Featured
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {featured.map((item: any) => (
                <div
                  key={item.id}
                  className="relative aspect-video rounded-lg overflow-hidden group cursor-pointer"
                >
                  <img
                    src={item.thumbnailUrl || item.imageUrl || '/placeholder.jpg'}
                    alt={item.title || 'Featured'}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-2 left-2 text-white text-xs font-medium">
                    {item.title || 'Untitled'}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Trending */}
      {trending && trending.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-orange-500" />
              Trending in this Universe
            </CardTitle>
          </CardHeader>
          <CardContent>
            <GalleryGrid items={trending} />
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <GalleryFilters
        mediaType={mediaType}
        onMediaTypeChange={setMediaType}
        sortBy={sortBy}
        onSortByChange={setSortBy}
      />

      {/* All Content */}
      <GalleryGrid
        items={browseData?.items || []}
        isLoading={isLoading}
        emptyMessage="No content in this universe yet. Start generating!"
      />

      {/* Commission Dialog */}
      {commissionTarget && (
        <CommissionDialog
          open={!!commissionTarget}
          onOpenChange={() => setCommissionTarget(null)}
          artistUid={commissionTarget.creatorUid}
          artistName={commissionTarget.creatorAddress}
          universeId={id}
        />
      )}
    </div>
  );
}
