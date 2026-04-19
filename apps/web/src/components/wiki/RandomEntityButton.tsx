import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Shuffle, Loader2 } from 'lucide-react';
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
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  async function fetchKind(kind: EntityKind): Promise<WikiEntity[]> {
    const queryKey = universeAddress
      ? ['entities', 'list', universeAddress, kind]
      : ['entities', 'listByKind', kind];
    const data = await queryClient.fetchQuery({
      queryKey,
      queryFn: () =>
        universeAddress
          ? trpcClient.entities.list.query({ universeAddress, kind })
          : trpcClient.entities.listByKind.query({ kind }),
      staleTime: 60_000,
    });
    return ((data as { entities?: WikiEntity[] } | undefined)?.entities ?? []) as WikiEntity[];
  }

  async function go() {
    if (loading) return;
    setLoading(true);
    try {
      // Try a random kind first, then fall back through the rest so the
      // button still works even when most kinds are empty.
      const order = [...KINDS].sort(() => Math.random() - 0.5);
      for (const kind of order) {
        const entities = await fetchKind(kind);
        const choice = pickRandom(entities);
        if (choice) {
          navigate({ to: '/wiki/entity/$id', params: { id: choice.id } });
          return;
        }
      }
      toast.info('No entities to pick from yet.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not pick a random entity.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={go}
      disabled={loading}
      title="Jump to a random entity"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <Shuffle className="h-4 w-4 mr-1" />
      )}
      Random
    </Button>
  );
}
