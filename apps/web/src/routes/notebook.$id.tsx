/**
 * Notebook entry detail — edit the draft or promote it to a canonical Entity.
 */
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { trpcClient, queryClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, Loader2, Save, Sparkles, Trash2, ExternalLink } from 'lucide-react';

const PROMOTABLE_KINDS = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
] as const;

const KIND_LABELS: Record<(typeof PROMOTABLE_KINDS)[number], string> = {
  person: 'Person',
  place: 'Place',
  thing: 'Thing / Artifact',
  faction: 'Faction',
  event: 'Event',
  lore: 'Lore Page',
  species: 'Species',
  vehicle: 'Vehicle',
  technology: 'Technology',
  organization: 'Organization',
};

function NotebookEntryDetail() {
  const { id } = Route.useParams() as { id: string };
  const navigate = useNavigate();
  const { isAuthenticated, isAuthenticating } = useWalletAuth();

  const entryQuery = useQuery({
    queryKey: ['notebook', 'get', id],
    queryFn: () => trpcClient.notebook.get.query({ entryId: id }),
    enabled: isAuthenticated,
  });

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [dirty, setDirty] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteKind, setPromoteKind] = useState<(typeof PROMOTABLE_KINDS)[number]>('person');

  useEffect(() => {
    const entry = entryQuery.data?.entry;
    if (entry && !dirty) {
      setTitle(entry.title ?? '');
      setBody(entry.body ?? '');
      setTagsInput((entry.tags ?? []).join(', '));
    }
  }, [entryQuery.data, dirty]);

  const updateMutation = useMutation({
    mutationFn: async () =>
      trpcClient.notebook.update.mutate({
        entryId: id,
        title: title.trim(),
        body,
        tags: tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success('Saved');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['notebook', 'get', id] });
      queryClient.invalidateQueries({ queryKey: ['notebook', 'list'] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Save failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => trpcClient.notebook.delete.mutate({ entryId: id }),
    onSuccess: () => {
      toast.success('Entry deleted');
      queryClient.invalidateQueries({ queryKey: ['notebook', 'list'] });
      navigate({ to: '/notebook' });
    },
    onError: (err: any) => toast.error(err.message ?? 'Delete failed'),
  });

  const promoteMutation = useMutation({
    mutationFn: async () =>
      trpcClient.notebook.promote.mutate({
        entryId: id,
        kind: promoteKind,
      }),
    onSuccess: (data) => {
      toast.success(`Promoted to ${KIND_LABELS[promoteKind]}`);
      setPromoteOpen(false);
      queryClient.invalidateQueries({ queryKey: ['notebook', 'get', id] });
      queryClient.invalidateQueries({ queryKey: ['notebook', 'list'] });
      if (data.entityId) {
        navigate({ to: '/wiki/entity/$id', params: { id: data.entityId } });
      }
    },
    onError: (err: any) => toast.error(err.message ?? 'Promote failed'),
  });

  if (isAuthenticating || entryQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAuthenticated) return null;

  const entry = entryQuery.data?.entry;
  if (!entry) {
    return (
      <div className="container mx-auto px-4 py-10 max-w-3xl">
        <Link to="/notebook">
          <Button variant="outline" className="mb-6">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Notebook
          </Button>
        </Link>
        <p className="text-muted-foreground">Entry not found.</p>
      </div>
    );
  }

  const alreadyPromoted = !!entry.promotedTo;

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl">
      <Link to="/notebook">
        <Button variant="outline" className="mb-6">
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Notebook
        </Button>
      </Link>

      {alreadyPromoted && entry.promotedTo && (
        <div className="mb-6 flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-3">
            <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
              Promoted
            </Badge>
            <span className="text-sm text-muted-foreground">
              This entry was promoted to a {entry.promotedTo.entityKind}.
            </span>
          </div>
          <Link
            to="/wiki/entity/$id"
            params={{ id: entry.promotedTo.entityId }}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            View entity <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entry</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-body">Body</Label>
            <Textarea
              id="edit-body"
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setDirty(true);
              }}
              rows={14}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-tags">Tags</Label>
            <Input
              id="edit-tags"
              value={tagsInput}
              onChange={(e) => {
                setTagsInput(e.target.value);
                setDirty(true);
              }}
              placeholder="comma, separated"
            />
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex items-center justify-between gap-3">
        <div className="flex gap-3">
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !title.trim() || !dirty}
          >
            {updateMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            Save
          </Button>
          <Button
            variant="default"
            className="bg-emerald-600 hover:bg-emerald-500"
            onClick={() => setPromoteOpen(true)}
            disabled={alreadyPromoted}
            title={alreadyPromoted ? 'Already promoted' : 'Promote to canonical entity'}
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {alreadyPromoted ? 'Already Promoted' : 'Promote to Entity'}
          </Button>
        </div>
        <Button
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => {
            if (confirm('Delete this entry? This cannot be undone.')) {
              deleteMutation.mutate();
            }
          }}
          disabled={deleteMutation.isPending}
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete
        </Button>
      </div>

      <Dialog open={promoteOpen} onOpenChange={setPromoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Promote to Canon Entity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              This creates a proper {KIND_LABELS[promoteKind]} entity seeded from the title and body
              of this entry. The draft stays linked so you can trace back to where the idea started.
            </p>
            <div className="space-y-2">
              <Label>Entity kind</Label>
              <Select
                value={promoteKind}
                onValueChange={(v) => setPromoteKind(v as typeof promoteKind)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMOTABLE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => promoteMutation.mutate()} disabled={promoteMutation.isPending}>
              {promoteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Promote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export const Route = createFileRoute('/notebook/$id')({
  beforeLoad: ({ context, params }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: `/notebook/${params.id}` } });
    }
  },
  component: NotebookEntryDetail,
});
