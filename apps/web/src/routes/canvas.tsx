/**
 * Canvas list — pick or create an infinite-canvas board.
 */

import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';

export const Route = createFileRoute('/canvas')({
  component: CanvasListPage,
});

interface Canvas {
  id: string;
  title: string;
  description?: string;
  visibility: 'private' | 'public';
  sceneCount: number;
  updatedAt: Date;
}

function CanvasListPage() {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'mine' | 'public'>(isAuthenticated ? 'mine' : 'public');
  const [showCreate, setShowCreate] = useState(false);

  const listQuery = useQuery({
    queryKey: ['canvas', 'list', scope],
    queryFn: () =>
      trpcClient.canvas.list.query({ scope, limit: 50 }) as unknown as Promise<Canvas[]>,
    enabled: scope === 'public' || isAuthenticated,
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Canvases</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Spatial node-based scene composition. Each canvas is an infinite board where you arrange
            scenes, branch alternates, and direct without a fixed timeline.
          </p>
        </div>
        {isAuthenticated && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm whitespace-nowrap"
          >
            + New canvas
          </button>
        )}
      </header>

      <div className="flex gap-1">
        <ScopeChip
          active={scope === 'mine'}
          onClick={() => setScope('mine')}
          disabled={!isAuthenticated}
        >
          Mine
        </ScopeChip>
        <ScopeChip active={scope === 'public'} onClick={() => setScope('public')}>
          Public
        </ScopeChip>
      </div>

      {showCreate && (
        <CreateCanvasForm
          onCancel={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['canvas', 'list'] });
          }}
        />
      )}

      {listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !listQuery.data || listQuery.data.length === 0 ? (
        <div className="text-sm text-muted-foreground border rounded p-8 text-center">
          {scope === 'mine' ? "You haven't created a canvas yet." : 'No public canvases yet.'}
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {listQuery.data.map((canvas) => (
            <Link
              key={canvas.id}
              to="/canvas/$canvasId"
              params={{ canvasId: canvas.id }}
              className="border rounded p-4 hover:border-primary/60 transition-colors block"
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <h3 className="font-medium truncate">{canvas.title}</h3>
                <span className="text-[10px] uppercase text-muted-foreground">
                  {canvas.visibility}
                </span>
              </div>
              {canvas.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{canvas.description}</p>
              )}
              <div className="text-xs text-muted-foreground mt-2">
                {canvas.sceneCount} scene{canvas.sceneCount === 1 ? '' : 's'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ScopeChip({
  active,
  onClick,
  disabled,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-50 ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-muted-foreground border-border hover:border-primary/40'
      }`}
    >
      {children}
    </button>
  );
}

function CreateCanvasForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');

  const createMutation = useMutation({
    mutationFn: (input: {
      title: string;
      description?: string;
      visibility: 'private' | 'public';
    }) => trpcClient.canvas.create.mutate(input),
    onSuccess: () => {
      toast.success('Canvas created');
      onCreated();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create canvas'),
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) {
          toast.error('Give your canvas a title');
          return;
        }
        createMutation.mutate({
          title: title.trim(),
          description: description.trim() || undefined,
          visibility,
        });
      }}
      className="border rounded p-4 space-y-3 bg-muted/30"
    >
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Canvas title"
        className="w-full text-sm px-2 py-1.5 rounded border bg-background"
        maxLength={120}
        disabled={createMutation.isPending}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full text-sm px-2 py-1.5 rounded border bg-background"
        maxLength={500}
        disabled={createMutation.isPending}
      />
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={visibility === 'private'}
            onChange={() => setVisibility('private')}
            disabled={createMutation.isPending}
          />
          Private
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={visibility === 'public'}
            onChange={() => setVisibility('public')}
            disabled={createMutation.isPending}
          />
          Public
        </label>
        <div className="flex-1" />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          {createMutation.isPending ? 'Creating…' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={createMutation.isPending}
          className="px-3 py-1.5 rounded border text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
