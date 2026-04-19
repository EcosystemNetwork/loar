/**
 * Admin Universes Dashboard — hide / unhide universes (soft-delete).
 *
 * Hiding only sets `isHidden: true` on the Firestore doc; the on-chain
 * contract is untouched and the universe's gallery content keeps its
 * `universeId` reference (so it still appears in the global gallery).
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { Shield, EyeOff, Eye, Loader2, Search, Trash2 } from 'lucide-react';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

export const Route = createFileRoute('/admin/universes')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/universes' } });
    }
  },
  component: AdminUniversesDashboard,
});

function AdminUniversesDashboard() {
  const { isAuthenticated, isAuthenticating, address } = useWalletAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());

  const { data, isLoading } = useQuery({
    queryKey: ['admin-universes'],
    queryFn: () => trpcClient.universes.adminList.query(),
    enabled: isAuthenticated && isAdmin,
  });

  const setHiddenMutation = useMutation({
    mutationFn: (vars: { universeId: string; isHidden: boolean }) =>
      trpcClient.universes.setHidden.mutate(vars),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-universes'] });
      toast.success(vars.isHidden ? 'Universe hidden' : 'Universe restored');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update universe');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (vars: { universeId: string; reason?: string }) =>
      trpcClient.universes.adminDelete.mutate(vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-universes'] });
      toast.success('Universe permanently deleted');
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to delete universe');
    },
  });

  const items = useMemo(() => {
    const list = ((data as any)?.data ?? []) as any[];
    if (!search.trim()) return list;
    const term = search.trim().toLowerCase();
    return list.filter(
      (u) =>
        u.id?.toLowerCase().includes(term) ||
        u.name?.toLowerCase().includes(term) ||
        u.creator?.toLowerCase().includes(term)
    );
  }, [data, search]);

  if (isAuthenticating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <Shield className="h-12 w-12 mx-auto text-red-400" />
          <h2 className="text-xl font-bold">Unauthorized</h2>
          <p className="text-muted-foreground text-sm">
            Your wallet address does not have admin access.
          </p>
        </div>
      </div>
    );
  }

  const visibleCount = items.filter((u) => !u.isHidden).length;
  const hiddenCount = items.filter((u) => u.isHidden).length;

  return (
    <div className="min-h-screen bg-background p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6" /> Universes Admin
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Hide old / test universes from public lists. Content stays in the global gallery.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Eye className="h-7 w-7 text-green-500" />
            <div>
              <p className="text-2xl font-bold">{visibleCount}</p>
              <p className="text-xs text-muted-foreground">Visible</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <EyeOff className="h-7 w-7 text-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{hiddenCount}</p>
              <p className="text-xs text-muted-foreground">Hidden</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="relative mb-4">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, address, or creator"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin" />
        </div>
      ) : !items.length ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No universes found.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((u: any) => (
            <Card key={u.id} className={u.isHidden ? 'opacity-60' : undefined}>
              <CardContent className="p-4 flex items-center gap-4">
                {u.image_url ? (
                  <img
                    src={resolveIpfsUrl(u.image_url)}
                    alt={u.name ?? u.id}
                    className="h-14 w-14 rounded object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="h-14 w-14 rounded bg-muted flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold truncate">{u.name ?? 'Untitled'}</span>
                    {u.isHidden ? (
                      <Badge variant="outline" className="text-[10px]">
                        Hidden
                      </Badge>
                    ) : null}
                    {u.chainId ? (
                      <Badge variant="outline" className="text-[10px]">
                        chain {u.chainId}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground truncate font-mono">{u.id}</p>
                  {u.creator ? (
                    <p className="text-[10px] text-muted-foreground truncate">
                      creator {u.creator}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {u.isHidden ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setHiddenMutation.mutate({ universeId: u.id, isHidden: false })
                      }
                      disabled={setHiddenMutation.isPending || deleteMutation.isPending}
                    >
                      <Eye className="h-3 w-3 mr-1" />
                      Restore
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        if (
                          confirm(
                            `Hide "${u.name ?? u.id}"? It will be removed from public lists. Its gallery content will stay visible.`
                          )
                        ) {
                          setHiddenMutation.mutate({ universeId: u.id, isHidden: true });
                        }
                      }}
                      disabled={setHiddenMutation.isPending || deleteMutation.isPending}
                    >
                      <EyeOff className="h-3 w-3 mr-1" />
                      Hide
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      const label = u.name ?? u.id;
                      const typed = prompt(
                        `PERMANENTLY DELETE "${label}"?\n\nThis removes the universe from every listing and cannot be undone. The on-chain contract is not affected, and existing gallery content keeps its reference.\n\nType DELETE to confirm:`
                      );
                      if (typed !== 'DELETE') return;
                      const reason = prompt('Reason (optional, saved to audit log):') ?? undefined;
                      deleteMutation.mutate({ universeId: u.id, reason });
                    }}
                    disabled={setHiddenMutation.isPending || deleteMutation.isPending}
                    title="Permanently delete this universe"
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
