/**
 * /world — front door for 3D world-building. Explains what it does in three
 * steps, then lists the caller's own universes first (where they can build)
 * and every public universe after (to explore). Each tile opens
 * /universe/$id/world.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Box, Clapperboard, Footprints, Globe2, KeyRound, Map as MapIcon } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { SmartImage } from '@/components/SmartImage';

export const Route = createFileRoute('/world')({
  component: WorldLanding,
});

interface UniverseTile {
  id: string;
  name?: string;
  image_url?: string;
  imageURL?: string;
}

const STEPS = [
  {
    icon: Box,
    title: 'Turn your wiki into 3D',
    body: 'Every character, prop and vehicle becomes a 3D model, generated from its wiki art in one click.',
  },
  {
    icon: Footprints,
    title: 'Bring characters to life',
    body: 'Build a rigged, animated puppet. Its turnaround sheet keeps the character on-model in every video you generate.',
  },
  {
    icon: Clapperboard,
    title: 'Stage, shoot and explore',
    body: 'Arrange scenes in 3D sets built from your places, capture shots as video start frames, and publish sets fans can walk through.',
  },
];

function WorldLanding() {
  const { address, isAuthenticated } = useWalletAuth();

  const { data: mine } = useQuery({
    queryKey: ['world', 'my-universes', address],
    queryFn: async () => {
      try {
        return await trpcClient.universes.getEditableByMe.query();
      } catch {
        return await trpcClient.universes.getByCreator.query({ creator: address! });
      }
    },
    enabled: !!address && isAuthenticated,
  });
  const { data: all } = useQuery({
    queryKey: ['all-universes'],
    queryFn: () => trpcClient.universes.getAll.query(),
  });

  const mineList = (((mine as any)?.data ?? mine ?? []) as UniverseTile[]).filter((u) => u?.id);
  const mineIds = new Set(mineList.map((u) => u.id.toLowerCase()));
  const publicList = (((all as any)?.data ?? all ?? []) as UniverseTile[]).filter(
    (u) => u?.id && u.name && !mineIds.has(u.id.toLowerCase())
  );

  return (
    <div className="container mx-auto max-w-6xl space-y-10 px-4 py-8">
      <header className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Globe2 className="h-4 w-4" />
          3D World
        </div>
        <h1 className="font-lore text-3xl font-semibold sm:text-4xl">Build your universe in 3D</h1>
        <p className="max-w-2xl text-muted-foreground">
          Pick a universe below. Its World page shows every character, prop and place, what already
          exists in 3D, and the buttons to build the rest.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded-2xl border bg-card/60 p-5">
            <div className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
                <s.icon className="h-4 w-4" />
              </span>
              <span className="text-xs font-semibold text-muted-foreground">Step {i + 1}</span>
            </div>
            <h2 className="font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed p-4 text-sm">
        <KeyRound className="h-4 w-4 text-primary" />
        <span className="text-muted-foreground">
          3D generation runs on your own Tripo3D key (about $0.40 a model).
        </span>
        <Button asChild size="sm" variant="outline">
          <Link to="/settings/api-keys">Add Tripo key</Link>
        </Button>
      </div>

      {isAuthenticated && (
        <UniverseGrid
          title="Your universes"
          hint="Build here: generate models, puppets and environments, and make sets."
          list={mineList}
          empty="You don't own a universe yet."
        />
      )}
      <UniverseGrid
        title={isAuthenticated ? 'Explore other worlds' : 'Explore worlds'}
        hint="Walk through published sets and browse 3D canon."
        list={publicList}
        empty="No public universes yet."
      />
    </div>
  );
}

function UniverseGrid({
  title,
  hint,
  list,
  empty,
}: {
  title: string;
  hint: string;
  list: UniverseTile[];
  empty: string;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{hint}</p>
      </div>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((u) => {
            const img = u.image_url ?? u.imageURL;
            return (
              <Link
                key={u.id}
                to="/universe/$id/world"
                params={{ id: u.id }}
                className="group overflow-hidden rounded-xl border hover:border-primary/50"
              >
                <div className="aspect-video bg-muted/30">
                  {img ? (
                    <SmartImage
                      src={img}
                      alt={u.name ?? ''}
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <MapIcon className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 p-2.5">
                  <span className="truncate text-sm font-medium">
                    {u.name || 'Untitled universe'}
                  </span>
                  <span className="shrink-0 text-xs text-primary opacity-0 transition group-hover:opacity-100">
                    Open →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
