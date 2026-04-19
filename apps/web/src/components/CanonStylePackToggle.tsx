/**
 * CanonStylePackToggle — mount on a style_pack entity detail page.
 *
 * When the viewer is an admin of the universe this style pack belongs to,
 * they can mark it as the universe's official canon style or clear the
 * designation. Non-admins see a read-only badge if this pack is canon.
 */
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Crown, Loader2, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { useIsUniverseAdmin } from '@/hooks/useIsUniverseAdmin';

interface Props {
  stylePackEntityId: string;
  universeAddress: string;
}

export function CanonStylePackToggle({ stylePackEntityId, universeAddress }: Props) {
  const queryClient = useQueryClient();
  const { isAdmin } = useIsUniverseAdmin(universeAddress as `0x${string}`);

  const { data: canonData, isLoading } = useQuery({
    queryKey: ['canon-style-pack', universeAddress],
    queryFn: () => trpcClient.universes.getCanonStylePack.query({ universeId: universeAddress }),
  });

  const isCanon = canonData?.canonStylePackEntityId === stylePackEntityId;
  const hasOtherCanon =
    canonData?.canonStylePackEntityId != null &&
    canonData.canonStylePackEntityId !== stylePackEntityId;

  const setCanonMutation = useMutation({
    mutationFn: (nextEntityId: string | null) =>
      trpcClient.universes.setCanonStylePack.mutate({
        universeId: universeAddress,
        stylePackEntityId: nextEntityId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canon-style-pack', universeAddress] });
      queryClient.invalidateQueries({ queryKey: ['universe', universeAddress] });
    },
    onError: (err: any) => {
      toast.error(err?.message ?? 'Failed to update canon style pack');
    },
  });

  // Non-admins who aren't viewing the canon pack get no UI at all.
  if (!isAdmin && !isCanon) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4" />
          <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Canon Style
          </CardTitle>
          {isCanon && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              <Crown className="w-3 h-3 mr-1" />
              Canon
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {isCanon ? (
          <p className="text-xs text-muted-foreground">
            This pack is the official canon style for the universe. New generations auto-inherit it
            unless the creator opts out.
          </p>
        ) : hasOtherCanon ? (
          <p className="text-xs text-muted-foreground">
            Another style pack is currently canon for this universe. Making this pack canon will
            replace the current one.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No canon style pack is set for this universe. Mark this one to auto-apply its look
            across every generation.
          </p>
        )}

        {isAdmin && (
          <div className="flex gap-2">
            {isCanon ? (
              <Button
                size="sm"
                variant="outline"
                disabled={isLoading || setCanonMutation.isPending}
                onClick={() => {
                  if (confirm('Remove this pack as the canon style?')) {
                    setCanonMutation.mutate(null);
                  }
                }}
              >
                {setCanonMutation.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                Clear canon
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={isLoading || setCanonMutation.isPending}
                onClick={() => setCanonMutation.mutate(stylePackEntityId)}
              >
                {setCanonMutation.isPending && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
                <Crown className="w-3 h-3 mr-1" />
                Mark as canon
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
