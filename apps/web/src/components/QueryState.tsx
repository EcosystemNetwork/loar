/**
 * QueryState — Unified loading / error / empty state wrapper.
 *
 * Provides consistent UX across all data-fetching pages:
 * - Loading: skeleton grid or centered spinner
 * - Error: message + retry button
 * - Empty: icon + message + optional CTA
 * - Success: renders children
 */

import { type ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/states';

interface QueryStateProps {
  /** Query is currently loading */
  isLoading: boolean;
  /** Query encountered an error */
  isError: boolean;
  /** Data is loaded but empty */
  isEmpty?: boolean;
  /** Retry callback — shown on error states */
  onRetry?: () => void;
  /** Custom error message */
  errorMessage?: string;
  /** Content to render when data is empty */
  emptyState?: ReactNode;
  /** Content to render while loading — defaults to skeleton grid */
  loadingState?: ReactNode;
  /** Number of skeleton cards to show (default: 8) */
  skeletonCount?: number;
  /** Aspect ratio class for skeleton cards (default: "aspect-[4/5]") */
  skeletonAspect?: string;
  /** Grid class for skeleton layout */
  skeletonGrid?: string;
  /** Children rendered on success */
  children: ReactNode;
}

export function QueryState({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  errorMessage,
  emptyState,
  loadingState,
  skeletonCount = 8,
  skeletonAspect = 'aspect-[4/5]',
  skeletonGrid = 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4',
  children,
}: QueryStateProps) {
  if (isLoading) {
    return (
      loadingState ?? (
        <div className={skeletonGrid}>
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <Skeleton key={i} className={`rounded-xl ${skeletonAspect}`} />
          ))}
        </div>
      )
    );
  }

  if (isError) {
    return <ErrorState variant="card" description={errorMessage} onRetry={onRetry} />;
  }

  if (isEmpty) {
    return <>{emptyState ?? null}</>;
  }

  return <>{children}</>;
}
