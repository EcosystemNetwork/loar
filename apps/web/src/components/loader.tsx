/**
 * Full-page Loader
 *
 * Centered spinning indicator used during route transitions and data fetching.
 */

import { Loader2 } from 'lucide-react';

export default function Loader() {
  return (
    <div className="flex h-full items-center justify-center pt-8">
      <Loader2 className="animate-spin" />
    </div>
  );
}
