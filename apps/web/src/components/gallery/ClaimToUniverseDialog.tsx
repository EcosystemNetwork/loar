import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Globe, Loader2 } from 'lucide-react';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentId: string;
  contentTitle?: string;
}

export function ClaimToUniverseDialog({ open, onOpenChange, contentId, contentTitle }: Props) {
  const { address, isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['universes', 'byCreator', address],
    queryFn: () =>
      trpcClient.universes.getByCreator.query({
        creator: address!,
      }),
    enabled: !!address && open,
  });

  const mine: any[] = (data as any)?.universes ?? (data as any) ?? [];

  const claim = useMutation({
    mutationFn: (universeId: string) =>
      trpcClient.gallery.claimOrphan.mutate({ contentId, universeId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gallery'] });
      queryClient.invalidateQueries({ queryKey: ['wiki', 'gallery'] });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Claim to your universe</DialogTitle>
          <DialogDescription>
            Pick one of your universes to adopt{' '}
            {contentTitle ? `"${contentTitle}"` : 'this content'}. Once claimed, it appears in that
            universe&apos;s gallery and wiki.
          </DialogDescription>
        </DialogHeader>

        {!isAuthenticated ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            Connect your wallet to claim content.
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : mine.length === 0 ? (
          <div className="text-center py-6 text-sm text-muted-foreground">
            You don&apos;t admin any universes yet. Create one first, then come back.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {mine.map((u: any) => {
              const id = u.id ?? u.address;
              const name = u.name ?? `${String(id).slice(0, 10)}…`;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedId(id)}
                  className={`w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                    selectedId === id
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  {u.image_url ? (
                    <img
                      src={resolveIpfsUrl(u.image_url)}
                      alt=""
                      className="h-8 w-8 rounded object-cover"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted flex items-center justify-center">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{id}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {claim.error && (
          <p className="text-xs text-destructive">{(claim.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={claim.isPending}>
            Cancel
          </Button>
          <Button
            disabled={!selectedId || claim.isPending}
            onClick={() => selectedId && claim.mutate(selectedId)}
          >
            {claim.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Claiming…
              </>
            ) : (
              'Claim'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
