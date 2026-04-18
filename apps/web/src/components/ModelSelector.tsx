/**
 * ModelSelector — Reusable model & provider picker for AI generation.
 *
 * Fetches available models from the server (image.listModels or generation.listModels)
 * and renders a compact selector with provider badges, quality tiers, and pricing.
 *
 * Usage:
 *   <ModelSelector type="image" value={selectedImageModel} onChange={setSelectedImageModel} />
 *   <ModelSelector type="video" value={selectedVideoModel} onChange={setSelectedVideoModel} />
 */

import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Types ─────────────────────────────────────────────────────────────

export interface ModelOption {
  id: string;
  provider: string;
  displayName: string;
  shortDescription: string;
  qualityTier: string;
  priceTier: string;
  fiatPriceUsd: number;
  bestFor: string;
}

interface ModelSelectorProps {
  /** Which model catalog to fetch */
  type: 'image' | 'video';
  /** Currently selected model ID (empty / undefined = auto) */
  value: string;
  /** Callback when user picks a model */
  onChange: (modelId: string) => void;
  /** Optional label override */
  label?: string;
  /** Filter by task (image: text_to_image | image_to_image, video: text_to_video | image_to_video) */
  task?: string;
  /** Show "Auto" option that lets the server pick */
  showAuto?: boolean;
  /** Compact mode — smaller trigger */
  compact?: boolean;
}

// ── Tier badges ───────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  draft: 'bg-gray-500/20 text-gray-400',
  standard: 'bg-blue-500/20 text-blue-400',
  premium: 'bg-amber-500/20 text-amber-400',
  free: 'bg-green-500/20 text-green-400',
};

const PRICE_LABELS: Record<string, string> = {
  low: '$',
  medium: '$$',
  high: '$$$',
};

// ── Component ─────────────────────────────────────────────────────────

export function ModelSelector({
  type,
  value,
  onChange,
  label,
  task,
  showAuto = true,
  compact = false,
}: ModelSelectorProps) {
  const { data: models, isLoading } = useQuery({
    queryKey: ['model-catalog', type, task],
    queryFn: async () => {
      if (type === 'image') {
        return trpcClient.image.listModels.query(task ? { task: task as any } : undefined);
      }
      return trpcClient.generation.listModels.query(task ? { mode: task as any } : undefined);
    },
    staleTime: 5 * 60 * 1000, // cache 5 min
  });

  const displayLabel = label ?? (type === 'image' ? 'Image model' : 'Video model');

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{displayLabel}</label>
      <Select value={value || 'auto'} onValueChange={(v) => onChange(v === 'auto' ? '' : v)}>
        <SelectTrigger className={compact ? 'h-8 text-xs' : undefined}>
          <SelectValue placeholder={isLoading ? 'Loading…' : 'Auto'} />
        </SelectTrigger>
        <SelectContent>
          {showAuto && (
            <SelectItem value="auto">
              <span className="flex items-center gap-1.5">
                Auto
                <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full font-medium">
                  Smart
                </span>
              </span>
            </SelectItem>
          )}
          {(models ?? []).map((m: ModelOption) => (
            <SelectItem key={m.id} value={m.id}>
              <span className="flex items-center gap-1.5">
                {m.displayName}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TIER_COLORS[m.qualityTier] ?? TIER_COLORS.standard}`}
                >
                  {m.qualityTier}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {PRICE_LABELS[m.priceTier] ?? ''}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Inline model picker — button grid style (matches FlowCreationPanel pattern).
 * Good for settings dialogs where you want all options visible at once.
 */
export function ModelGrid({
  type,
  value,
  onChange,
  label,
  task,
  showAuto = true,
}: Omit<ModelSelectorProps, 'compact'>) {
  const { data: models, isLoading } = useQuery({
    queryKey: ['model-catalog', type, task],
    queryFn: async () => {
      if (type === 'image') {
        return trpcClient.image.listModels.query(task ? { task: task as any } : undefined);
      }
      return trpcClient.generation.listModels.query(task ? { mode: task as any } : undefined);
    },
    staleTime: 5 * 60 * 1000,
  });

  const displayLabel = label ?? (type === 'image' ? 'Image Model' : 'Video Model');
  const selected = value || 'auto';

  if (isLoading) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium">{displayLabel}</label>
        <div className="text-xs text-muted-foreground">Loading models…</div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{displayLabel}</label>
      <div className="grid grid-cols-2 gap-2">
        {showAuto && (
          <button
            type="button"
            onClick={() => onChange('')}
            className={`px-3 py-2 text-sm rounded-md border transition-colors text-left ${
              selected === 'auto'
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background hover:bg-muted'
            }`}
          >
            <span className="font-medium">Auto</span>
            <span className="block text-[10px] opacity-70">Smart routing</span>
          </button>
        )}
        {(models ?? []).map((m: ModelOption) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`px-3 py-2 text-sm rounded-md border transition-colors text-left ${
              value === m.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-input bg-background hover:bg-muted'
            }`}
          >
            <span className="font-medium">{m.displayName}</span>
            <span className="block text-[10px] opacity-70">
              {m.provider} · {m.qualityTier} · {PRICE_LABELS[m.priceTier] ?? ''}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
