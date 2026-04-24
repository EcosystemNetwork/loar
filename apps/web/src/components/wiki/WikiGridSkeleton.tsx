import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface WikiGridSkeletonProps {
  count?: number;
  aspect?: 'video' | 'square';
  layout?: 'grid' | 'row';
}

export function WikiGridSkeleton({
  count = 8,
  aspect = 'video',
  layout = 'grid',
}: WikiGridSkeletonProps) {
  const aspectClass = aspect === 'square' ? 'aspect-square' : 'aspect-video';

  if (layout === 'row') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <Card key={i}>
            <div className="flex gap-4 p-4">
              <Skeleton className="w-20 h-20 rounded-full flex-shrink-0" />
              <div className="flex-1 min-w-0 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <Skeleton className={`${aspectClass} w-full rounded-none`} />
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-3/4" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
