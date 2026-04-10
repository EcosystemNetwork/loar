/**
 * Gallery Filters — Filter bar for the gallery/discovery pages.
 */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, SlidersHorizontal } from 'lucide-react';

interface GalleryFiltersProps {
  mediaType: string;
  onMediaTypeChange: (type: string) => void;
  sortBy: string;
  onSortByChange: (sort: string) => void;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
}

const MEDIA_TYPES = [
  { value: 'all', label: 'All' },
  { value: 'video', label: 'Video' },
  { value: 'image', label: 'Image' },
  { value: 'audio', label: 'Audio' },
  { value: '3d', label: '3D' },
];

const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'trending', label: 'Trending' },
  { value: 'price_asc', label: 'Price: Low' },
  { value: 'price_desc', label: 'Price: High' },
];

export function GalleryFilters({
  mediaType,
  onMediaTypeChange,
  sortBy,
  onSortByChange,
  searchQuery,
  onSearchChange,
}: GalleryFiltersProps) {
  return (
    <div className="space-y-3">
      {/* Search */}
      {onSearchChange && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search content..."
            value={searchQuery || ''}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        {/* Media type pills */}
        <div className="flex items-center gap-1 overflow-x-auto">
          {MEDIA_TYPES.map((type) => (
            <Button
              key={type.value}
              variant={mediaType === type.value ? 'default' : 'outline'}
              size="sm"
              className="h-7 text-xs whitespace-nowrap"
              onClick={() => onMediaTypeChange(type.value)}
            >
              {type.label}
            </Button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          {SORT_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={sortBy === option.value ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs whitespace-nowrap"
              onClick={() => onSortByChange(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
