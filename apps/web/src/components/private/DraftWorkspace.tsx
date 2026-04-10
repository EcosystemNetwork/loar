/**
 * DraftWorkspace — pre-publication workspace for drafting entities/content.
 *
 * Team members (admin, contributor, moderator) can create drafts here.
 * Drafts can be promoted to public entities/content via the "Publish" action.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc, trpcClient } from '../../utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { AccessLevel } from '../../hooks/usePrivateAccess';

interface DraftWorkspaceProps {
  universeId: string;
  accessLevel: AccessLevel;
}

export function DraftWorkspace({ universeId, accessLevel }: DraftWorkspaceProps) {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<string | null>(null);

  const { data, isLoading } = useQuery(
    trpc.privateSection.listItems.queryOptions({
      universeId,
      section: 'drafts',
      limit: 50,
    })
  );

  const createMutation = useMutation({
    mutationFn: (input: { universeId: string; title: string; body: string; kind: string | null }) =>
      trpcClient.privateSection.createItem.mutate({
        ...input,
        section: 'drafts',
        accessTier: 'team',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['privateSection', 'listItems']] });
      setShowForm(false);
      setTitle('');
      setBody('');
      setKind(null);
    },
  });

  const publishMutation = useMutation({
    mutationFn: (itemId: string) => trpcClient.privateSection.publishItem.mutate({ itemId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['privateSection', 'listItems']] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => trpcClient.privateSection.deleteItem.mutate({ itemId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['privateSection', 'listItems']] });
    },
  });

  const canCreate = accessLevel === 'admin' || accessLevel === 'team';
  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-white font-semibold">Drafts</h3>
          <p className="text-zinc-500 text-sm">
            Pre-publication workspace for entities and content
          </p>
        </div>
        {canCreate && (
          <Button size="sm" variant="outline" onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : '+ New Draft'}
          </Button>
        )}
      </div>

      {showForm && (
        <div className="bg-zinc-800/50 rounded-lg p-4 space-y-3 border border-zinc-700">
          <Input
            placeholder="Draft title..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="bg-zinc-900 border-zinc-600"
          />
          <select
            value={kind ?? ''}
            onChange={(e) => setKind(e.target.value || null)}
            className="w-full bg-zinc-900 border border-zinc-600 rounded-md px-3 py-2 text-sm text-white"
          >
            <option value="">No entity kind</option>
            <option value="person">Person</option>
            <option value="place">Place</option>
            <option value="thing">Thing</option>
            <option value="faction">Faction</option>
            <option value="event">Event</option>
            <option value="lore">Lore</option>
            <option value="species">Species</option>
            <option value="vehicle">Vehicle</option>
            <option value="technology">Technology</option>
            <option value="organization">Organization</option>
          </select>
          <Textarea
            placeholder="Write your draft content (Markdown supported)..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="bg-zinc-900 border-zinc-600 min-h-[120px]"
          />
          <Button
            size="sm"
            onClick={() => createMutation.mutate({ universeId, title, body, kind })}
            disabled={!title.trim() || createMutation.isPending}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Draft'}
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p>No drafts yet.</p>
          {canCreate && (
            <p className="text-sm mt-1">Create your first draft to start worldbuilding.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item: any) => (
            <div
              key={item.id}
              className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4 hover:border-zinc-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="text-white font-medium truncate">{item.title}</h4>
                    {item.kind && (
                      <span className="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded">
                        {item.kind}
                      </span>
                    )}
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        item.status === 'published'
                          ? 'bg-green-900/50 text-green-400'
                          : item.status === 'archived'
                            ? 'bg-zinc-700 text-zinc-400'
                            : 'bg-amber-900/50 text-amber-400'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  {item.body && (
                    <p className="text-zinc-400 text-sm mt-1 line-clamp-2">{item.body}</p>
                  )}
                </div>
                {canCreate && item.status === 'draft' && (
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => publishMutation.mutate(item.id)}
                      disabled={publishMutation.isPending}
                      className="text-xs"
                    >
                      Publish
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(item.id)}
                      disabled={deleteMutation.isPending}
                      className="text-xs text-red-400 hover:text-red-300"
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
