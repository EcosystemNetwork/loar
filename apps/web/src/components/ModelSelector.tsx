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
  /** True when the current user can dispatch to this model right now (server credit or their own BYOK key). */
  usableByMe?: boolean;
  /** Why it's unusable — shown as a "Coming Soon" tooltip. */
  unusableReason?: string | null;
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
          {(models ?? []).map((m: ModelOption) => {
            const comingSoon = m.usableByMe === false;
            return (
              <SelectItem
                key={m.id}
                value={m.id}
                disabled={comingSoon}
                title={comingSoon ? (m.unusableReason ?? 'Coming soon') : undefined}
              >
                <span className={`flex items-center gap-1.5 ${comingSoon ? 'opacity-50' : ''}`}>
                  {m.displayName}
                  {comingSoon ? (
                    <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">
                      Coming Soon
                    </span>
                  ) : (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TIER_COLORS[m.qualityTier] ?? TIER_COLORS.standard}`}
                    >
                      {m.qualityTier}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {PRICE_LABELS[m.priceTier] ?? ''}
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
