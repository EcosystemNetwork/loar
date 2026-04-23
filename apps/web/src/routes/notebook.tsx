/**
 * Notebook — private creator scratch pad.
 *
 * Entries are markdown drafts that only the author sees. When an idea is
 * ready to enter canon, the author can promote it to a real Entity
 * (person, place, lore, etc.) from the detail page.
 */
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { trpcClient, queryClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { UserText } from '@/components/user-text';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, NotebookPen, Sparkles, Tag } from 'lucide-react';

function NotebookList() {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthenticating } = useWalletAuth();
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  const entriesQuery = useQuery({
    queryKey: ['notebook', 'list'],
    queryFn: () => trpcClient.notebook.list.query({ limit: 100 }),
    enabled: isAuthenticated,
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      trpcClient.notebook.create.mutate({
        title: title.trim(),
        body,
        tags: tagsInput
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: (data) => {
      toast.success('Saved to notebook');
      setTitle('');
      setBody('');
      setTagsInput('');
      setComposeOpen(false);
      queryClient.invalidateQueries({ queryKey: ['notebook', 'list'] });
      if (data.entry?.id) {
        navigate({ to: '/notebook/$id', params: { id: data.entry.id } });
      }
    },
    onError: (err: any) => toast.error(err.message ?? 'Could not save entry'),
  });

  if (isAuthenticating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAuthenticated) return null;

  const entries = entriesQuery.data?.entries ?? [];

  return (
    <div className="container mx-auto px-4 py-10 max-w-4xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <NotebookPen className="w-6 h-6 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight">Notebook</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl">
            Private scratch space for raw ideas. Nothing here is canon, nothing is public. When an
            idea is ready, promote it into a real Person, Place, Lore page, or any other entity —
            the link stays so your notebook is the provenance trail.
          </p>
        </div>
        <Button onClick={() => setComposeOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> New Entry
        </Button>
      </div>

      {composeOpen && (
        <Card className="mb-6 border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">New entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="notebook-title">Title *</Label>
              <Input
                id="notebook-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="A scene, a character sketch, a half-formed rule..."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notebook-body">Body</Label>
              <Textarea
                id="notebook-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write rough. No one else sees this until you promote it."
                rows={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notebook-tags">Tags</Label>
              <Input
                id="notebook-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="comma, separated, keywords"
              />
            </div>
            <div className="flex gap-3">
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !title.trim()}
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                Save
              </Button>
              <Button variant="outline" onClick={() => setComposeOpen(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {entriesQuery.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 py-16 text-center">
          <NotebookPen className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">No entries yet. Start with a rough idea.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry: any) => (
            <Link
              key={entry.id}
              to="/notebook/$id"
              params={{ id: entry.id }}
              className="block rounded-lg border bg-card hover:border-primary/40 hover:bg-accent/20 transition-colors p-5"
            >
              <div className="flex items-start justify-between gap-4 mb-2">
                <h2 className="text-lg font-semibold truncate flex-1">{entry.title}</h2>
                {entry.promotedTo ? (
                  <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                    Promoted · {entry.promotedTo.entityKind}
                  </Badge>
                ) : (
                  <Badge variant="outline">Draft</Badge>
                )}
              </div>
              {entry.body && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3 break-words">
                  <UserText>{entry.body}</UserText>
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {(entry.tags ?? []).map((tag: string) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                  >
                    <Tag className="w-3 h-3" />
                    {tag}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute('/notebook')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/notebook' } });
    }
  },
  component: NotebookList,
});
