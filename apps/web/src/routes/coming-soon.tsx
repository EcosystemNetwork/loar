/**
 * Coming Soon — Placeholder for features not yet publicly available.
 * Partial-feature routes redirect here during beta.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Construction, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const Route = createFileRoute('/coming-soon')({
  component: ComingSoon,
});

function ComingSoon() {
  return (
    <div className="container mx-auto px-4 py-24 flex flex-col items-center justify-center text-center gap-6 max-w-lg">
      <Construction className="h-16 w-16 text-muted-foreground" />
      <h1 className="text-3xl font-bold tracking-tight">Coming Soon</h1>
      <p className="text-muted-foreground text-lg">
        This feature is under active development and will be available in a future release. Check
        back soon!
      </p>
      <Link to="/discover">
        <Button variant="outline" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Discover
        </Button>
      </Link>
    </div>
  );
}
