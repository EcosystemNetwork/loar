/**
 * PublishEpisodeDialog — one-button terminal mint flow for the editor (E6).
 *
 * Wraps the editor's current video URL into a single-clip episode, optionally
 * also publishing it as universe canon. The flow:
 *
 *   1. User picks one of their universes (or universes they admin)
 *   2. Fills in title + description
 *   3. (Optional) checks "Publish as canon" to also fire publishAsCanon
 *   4. Server creates the episode + (optional) canon record
 *
 * No wallet popup. The canon submission, if requested, currently runs in
 * "fun" mode (no on-chain tx required); monetized universes will need the
 * Circle DCW Episode-NFT mint wired in once `EpisodeNFT.createEpisode` is
 * available on the agent owner's wallet (G1's `onchain.nft.mintEpisode`
 * action covers the pipeline path; this dialog is the manual path).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';

interface PublishEpisodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoUrl: string | null;
}

interface Universe {
  id: string;
  name: string;
  monetized?: boolean;
}

export function PublishEpisodeDialog({ open, onOpenChange, videoUrl }: PublishEpisodeDialogProps) {
  const { address } = useWalletAuth();
  const queryClient = useQueryClient();

  const [universeId, setUniverseId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [publishAsCanon, setPublishAsCanon] = useState(false);

  const universesQuery = useQuery({
    queryKey: ['universes', 'byCreator', address],
    queryFn: () => trpcClient.universes.getByCreator.query({ creator: address! }),
    enabled: !!address && open,
  });

  const universes = (universesQuery.data as { data?: Universe[] } | Universe[] | undefined) ?? [];
  const universeList: Universe[] = Array.isArray(universes) ? universes : (universes.data ?? []);

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!videoUrl) throw new Error('No video to publish');
      if (!universeId) throw new Error('Pick a universe first');
      if (!title.trim()) throw new Error('Title required');

      // 1. Create the episode (single clip wrapping the editor's current video)
      const episode = (await trpcClient.episodes.create.mutate({
        universeId,
        title: title.trim(),
        description: description.trim(),
        clips: [
          {
            nodeId: `editor-${Date.now()}`,
            label: title.trim(),
            videoUrl,
            trimStart: 0,
            trimEnd: 0,
          },
        ],
      })) as { id: string };

      // 2. Optionally publish as canon (off-chain "fun" path for v1)
      if (publishAsCanon) {
        await trpcClient.episodes.publishAsCanon.mutate({
          episodeId: episode.id,
          // bypassCanonCheck false by default — let the Z.AI advisory run
        });
      }

      return episode;
    },
    onSuccess: (episode) => {
      toast.success(publishAsCanon ? 'Episode published as canon!' : 'Episode saved as draft');
      queryClient.invalidateQueries({ queryKey: ['wiki', 'episodes'] });
      queryClient.invalidateQueries({ queryKey: ['episodes'] });
      onOpenChange(false);
      // Reset
      setTitle('');
      setDescription('');
      setPublishAsCanon(false);
      // Surface the new episode id so the editor caller can navigate.
      window.dispatchEvent(
        new CustomEvent('loar:episode-published', { detail: { episodeId: episode.id } })
      );
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Publish failed');
    },
  });

  const canSubmit = !!videoUrl && !!universeId && title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="w-4 h-4" />
            Publish as Episode
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="universe">Universe</Label>
            <Select
              value={universeId}
              onValueChange={setUniverseId}
              disabled={universesQuery.isLoading}
            >
              <SelectTrigger id="universe">
                <SelectValue
                  placeholder={
                    universesQuery.isLoading ? 'Loading…' : 'Pick a universe to publish into'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {universeList.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!universesQuery.isLoading && universeList.length === 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                You don't own any universes yet — create one from <code>/create</code> first.
              </p>
            )}
          </div>

          <div>
            <Label htmlFor="episode-title">Title</Label>
            <Input
              id="episode-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Episode title"
              maxLength={200}
            />
          </div>

          <div>
            <Label htmlFor="episode-desc">Description</Label>
            <Input
              id="episode-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary (optional)"
              maxLength={2000}
            />
          </div>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={publishAsCanon}
              onChange={(e) => setPublishAsCanon(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Also publish as canon</span>
              <span className="block text-xs text-muted-foreground">
                One-way: makes this episode official universe canon. Monetized universes require a
                separate on-chain mint after publish.
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => publishMutation.mutate()}
              disabled={!canSubmit || publishMutation.isPending}
            >
              {publishMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Publishing…
                </>
              ) : publishAsCanon ? (
                'Publish as Canon'
              ) : (
                'Save as Episode'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
