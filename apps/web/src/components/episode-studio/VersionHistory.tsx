/**
 * VersionHistory — restore points the server keeps for an episode (every manual
 * save, and autosaves at most every 10 minutes; the newest 30).
 *
 * Restoring hands the snapshot back to the page, which applies it as an
 * ordinary undoable edit — so a wrong restore is one ⌘Z away.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { trpcClient } from '@/utils/trpc';
import { cutFromEpisode, type Cut } from '@/lib/episodeCut';

export interface RestoredVersion {
  title: string;
  description: string;
  cut: Cut;
}

interface VersionHistoryProps {
  episodeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestore: (version: RestoredVersion) => void;
}

export function VersionHistory({ episodeId, open, onOpenChange, onRestore }: VersionHistoryProps) {
  const [restoring, setRestoring] = useState<string | null>(null);
  const versions = useQuery({
    queryKey: ['episodeVersions', episodeId],
    queryFn: () => trpcClient.episodes.listVersions.query({ episodeId }),
    enabled: open,
  });

  const restore = async (versionId: string) => {
    setRestoring(versionId);
    try {
      const v = await trpcClient.episodes.getVersion.query({ episodeId, versionId });
      onRestore({
        title: v.title,
        description: v.description,
        cut: cutFromEpisode({
          clips: v.clips as Cut['clips'],
          overlays: v.overlays as Cut['overlays'],
          soundtrack: v.soundtrack as Cut['soundtrack'],
          audioMix: v.audioMix,
        }),
      });
      onOpenChange(false);
      toast.success('Version restored', { description: 'Press ⌘Z / Ctrl+Z to undo.' });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not restore that version');
    } finally {
      setRestoring(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Version history
          </DialogTitle>
          <DialogDescription>
            Restore an earlier cut of this episode. Your current edits stay in undo history.
          </DialogDescription>
        </DialogHeader>

        {versions.isLoading && (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
        {versions.isError && (
          <p className="text-sm text-destructive">Couldn’t load the history. Try again shortly.</p>
        )}
        {versions.data && versions.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No versions yet — one is saved each time you press Save or export, and periodically as
            you edit.
          </p>
        )}
        <ul className="divide-y divide-border rounded-md border border-border">
          {versions.data?.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {new Date(v.createdAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[9px]">
                    {v.kind === 'manual' ? 'Saved' : 'Auto'}
                  </Badge>
                  {v.clipCount} clip{v.clipCount === 1 ? '' : 's'}
                  {v.title ? ` · ${v.title}` : ''}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={restoring !== null}
                onClick={() => restore(v.id)}
              >
                {restoring === v.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Restore'}
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
