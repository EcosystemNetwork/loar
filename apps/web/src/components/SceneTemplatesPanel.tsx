/**
 * SceneTemplatesPanel
 *
 * Save the current preset bundle (style + shot + optional camera/VFX) as a
 * named scene template, and browse/apply existing templates (your own +
 * public ones). Surfaces a single row above the generate button.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '../utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import type { StylePresetId } from './style-presets';
import type { ShotPresetId } from './shot-presets';
import { STYLE_PRESETS } from './style-presets';
import { SHOT_PRESETS } from './shot-presets';

interface SceneTemplateBundle {
  stylePreset?: StylePresetId | null;
  shotPreset?: ShotPresetId | null;
  starterPrompt?: string;
}

interface SceneTemplate {
  id: string;
  name: string;
  description?: string;
  visibility: 'private' | 'public';
  creatorAddress: string;
  bundle: SceneTemplateBundle;
  useCount: number;
}

interface SceneTemplatesPanelProps {
  /** Current state to capture when saving. */
  stylePreset: StylePresetId | null;
  shotPreset: ShotPresetId | null;
  starterPrompt?: string;
  /** Called when user applies a template — receives bundle to merge. */
  onApply: (bundle: SceneTemplateBundle) => void;
  disabled?: boolean;
}

export function SceneTemplatesPanel({
  stylePreset,
  shotPreset,
  starterPrompt,
  onApply,
  disabled,
}: SceneTemplatesPanelProps) {
  const { isAuthenticated } = useWalletAuth();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'mine' | 'public'>('public');
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [name, setName] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public'>('private');

  const templatesQuery = useQuery({
    queryKey: ['sceneTemplates', scope],
    queryFn: () =>
      trpcClient.sceneTemplates.list.query({ scope, limit: 20 }) as Promise<SceneTemplate[]>,
    enabled: scope === 'public' || isAuthenticated,
  });

  const createMutation = useMutation({
    mutationFn: (input: {
      name: string;
      visibility: 'private' | 'public';
      bundle: SceneTemplateBundle;
    }) => trpcClient.sceneTemplates.create.mutate(input),
    onSuccess: () => {
      toast.success('Template saved');
      setShowSaveForm(false);
      setName('');
      queryClient.invalidateQueries({ queryKey: ['sceneTemplates'] });
    },
    onError: (err: any) => toast.error(err.message || 'Failed to save template'),
  });

  const applyMutation = useMutation({
    mutationFn: (id: string) => trpcClient.sceneTemplates.apply.mutate({ id }),
    onSuccess: (bundle: SceneTemplateBundle) => {
      onApply(bundle);
      toast.success('Template applied');
    },
    onError: (err: any) => toast.error(err.message || 'Failed to apply template'),
  });

  const canSave = !!stylePreset || !!shotPreset || !!starterPrompt?.trim();

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Give your template a name');
      return;
    }
    createMutation.mutate({
      name: name.trim(),
      visibility,
      bundle: {
        stylePreset: stylePreset ?? undefined,
        shotPreset: shotPreset ?? undefined,
        ...(starterPrompt?.trim() ? { starterPrompt: starterPrompt.trim() } : {}),
      },
    });
  };

  return (
    <div className="space-y-2 border rounded-md p-3 bg-muted/30">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Scene Templates ("Studios")
        </span>
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

      {/* Template list */}
      {templatesQuery.isLoading ? (
        <div className="text-xs text-muted-foreground py-2">Loading…</div>
      ) : !templatesQuery.data || templatesQuery.data.length === 0 ? (
        <div className="text-xs text-muted-foreground py-2">
          {scope === 'mine' ? 'No saved templates yet.' : 'No public templates yet — be the first.'}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {templatesQuery.data.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => applyMutation.mutate(tpl.id)}
              disabled={disabled || applyMutation.isPending}
              className="text-left text-xs px-2 py-1.5 rounded border border-border hover:border-primary/40 transition-colors disabled:opacity-50"
              title={describeBundle(tpl.bundle)}
            >
              <span className="font-medium">{tpl.name}</span>
              <span className="block text-[10px] text-muted-foreground">
                {summarizeBundle(tpl.bundle)} · {tpl.useCount} use
                {tpl.useCount === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Save section */}
      {isAuthenticated && (
        <div className="pt-1 border-t border-border/50">
          {!showSaveForm ? (
            <button
              type="button"
              onClick={() => setShowSaveForm(true)}
              disabled={disabled || !canSave}
              className="text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
            >
              {canSave
                ? '+ Save current as template'
                : '+ Pick a style or shot first to save as template'}
            </button>
          ) : (
            <div className="space-y-2 pt-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Template name (e.g. 'Wong Kar-wai close-up')"
                className="w-full text-xs px-2 py-1.5 rounded border bg-background"
                maxLength={80}
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
                  type="button"
                  onClick={handleSave}
                  disabled={createMutation.isPending || !name.trim()}
                  className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs disabled:opacity-50"
                >
                  {createMutation.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSaveForm(false)}
                  disabled={createMutation.isPending}
                  className="px-2 py-1 rounded border text-xs"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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

function summarizeBundle(bundle: SceneTemplateBundle): string {
  const parts: string[] = [];
  if (bundle.stylePreset) {
    parts.push(STYLE_PRESETS.find((s) => s.id === bundle.stylePreset)?.label ?? bundle.stylePreset);
  }
  if (bundle.shotPreset) {
    parts.push(SHOT_PRESETS.find((s) => s.id === bundle.shotPreset)?.label ?? bundle.shotPreset);
  }
  return parts.join(' · ') || 'Custom prompt';
}

function describeBundle(bundle: SceneTemplateBundle): string {
  const lines: string[] = [];
  if (bundle.stylePreset) lines.push(`Style: ${bundle.stylePreset}`);
  if (bundle.shotPreset) lines.push(`Shot: ${bundle.shotPreset}`);
  if (bundle.starterPrompt) lines.push(`Prompt: ${bundle.starterPrompt.slice(0, 120)}…`);
  return lines.join('\n');
}
