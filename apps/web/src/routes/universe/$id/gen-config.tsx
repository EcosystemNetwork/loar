/**
 * Universe Generation Config Page
 *
 * Admin page for configuring AI generation parameters within a universe.
 * Accessible via the Universe Sidebar "Gen Config" button.
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { UniverseGenConfigForm } from '@/components/UniverseGenConfigForm';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Sparkles } from 'lucide-react';

export const Route = createFileRoute('/universe/$id/gen-config')({
  component: GenConfigPage,
});

function GenConfigPage() {
  const { id } = useParams({ from: '/universe/$id/gen-config' });

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/universe/${id}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Sparkles className="h-5 w-5 text-cyan-500" />
        <h1 className="text-xl font-bold">Generation Config</h1>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        Configure how others generate AI content within your universe. Set style constraints, lore
        rules, access control, and revenue splits.
      </p>

      <UniverseGenConfigForm universeAddress={id} />
    </div>
  );
}
