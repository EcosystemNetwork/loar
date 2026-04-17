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
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

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
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="p-3 rounded-full bg-destructive/10 mb-4">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Something went wrong</h3>
        <p className="text-muted-foreground text-sm max-w-md mb-4">
          {errorMessage || 'Failed to load data. Please check your connection and try again.'}
        </p>
        {onRetry && (
          <Button variant="outline" onClick={onRetry} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Try Again
          </Button>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return <>{emptyState ?? null}</>;
  }

  return <>{children}</>;
}

/** Centered spinner for inline loading (e.g., inside a card or sidebar) */
export function InlineLoader({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center py-12 ${className}`}>
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/**
 * AuthRequired — Shown when a page needs authentication but user isn't signed in.
 * Replaces blank/empty states on pages that silently require auth.
 */
export function AuthRequired({
  message = 'Sign in to access this page.',
  action,
}: {
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="p-4 rounded-full bg-muted mb-4">
        <AlertCircle className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">Sign in required</h3>
      <p className="text-muted-foreground text-sm max-w-md mb-4">{message}</p>
      {action}
    </div>
  );
}
