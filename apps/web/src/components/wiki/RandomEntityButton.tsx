import { useNavigate } from '@tanstack/react-router';
import { useQueries } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Shuffle } from 'lucide-react';
import { pickRandom } from './sort';
import type { EntityKind, WikiEntity } from './types';
import { toast } from 'sonner';

interface RandomEntityButtonProps {
  universeAddress?: string;
}

const KINDS: EntityKind[] = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
];

export function RandomEntityButton({ universeAddress }: RandomEntityButtonProps) {
  const navigate = useNavigate();

  // Pre-load a sample from each kind so the button is instant.
  const queries = useQueries({
    queries: KINDS.map((kind) => ({
      queryKey: universeAddress
        ? ['entities', 'list', universeAddress, kind]
        : ['entities', 'listByKind', kind],
      queryFn: () =>
        universeAddress
          ? trpcClient.entities.list.query({ universeAddress, kind })
          : trpcClient.entities.listByKind.query({ kind }),
      staleTime: 60_000,
    })),
  });

  const allEntities: WikiEntity[] = queries.flatMap(
    (q) => (q.data as { entities?: WikiEntity[] } | undefined)?.entities ?? []
  );

  function go() {
    const choice = pickRandom(allEntities);
    if (!choice) {
      toast.info('No entities to pick from yet.');
      return;
    }
    navigate({ to: '/wiki/entity/$id', params: { id: choice.id } });
  }

  return (
    <Button size="sm" variant="outline" onClick={go} title="Jump to a random entity">
      <Shuffle className="h-4 w-4 mr-1" />
      Random
    </Button>
  );
}
