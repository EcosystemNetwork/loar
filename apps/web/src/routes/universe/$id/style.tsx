/**
 * Universe Style Page
 *
 * Hosts both the canonical visual style lock (UniverseStyleManager) and
 * reusable relight house-look presets (TonePackManager). Owner controls
 * are gated server-side; non-owners see read-only views.
 */
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { UniverseStyleManager } from '@/components/universe/UniverseStyleManager';
import { TonePackManager } from '@/components/universe/TonePackManager';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Palette } from 'lucide-react';

export const Route = createFileRoute('/universe/$id/style')({
  component: UniverseStylePage,
});

function UniverseStylePage() {
  const { id } = useParams({ from: '/universe/$id/style' });
  const { address } = useWalletAuth();
  const universeQuery = useQuery(trpc.universes.get.queryOptions({ id }));

  const universe: any = (universeQuery.data as any)?.data ?? universeQuery.data ?? null;
  const creatorAddr: string | undefined = universe?.creator ?? universe?.creatorUid;
  const isOwner = Boolean(
    address && creatorAddr && creatorAddr.toLowerCase() === address.toLowerCase()
  );

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link to={`/universe/${id}` as any}>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <Palette className="h-5 w-5 text-violet-500" />
        <h1 className="text-xl font-bold">Style & House Looks</h1>
      </div>

      <UniverseStyleManager universeAddress={id} isOwner={isOwner} />

      <TonePackManager universeAddress={id} isOwner={isOwner} />
    </div>
  );
}
