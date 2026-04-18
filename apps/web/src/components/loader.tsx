/**
 * Full-page Loader
 *
 * Centered spinning indicator used during route transitions and data fetching.
 * Accepts an optional message to give users context about what's happening.
 */

import { Loader2 } from 'lucide-react';

interface LoaderProps {
  message?: string;
  className?: string;
}

export default function Loader({ message, className = '' }: LoaderProps) {
  return (
    <div className={`flex flex-col h-full items-center justify-center gap-3 pt-8 ${className}`}>
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      {message && <p className="text-sm text-muted-foreground animate-pulse">{message}</p>}
    </div>
  );
}
