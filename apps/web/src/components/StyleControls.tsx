/**
 * StyleControls — PRD 5 UI for applying style packs, moodboards, retexture,
 * and style strength to a generation request.
 *
 * Designed to be slotted into any generation form that calls image.generate.
 * The component is fully controlled: the parent holds the state and passes
 * callbacks. This keeps it reusable across the create-entity flow, the
 * standalone GenerativeMedia panel, and future generation surfaces.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Slider } from './ui/slider';
import { Badge } from './ui/badge';
import { Palette, Images, Wand2, Crown } from 'lucide-react';

export interface StyleControlsValue {
  stylePackEntityId: string | null;
  moodboardEntityId: string | null;
  /** 0..1 */
  styleStrength: number;
  /** Retexture keeps composition, swaps look — requires a source image. */
  retexture: boolean;
  /** When false, the generator ignores the universe's canon style pack. */
  respectCanonStyle: boolean;
}

interface StyleControlsProps {
  value: StyleControlsValue;
  onChange: (next: StyleControlsValue) => void;
  /** Scope: only show packs/boards for this universe. Null = global creator catalog. */
  universeAddress?: string | null;
  /** Whether the parent has a source image available for retexture. */
  hasSourceImage?: boolean;
  /** Optional creator address to include their private (no-universe) packs too. */
  creatorAddress?: string | null;
  className?: string;
}

const NONE = '__none__';

export function StyleControls({
  value,
  onChange,
  universeAddress,
  hasSourceImage,
  creatorAddress,
  className,
}: StyleControlsProps) {
  // ── Fetch style packs + moodboards ──────────────────────────────────
  // Scope: universe-scoped when universeAddress is set; otherwise list by
  // creator so solo entities still work. Both queries are public.
  const { data: stylePacksData } = useQuery({
    queryKey: ['style-packs', universeAddress ?? 'none', creatorAddress ?? 'none'],
    queryFn: async () => {
      if (universeAddress) {
        return trpcClient.entities.list.query({
          universeAddress: universeAddress as `0x${string}`,
          kind: 'style_pack',
        });
      }
      if (creatorAddress) {
        return trpcClient.entities.listByCreator.query({
          creator: creatorAddress,
          kind: 'style_pack',
          limit: 100,
        });
      }
      return trpcClient.entities.listByKind.query({ kind: 'style_pack', limit: 50 });
    },
  });

  const { data: moodboardsData } = useQuery({
    queryKey: ['moodboards', universeAddress ?? 'none', creatorAddress ?? 'none'],
    queryFn: async () => {
      if (universeAddress) {
        return trpcClient.entities.list.query({
          universeAddress: universeAddress as `0x${string}`,
          kind: 'moodboard',
        });
      }
      if (creatorAddress) {
        return trpcClient.entities.listByCreator.query({
          creator: creatorAddress,
          kind: 'moodboard',
          limit: 100,
        });
      }
      return trpcClient.entities.listByKind.query({ kind: 'moodboard', limit: 50 });
    },
  });

  // Canon style pack for this universe — shown as a "Canon" badge.
  const { data: canonData } = useQuery({
    queryKey: ['canon-style-pack', universeAddress],
    queryFn: () => trpcClient.universes.getCanonStylePack.query({ universeId: universeAddress! }),
    enabled: !!universeAddress,
  });
  const canonEntityId = canonData?.canonStylePackEntityId ?? null;

  const stylePacks = useMemo(
    () => (stylePacksData as { entities?: any[] } | undefined)?.entities ?? [],
    [stylePacksData]
  );
  const moodboards = useMemo(
    () => (moodboardsData as { entities?: any[] } | undefined)?.entities ?? [],
    [moodboardsData]
  );

  const strengthPct = Math.round(value.styleStrength * 100);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4" />
          <CardTitle className="text-base">Visual Style</CardTitle>
          {canonEntityId && (
            <Badge variant="outline" className="ml-auto text-[10px]">
              <Crown className="w-3 h-3 mr-1" />
              Canon pack set
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Style Pack */}
        <div className="space-y-2">
          <Label>Style Pack</Label>
          <Select
            value={value.stylePackEntityId ?? NONE}
            onValueChange={(v) => onChange({ ...value, stylePackEntityId: v === NONE ? null : v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="No style pack — free generation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No style pack</SelectItem>
              {stylePacks.map((pack: any) => (
                <SelectItem key={pack.id} value={pack.id}>
                  {pack.name}
                  {pack.id === canonEntityId ? ' (canon)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {stylePacks.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              No style packs yet. Create one from{' '}
              <span className="font-mono">/create/style_pack</span>.
            </p>
          )}
        </div>

        {/* Moodboard */}
        <div className="space-y-2">
          <Label className="flex items-center gap-2">
            <Images className="w-3.5 h-3.5" />
            Moodboard
          </Label>
          <Select
            value={value.moodboardEntityId ?? NONE}
            onValueChange={(v) => onChange({ ...value, moodboardEntityId: v === NONE ? null : v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="No moodboard" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No moodboard</SelectItem>
              {moodboards.map((mb: any) => (
                <SelectItem key={mb.id} value={mb.id}>
                  {mb.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Strength */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Style Strength</Label>
            <span className="text-xs font-mono text-muted-foreground">{strengthPct}%</span>
          </div>
          <Slider
            value={[strengthPct]}
            onValueChange={([pct]) => onChange({ ...value, styleStrength: (pct ?? 70) / 100 })}
            min={0}
            max={100}
            step={5}
          />
          <p className="text-[11px] text-muted-foreground">
            0% — free prompt. 70% — balanced. 100% — full retexture emphasis.
          </p>
        </div>

        {/* Retexture */}
        <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
          <div className="space-y-1">
            <Label className="flex items-center gap-2">
              <Wand2 className="w-3.5 h-3.5" />
              Retexture mode
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Keep composition, swap look. Requires a source image + style pack.
            </p>
          </div>
          <ToggleDot
            on={value.retexture}
            disabled={!hasSourceImage || !value.stylePackEntityId}
            onClick={() => onChange({ ...value, retexture: !value.retexture })}
          />
        </div>

        {/* Canon opt-out */}
        {canonEntityId && (
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div className="space-y-1">
              <Label>Respect canon style</Label>
              <p className="text-[11px] text-muted-foreground">
                When on, this universe's canon style pack applies automatically. Turn off to
                generate an alternate-style fan variant.
              </p>
            </div>
            <ToggleDot
              on={value.respectCanonStyle}
              onClick={() => onChange({ ...value, respectCanonStyle: !value.respectCanonStyle })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ToggleDot({
  on,
  onClick,
  disabled,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        disabled
          ? 'opacity-40 cursor-not-allowed border-muted bg-muted'
          : on
            ? 'bg-primary border-primary'
            : 'bg-muted border-muted-foreground/20 hover:border-muted-foreground/40'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${
          on ? 'translate-x-6' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

export const DEFAULT_STYLE_CONTROLS_VALUE: StyleControlsValue = {
  stylePackEntityId: null,
  moodboardEntityId: null,
  styleStrength: 0.7,
  retexture: false,
  respectCanonStyle: true,
};
