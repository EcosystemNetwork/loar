/**
 * /universe/$id/world — the universe's 3D world: canon coverage in 3D,
 * sets, and bulk tools. Same hub the wiki's World tab shows.
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Globe2 } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { WorldHub } from '@/components/world/WorldHub';

export const Route = createFileRoute('/universe/$id/world/')({
  component: UniverseWorldPage,
});

function UniverseWorldPage() {
  const { id } = useParams({ from: '/universe/$id/world/' });
  const { data: universe } = useQuery({
    queryKey: ['universe', id],
    queryFn: () => trpcClient.universes.get.query({ id }),
  });
  const name = (universe?.data as { name?: string } | undefined)?.name;

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link to="/universe/$id/profile" params={{ id }}>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Back to universe">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Globe2 className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold">{name ? `${name} — World` : 'World'}</h1>
      </div>
      <WorldHub universeId={id} universeName={name} />
    </div>
  );
}
