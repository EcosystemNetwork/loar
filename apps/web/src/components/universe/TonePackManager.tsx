/**
 * TonePackManager — CRUD for per-universe relight "house look" presets.
 *
 * Each tone pack is a reusable bundle of relight presets + custom prompt
 * fragments that the universe creator can apply to any image with one
 * click via the relight workbench. Read-only for non-owners.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { trpc, queryClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Plus, Trash2, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface TonePack {
  id: string;
  universeAddress: string;
  name: string;
  description: string;
  presetIds: string[];
  customPromptFragment: string;
  customNegativeFragment: string;
  createdBy: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface TonePackManagerProps {
  universeAddress: string;
  isOwner: boolean;
}

const EMPTY_DRAFT = {
  name: '',
  description: '',
  presetIds: [] as string[],
  customPromptFragment: '',
  customNegativeFragment: '',
};

export function TonePackManager({ universeAddress, isOwner }: TonePackManagerProps) {
  const presetsQuery = useQuery(trpc.editing.relightPresets.queryOptions());
  const packsQuery = useQuery(trpc.universeTonePacks.list.queryOptions({ universeAddress }));

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);

  const allPresets = useMemo(() => {
    const groups = presetsQuery.data ?? { lighting: [], time: [], backdrop: [], mood: [] };
    return [
      ...((groups as any).lighting ?? []),
      ...((groups as any).time ?? []),
      ...((groups as any).backdrop ?? []),
      ...((groups as any).mood ?? []),
    ] as { id: string; kind: string; label: string }[];
  }, [presetsQuery.data]);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: [['universeTonePacks', 'list'], { input: { universeAddress } }],
    });

  const createMutation = useMutation(
    trpc.universeTonePacks.create.mutationOptions({
      onSuccess: () => {
        toast.success('Tone pack saved');
        setDraft(EMPTY_DRAFT);
        invalidate();
      },
      onError: (err: any) => toast.error(err.message || 'Failed to save tone pack'),
    })
  );

  const updateMutation = useMutation(
    trpc.universeTonePacks.update.mutationOptions({
      onSuccess: () => {
        toast.success('Tone pack updated');
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
        invalidate();
      },
      onError: (err: any) => toast.error(err.message || 'Failed to update tone pack'),
    })
  );

  const deleteMutation = useMutation(
    trpc.universeTonePacks.delete.mutationOptions({
      onSuccess: () => {
        toast.success('Tone pack deleted');
        invalidate();
      },
      onError: (err: any) => toast.error(err.message || 'Failed to delete tone pack'),
    })
  );

  const togglePreset = (id: string) => {
    setDraft((prev) => {
      const exists = prev.presetIds.includes(id);
      if (exists) return { ...prev, presetIds: prev.presetIds.filter((p) => p !== id) };
      if (prev.presetIds.length >= 8) {
        toast.error('Stack at most 8 presets');
        return prev;
      }
      return { ...prev, presetIds: [...prev.presetIds, id] };
    });
  };

  const startEdit = (pack: TonePack) => {
    setEditingId(pack.id);
    setDraft({
      name: pack.name,
      description: pack.description ?? '',
      presetIds: pack.presetIds ?? [],
      customPromptFragment: pack.customPromptFragment ?? '',
      customNegativeFragment: pack.customNegativeFragment ?? '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleSave = () => {
    if (!draft.name.trim()) {
      toast.error('Name your tone pack');
      return;
    }
    if (editingId) {
      updateMutation.mutate({ id: editingId, universeAddress, ...draft });
    } else {
      createMutation.mutate({ universeAddress, ...draft });
    }
  };

  const isMutating = createMutation.isPending || updateMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          House Looks (Tone Packs)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          A house look is a reusable relight recipe — stacked presets + custom prompt fragments.
          Apply it to any image in the relight workbench to keep your universe visually coherent.
        </p>

        {/* Existing packs */}
        <div className="space-y-3">
          {packsQuery.isLoading && (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {(packsQuery.data ?? []).map((pack: any) => (
            <div key={pack.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-medium">{pack.name}</div>
                  {pack.description && (
                    <div className="text-xs text-muted-foreground">{pack.description}</div>
                  )}
                  {pack.presetIds?.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {pack.presetIds.map((id: string) => (
                        <Badge key={id} variant="secondary" className="text-[10px]">
                          {id}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                {isOwner && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => startEdit(pack)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate({ id: pack.id, universeAddress })}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {(packsQuery.data ?? []).length === 0 && !packsQuery.isLoading && (
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              No tone packs yet. {isOwner ? 'Create one below.' : ''}
            </div>
          )}
        </div>

        {/* Create / edit form */}
        {isOwner && (
          <div className="space-y-4 rounded-md border bg-muted/30 p-4">
            <div className="text-sm font-medium">
              {editingId ? 'Edit tone pack' : 'New tone pack'}
            </div>

            <div className="space-y-2">
              <Label htmlFor="tone-name">Name</Label>
              <Input
                id="tone-name"
                value={draft.name}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value.slice(0, 60) }))}
                placeholder="e.g. Episode 3 — Rainy Rooftop"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tone-description">Description</Label>
              <Input
                id="tone-description"
                value={draft.description}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, description: e.target.value.slice(0, 280) }))
                }
                placeholder="What this look is for"
              />
            </div>

            <div className="space-y-2">
              <Label>Stacked presets</Label>
              <div className="flex flex-wrap gap-2">
                {allPresets.map((preset) => {
                  const active = draft.presetIds.includes(preset.id);
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => togglePreset(preset.id)}
                      className={
                        'rounded-full border px-3 py-1 text-xs ' +
                        (active
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-background hover:bg-muted')
                      }
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tone-custom">Custom prompt fragment (optional)</Label>
              <Textarea
                id="tone-custom"
                value={draft.customPromptFragment}
                rows={2}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, customPromptFragment: e.target.value.slice(0, 500) }))
                }
                placeholder="e.g. always include a faint chromatic aberration on edges"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tone-negative">Custom negative fragment (optional)</Label>
              <Textarea
                id="tone-negative"
                value={draft.customNegativeFragment}
                rows={2}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    customNegativeFragment: e.target.value.slice(0, 300),
                  }))
                }
                placeholder="e.g. no neon signage, no anime"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={isMutating}>
                {isMutating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : editingId ? (
                  <Save className="mr-2 h-4 w-4" />
                ) : (
                  <Plus className="mr-2 h-4 w-4" />
                )}
                {editingId ? 'Save Changes' : 'Create Tone Pack'}
              </Button>
              {editingId && (
                <Button variant="ghost" onClick={cancelEdit} disabled={isMutating}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
