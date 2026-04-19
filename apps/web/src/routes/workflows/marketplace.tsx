import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Coins, Crown, Workflow as WorkflowIcon, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useWorkflowMarketplace, usePurchaseWorkflow, useMyLicenses } from '@/hooks/useWorkflows';

type Lens = 'all' | 'paid' | 'canon';

export const Route = createFileRoute('/workflows/marketplace')({
  component: WorkflowMarketplacePage,
});

function WorkflowMarketplacePage() {
  const [lens, setLens] = useState<Lens>('all');
  const visibility = lens === 'all' ? undefined : lens;
  const { data, isLoading } = useWorkflowMarketplace({ visibility });
  const { data: myLic } = useMyLicenses();
  const purchase = usePurchaseWorkflow();
  const navigate = useNavigate();

  const ownedIds = new Set((myLic?.licenses ?? []).map((l) => l.workflowId));

  return (
    <div className="container mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflow marketplace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paid presets and canon-official workflows you can buy or run.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/workflows">My workflows</Link>
        </Button>
      </div>

      <Tabs value={lens} onValueChange={(v) => setLens(v as Lens)}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="paid">
            <Coins className="mr-1 h-3 w-3" /> Paid
          </TabsTrigger>
          <TabsTrigger value="canon">
            <Crown className="mr-1 h-3 w-3" /> Canon
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (data?.entries.length ?? 0) === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing published yet for this lens.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data?.entries.map((entry) => {
              const w = entry.workflow;
              const owned = ownedIds.has(w.id);
              return (
                <div key={w.id} className="rounded-md border bg-card p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to="/workflows/$id"
                      params={{ id: w.id }}
                      className="flex min-w-0 items-center gap-2 font-semibold hover:underline"
                    >
                      <WorkflowIcon className="h-4 w-4 shrink-0" />
                      <span className="truncate">{w.name}</span>
                    </Link>
                    <Badge variant="outline" className="shrink-0">
                      {entry.visibility === 'canon' ? (
                        <span className="flex items-center gap-1">
                          <Crown className="h-3 w-3" /> canon
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Coins className="h-3 w-3" /> {entry.priceCredits} cr
                        </span>
                      )}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {w.graph.nodes.length} nodes · v{w.version}
                    {entry.universeAddress
                      ? ` · ${entry.universeAddress.slice(0, 6)}…${entry.universeAddress.slice(-4)}`
                      : ''}
                  </div>
                  {w.description && (
                    <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {w.description}
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    {entry.visibility === 'paid' && !owned ? (
                      <Button
                        size="sm"
                        disabled={purchase.isPending}
                        onClick={() =>
                          purchase.mutate(w.id, {
                            onSuccess: () => {
                              toast.success(`Purchased — ${entry.priceCredits} credits`);
                              navigate({ to: '/workflows/$id', params: { id: w.id } });
                            },
                            onError: (err: any) => toast.error(err?.message ?? 'Purchase failed'),
                          })
                        }
                      >
                        <ShoppingCart className="mr-1 h-3 w-3" />
                        Buy {entry.priceCredits} cr
                      </Button>
                    ) : (
                      <Button asChild size="sm" variant="outline">
                        <Link to="/workflows/$id" params={{ id: w.id }}>
                          Open
                        </Link>
                      </Button>
                    )}
                    {owned && (
                      <Badge variant="secondary" className="text-[10px]">
                        owned
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
