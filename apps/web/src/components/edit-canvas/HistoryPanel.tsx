/**
 * HistoryPanel — version chain for the asset.
 *
 * Shows every version newest-first with a "Make current" action. Non-
 * destructive: setCurrentVersion just flips `isCurrent`, it doesn't delete.
 */

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { trpcClient } from '@/utils/trpc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, CheckCircle2 } from 'lucide-react';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

export function HistoryPanel({
  contentId,
  onRevert,
}: {
  contentId: string;
  onRevert?: (mediaUrl: string) => void;
}) {
  const qc = useQueryClient();
  const versionsQuery = useQuery({
    queryKey: ['editJobs', 'listVersions', contentId],
    queryFn: () => trpcClient.editJobs.listVersions.query({ contentId }),
    staleTime: 5_000,
  });

  const revertMutation = useMutation({
    mutationFn: async (versionId: string) => {
      return trpcClient.editJobs.setCurrentVersion.mutate({ contentId, versionId });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['editJobs', 'listVersions', contentId] });
      toast.success('Version set as current');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to set current'),
  });

  const versions = versionsQuery.data?.versions ?? [];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="h-4 w-4" />
          Version history
          <span className="ml-auto text-xs text-muted-foreground">{versions.length} total</span>
        </div>
        {versions.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No versions yet. Submit an edit to create v2.
          </div>
        ) : (
          <ol className="space-y-2">
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex items-center gap-3 rounded border border-border/40 p-2 text-xs"
              >
                {v.mediaUrl ? (
                  <img
                    src={resolveIpfsUrl(v.mediaUrl)}
                    alt=""
                    className="h-10 w-10 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="h-10 w-10 rounded bg-muted shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">v{v.versionNumber}</span>
                    <span className="text-muted-foreground truncate">· {v.label}</span>
                    {v.isCurrent && (
                      <Badge variant="secondary" className="text-[9px] h-4 px-1 gap-0.5">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        current
                      </Badge>
                    )}
                  </div>
                  {v.provenance?.model && (
                    <div className="text-[10px] text-muted-foreground truncate">
                      {v.provenance.model}
                      {v.provenance.prompt ? ` · ${v.provenance.prompt}` : ''}
                    </div>
                  )}
                </div>
                {!v.isCurrent && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[10px]"
                    disabled={revertMutation.isPending}
                    onClick={() => {
                      revertMutation.mutate(v.id);
                      onRevert?.(v.mediaUrl);
                    }}
                  >
                    Make current
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
