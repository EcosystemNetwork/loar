/**
 * CinematicReferencesPanel
 *
 * Browse + contribute visual references. Click a reference to pin it —
 * its tags/title get folded into the active prompt, its image URL is
 * surfaced for use as an image-to-image source.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '../utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

interface CinematicReference {
  id: string;
  title: string;
  imageUrl: string;
  sourceUrl?: string;
  film?: string;
  director?: string;
  year?: number;
  tags: string[];
  visibility: 'private' | 'public';
  creatorAddress?: string;
  pinCount: number;
}

interface PinResult {
  title: string;
  imageUrl: string;
  tags: string[];
  film?: string;
  director?: string;
}

interface CinematicReferencesPanelProps {
  /** Called when user pins a reference. Receives title + tags + imageUrl to use. */
  onPin: (pinned: PinResult) => void;
  disabled?: boolean;
}

export function CinematicReferencesPanel({ onPin, disabled }: CinematicReferencesPanelProps) {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'mine' | 'public'>('public');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const referencesQuery = useQuery({
    queryKey: ['cinematicReferences', scope, activeTag],
    queryFn: () =>
      trpcClient.cinematicReferences.list.query({
        scope,
        ...(activeTag ? { tag: activeTag } : {}),
        limit: 24,
      }) as Promise<CinematicReference[]>,
    enabled: scope === 'public' || isAuthenticated,
  });

  const tagsQuery = useQuery({
    queryKey: ['cinematicReferences', 'popularTags'],
    queryFn: () =>
      trpcClient.cinematicReferences.popularTags.query({ limit: 12 }) as Promise<
        { tag: string; count: number }[]
      >,
  });

  const pinMutation = useMutation({
    mutationFn: (id: string) => trpcClient.cinematicReferences.pin.mutate({ id }),
    onSuccess: (pinned: PinResult) => {
      onPin(pinned);
      toast.success(`Pinned "${pinned.title}"`);
      queryClient.invalidateQueries({ queryKey: ['cinematicReferences'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to pin reference'),
  });

  return (
    <div className="space-y-2 border rounded-md p-3 bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Reference Library</span>
        <div className="flex gap-1">
          <ScopeChip active={scope === 'public'} onClick={() => setScope('public')}>
            Public
          </ScopeChip>
          <ScopeChip
            active={scope === 'mine'}
            onClick={() => setScope('mine')}
            disabled={!isAuthenticated}
          >
            Mine
          </ScopeChip>
        </div>
      </div>

      {/* Tag filter */}
      {tagsQuery.data && tagsQuery.data.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <TagChip active={activeTag === null} onClick={() => setActiveTag(null)}>
            All
          </TagChip>
          {tagsQuery.data.slice(0, 12).map(({ tag, count }) => (
            <TagChip
              key={tag}
              active={activeTag === tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            >
              {tag} <span className="opacity-50">{count}</span>
            </TagChip>
          ))}
        </div>
      )}

      {/* Grid */}
      {referencesQuery.isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Loading…</div>
      ) : !referencesQuery.data || referencesQuery.data.length === 0 ? (
        <div className="text-xs text-muted-foreground py-4 text-center">
          {scope === 'mine'
            ? 'No saved references yet — add one below.'
            : activeTag
              ? `No public references tagged "${activeTag}".`
              : 'No public references yet — be the first to contribute.'}
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
          {referencesQuery.data.map((ref) => (
            <button
              key={ref.id}
              type="button"
              onClick={() => pinMutation.mutate(ref.id)}
              disabled={disabled || pinMutation.isPending}
              className="group relative overflow-hidden rounded border border-border hover:border-primary/60 transition-colors disabled:opacity-50 aspect-square"
              title={`${ref.title}${ref.film ? ` — ${ref.film}` : ''}${ref.director ? ` (${ref.director})` : ''}${ref.year ? `, ${ref.year}` : ''}`}
            >
              <img
                src={resolveIpfsUrl(ref.imageUrl)}
                alt={ref.title}
                className="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = '0.2';
                }}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-1 text-left">
                <div className="text-[10px] text-white truncate font-medium">{ref.title}</div>
                {ref.film && <div className="text-[9px] text-white/70 truncate">{ref.film}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Contribute */}
      {isAuthenticated && (
        <div className="pt-1 border-t border-border/50">
          {!showAddForm ? (
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              disabled={disabled}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              + Contribute a reference
            </button>
          ) : (
            <AddReferenceForm
              onCancel={() => setShowAddForm(false)}
              onCreated={() => {
                setShowAddForm(false);
                queryClient.invalidateQueries({ queryKey: ['cinematicReferences'] });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function AddReferenceForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [film, setFilm] = useState('');
  const [tags, setTags] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('public');

  const createMutation = useMutation({
    mutationFn: (input: {
      title: string;
      imageUrl: string;
      film?: string;
      tags: string[];
      visibility: 'private' | 'public';
    }) => trpcClient.cinematicReferences.create.mutate(input),
    onSuccess: () => {
      toast.success('Reference added');
      onCreated();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to add reference'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !imageUrl.trim()) {
      toast.error('Title and image URL are required');
      return;
    }
    createMutation.mutate({
      title: title.trim(),
      imageUrl: imageUrl.trim(),
      ...(film.trim() ? { film: film.trim() } : {}),
      tags: tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0),
      visibility,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2 pt-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (e.g. 'Diner standoff')"
        className="w-full text-xs px-2 py-1.5 rounded border bg-background"
        maxLength={120}
        disabled={createMutation.isPending}
      />
      <input
        type="url"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder="Image URL (https://…)"
        className="w-full text-xs px-2 py-1.5 rounded border bg-background"
        disabled={createMutation.isPending}
      />
      <input
        type="text"
        value={film}
        onChange={(e) => setFilm(e.target.value)}
        placeholder="Film / source (optional)"
        className="w-full text-xs px-2 py-1.5 rounded border bg-background"
        maxLength={120}
        disabled={createMutation.isPending}
      />
      <input
        type="text"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="Tags, comma-separated (e.g. 'low-angle, neon, night')"
        className="w-full text-xs px-2 py-1.5 rounded border bg-background"
        disabled={createMutation.isPending}
      />
      <div className="flex items-center gap-2 text-xs">
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
          className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
        >
          {createMutation.isPending ? 'Saving…' : 'Add'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={createMutation.isPending}
          className="px-2 py-1 rounded border text-xs"
        >
          Cancel
        </button>
      </div>
    </form>
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
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background text-muted-foreground border-border hover:border-primary/40'
      }`}
    >
      {children}
    </button>
  );
}

function TagChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
        active
          ? 'bg-primary/10 text-primary border-primary/60'
          : 'bg-background text-muted-foreground border-border hover:border-primary/40'
      }`}
    >
      {children}
    </button>
  );
}
