/**
 * AnimationPicker — choose motion clips to add to a rigged character.
 * The catalog comes from the server (`tripo.animationCatalog`) so it only
 * offers what the character's skeleton can actually play.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Plus } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { clipLabel, type RigType } from './clips';

export function AnimationPicker({
  rigType,
  owned,
  busy,
  onAdd,
}: {
  rigType: RigType;
  /** Presets the character already has — marked, still selectable to regenerate. */
  owned: string[];
  busy: boolean;
  onAdd: (presets: string[]) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['tripo', 'animationCatalog', rigType],
    queryFn: () => trpcClient.tripo.animationCatalog.query({ rigType }),
    staleTime: Infinity,
  });
  const [group, setGroup] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading animations…
      </div>
    );
  }
  const groups = data?.groups ?? [];
  const max = data?.maxPerJob ?? 10;
  if (!groups.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Tripo has no extra animations for this skeleton type yet.
      </p>
    );
  }
  const active = groups.find((g) => g.group === group) ?? groups[0];
  const ownedSet = new Set(owned);
  const full = picked.length >= max;

  const toggle = (preset: string) =>
    setPicked((cur) =>
      cur.includes(preset)
        ? cur.filter((p) => p !== preset)
        : cur.length >= max
          ? cur
          : [...cur, preset]
    );

  return (
    <div className="space-y-3">
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Animation groups">
          {groups.map((g) => {
            const n = g.presets.filter((p) => picked.includes(p)).length;
            return (
              <Button
                key={g.group}
                role="tab"
                aria-selected={g.group === active.group}
                size="sm"
                variant={g.group === active.group ? 'secondary' : 'ghost'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setGroup(g.group)}
              >
                {g.group}
                {n > 0 && <span className="ml-1 tabular-nums text-primary">{n}</span>}
              </Button>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {active.presets.map((preset) => {
          const on = picked.includes(preset);
          const have = ownedSet.has(preset);
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(preset)}
              title={have ? 'Already in the motion library — pick to regenerate' : undefined}
              className={cn(
                'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'hover:border-primary/50 hover:bg-muted/50',
                !on && full && 'cursor-not-allowed opacity-40',
                have && !on && 'text-muted-foreground'
              )}
            >
              {have && !on && <Check className="h-3 w-3" aria-label="Already added" />}
              {clipLabel(preset)}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <span className="text-xs text-muted-foreground tabular-nums">
          {picked.length}/{max} picked
          {picked.length > 0 && (
            <button
              type="button"
              className="ml-2 underline underline-offset-2 hover:text-foreground"
              onClick={() => setPicked([])}
            >
              Clear
            </button>
          )}
        </span>
        <Button
          size="sm"
          disabled={!picked.length || busy}
          onClick={() => {
            onAdd(picked);
            setPicked([]);
          }}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="mr-1 h-3.5 w-3.5" />
          )}
          {picked.length
            ? `Add ${picked.length} animation${picked.length === 1 ? '' : 's'}`
            : 'Add animations'}
        </Button>
      </div>
    </div>
  );
}
