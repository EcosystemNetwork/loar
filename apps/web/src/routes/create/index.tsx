/**
 * Create — one prompt window for everything.
 *
 * Higgsfield-style generation console: a single prompt drives image, video,
 * voice, audio, 3D, and world-entity (person / place / faction / lore …)
 * generation, with a picker for which wiki (universe) the output publishes
 * into. The old grid-of-cards hub is gone; the detailed entity forms live on
 * at `/create/$kind` and are linked from each result. "Your Universes" now
 * lives on the Studio tab.
 */
import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { trpcClient } from '@/utils/trpc';
import { GenerateConsole } from '@/components/sandbox/GenerateConsole';
import { RandomUniverseBuilder } from '@/components/RandomUniverseBuilder';

function CreateHub() {
  const { universe: universeAddress } = useSearch({ from: '/create/' });

  const { data: universeResult } = useQuery({
    queryKey: ['universe', universeAddress],
    queryFn: () => trpcClient.universes.get.query({ id: universeAddress! }),
    enabled: !!universeAddress,
  });
  const universeInfo = universeResult?.data as { id: string; name?: string } | undefined;

  return (
    <>
      <GenerateConsole variant="console" enableWorldKinds initialUniverse={universeAddress} />
      {universeAddress && (
        <div className="container mx-auto px-4 pb-bottom-nav md:pb-12 max-w-6xl">
          <RandomUniverseBuilder
            universeAddress={universeAddress}
            universeName={universeInfo?.name}
          />
        </div>
      )}
    </>
  );
}

const createHubSearchSchema = z.object({
  universe: z.string().optional(),
});

export const Route = createFileRoute('/create/')({
  component: CreateHub,
  validateSearch: createHubSearchSchema,
});
