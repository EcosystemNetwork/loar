/**
 * PlotNotes — lightweight private notes for universe planning.
 *
 * Quick-capture for plot ideas, scene outlines, and planning notes.
 * Always team-level access (not visible to token holders).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trpc, trpcClient } from '../../utils/trpc';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { AccessLevel } from '../../hooks/usePrivateAccess';

interface PlotNotesProps {
  universeId: string;
  accessLevel: AccessLevel;
}

export function PlotNotes({ universeId, accessLevel }: PlotNotesProps) {
  const queryClient = useQueryClient();
  const [newNote, setNewNote] = useState('');

  const { data, isLoading } = useQuery(
    trpc.privateSection.listItems.queryOptions({
      universeId,
      section: 'notes',
      limit: 50,
    })
  );

  const createMutation = useMutation({
    mutationFn: (body: string) =>
      trpcClient.privateSection.createItem.mutate({
        universeId,
        section: 'notes',
        title: body.slice(0, 80) + (body.length > 80 ? '...' : ''),
        body,
        accessTier: 'team',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [['privateSection', 'listItems']] });
      setNewNote('');
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
      <div>
        <h3 className="text-white font-semibold">Plot Notes</h3>
        <p className="text-zinc-500 text-sm">Quick notes for plot planning and scene outlines</p>
      </div>

      {canCreate && (
        <div className="flex gap-2">
          <Textarea
            placeholder="Jot down a plot note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            className="bg-zinc-800/50 border-zinc-700 min-h-[60px] flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && newNote.trim()) {
                createMutation.mutate(newNote.trim());
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => newNote.trim() && createMutation.mutate(newNote.trim())}
            disabled={!newNote.trim() || createMutation.isPending}
            className="self-end"
          >
            Add
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p>No notes yet.</p>
          {canCreate && (
            <p className="text-sm mt-1">
              Quick-capture plot ideas, scene outlines, or planning notes.
              <br />
              <span className="text-zinc-600">Ctrl+Enter to save</span>
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item: any) => (
            <div
              key={item.id}
              className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 group hover:border-zinc-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-zinc-300 text-sm whitespace-pre-wrap flex-1">{item.body}</p>
                {canCreate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(item.id)}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-zinc-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  >
                    x
                  </Button>
                )}
              </div>
              <p className="text-zinc-600 text-xs mt-2">
                {new Date(item.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
