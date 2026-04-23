/**
 * Reusable endorse button.
 *
 * Drop anywhere a curator might want to signal "this is worth looking at":
 * entity cards, universe pages, content tiles. Shows the current aggregate
 * score and, for the viewer, their own endorsement weight (if any).
 */
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { trpcClient, queryClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Loader2, Sparkles, Trash2 } from 'lucide-react';

export type CurationTargetType = 'entity' | 'universe' | 'content';

interface EndorseButtonProps {
  targetType: CurationTargetType;
  targetId: string;
  /** Optional universe scope — surfaced in leaderboard filters. */
  universeAddress?: string | null;
  /** `inline` (compact row) or `block` (bigger, standalone). */
  variant?: 'inline' | 'block';
  className?: string;
}

export function EndorseButton({
  targetType,
  targetId,
  universeAddress,
  variant = 'inline',
  className,
}: EndorseButtonProps) {
  const { isAuthenticated } = useWalletAuth();

  const scoreQuery = useQuery({
    queryKey: ['curation', 'score', targetType, targetId],
    queryFn: () => trpcClient.curation.scoreFor.query({ targetType, targetId }),
  });

  const mineQuery = useQuery({
    queryKey: ['curation', 'mine', targetType, targetId],
    queryFn: () => trpcClient.curation.myEndorsement.query({ targetType, targetId }),
    enabled: isAuthenticated,
  });

  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState(3);
  const [note, setNote] = useState('');

  const endorseMutation = useMutation({
    mutationFn: async () =>
      trpcClient.curation.endorse.mutate({
        targetType,
        targetId,
        weight,
        note: note.trim() || undefined,
        universeAddress: universeAddress ?? undefined,
      }),
    onSuccess: () => {
      toast.success('Endorsement saved');
      setOpen(false);
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['curation', 'score', targetType, targetId] });
      queryClient.invalidateQueries({ queryKey: ['curation', 'mine', targetType, targetId] });
      queryClient.invalidateQueries({ queryKey: ['curation', 'leaderboard'] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Could not endorse'),
  });

  const revokeMutation = useMutation({
    mutationFn: async () => trpcClient.curation.revoke.mutate({ targetType, targetId }),
    onSuccess: () => {
      toast.success('Endorsement revoked');
      queryClient.invalidateQueries({ queryKey: ['curation', 'score', targetType, targetId] });
      queryClient.invalidateQueries({ queryKey: ['curation', 'mine', targetType, targetId] });
      queryClient.invalidateQueries({ queryKey: ['curation', 'leaderboard'] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Could not revoke'),
  });

  const score = scoreQuery.data?.score ?? 0;
  const endorsers = scoreQuery.data?.endorsers ?? 0;
  const mine = mineQuery.data?.endorsement ?? null;

  if (variant === 'inline') {
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isAuthenticated) {
              toast.error('Sign in to endorse');
              return;
            }
            setWeight(mine?.weight ?? 3);
            setNote(mine?.note ?? '');
            setOpen(true);
          }}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${
            mine
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
              : 'border-muted-foreground/30 bg-muted/40 text-muted-foreground hover:bg-muted'
          } ${className ?? ''}`}
          title={mine ? `Your endorsement: ${mine.weight}/5` : 'Endorse this'}
        >
          <Sparkles className="w-3 h-3" />
          <span>{score}</span>
          {endorsers > 0 && <span className="text-muted-foreground">· {endorsers}</span>}
        </button>

        <EndorseDialog
          open={open}
          setOpen={setOpen}
          weight={weight}
          setWeight={setWeight}
          note={note}
          setNote={setNote}
          hasExisting={!!mine}
          submitPending={endorseMutation.isPending}
          revokePending={revokeMutation.isPending}
          onSubmit={() => endorseMutation.mutate()}
          onRevoke={() => revokeMutation.mutate()}
        />
      </>
    );
  }

  return (
    <>
      <Button
        variant={mine ? 'default' : 'outline'}
        onClick={() => {
          if (!isAuthenticated) {
            toast.error('Sign in to endorse');
            return;
          }
          setWeight(mine?.weight ?? 3);
          setNote(mine?.note ?? '');
          setOpen(true);
        }}
        className={className}
      >
        <Sparkles className="w-4 h-4 mr-2" />
        Endorse
        <Badge variant="outline" className="ml-2">
          {score}
        </Badge>
      </Button>

      <EndorseDialog
        open={open}
        setOpen={setOpen}
        weight={weight}
        setWeight={setWeight}
        note={note}
        setNote={setNote}
        hasExisting={!!mine}
        submitPending={endorseMutation.isPending}
        revokePending={revokeMutation.isPending}
        onSubmit={() => endorseMutation.mutate()}
        onRevoke={() => revokeMutation.mutate()}
      />
    </>
  );
}

function EndorseDialog(props: {
  open: boolean;
  setOpen: (v: boolean) => void;
  weight: number;
  setWeight: (v: number) => void;
  note: string;
  setNote: (v: string) => void;
  hasExisting: boolean;
  submitPending: boolean;
  revokePending: boolean;
  onSubmit: () => void;
  onRevoke: () => void;
}) {
  const { open, setOpen, weight, setWeight, note, setNote, hasExisting } = props;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{hasExisting ? 'Update Endorsement' : 'Endorse'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Endorsements are a positive taste signal. Weight 1 = "worth noting", 5 = "one of the
            best I've seen."
          </p>
          <div className="space-y-2">
            <Label>Weight</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setWeight(w)}
                  className={`flex-1 rounded-md border py-2 text-sm transition-colors ${
                    weight === w
                      ? 'border-amber-500/50 bg-amber-500/20 text-amber-300'
                      : 'border-muted hover:border-muted-foreground/40'
                  }`}
                >
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="endorse-note">Note (optional)</Label>
            <Input
              id="endorse-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why is this worth looking at?"
              maxLength={500}
            />
          </div>
        </div>
        <DialogFooter>
          {hasExisting && (
            <Button
              variant="outline"
              className="mr-auto text-destructive hover:text-destructive"
              onClick={props.onRevoke}
              disabled={props.revokePending}
            >
              {props.revokePending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4 mr-2" />
              )}
              Revoke
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={props.onSubmit} disabled={props.submitPending}>
            {props.submitPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {hasExisting ? 'Update' : 'Endorse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
