/**
 * BuildPicker — choose which entities get 3D before anything is spent.
 *
 * Replaces the old one-click "build every missing model" / "rig every model"
 * buttons, which queued paid Tripo jobs for everything with a cover regardless
 * of whether the story ever uses it. Candidates are ranked by tripo.buildPlan
 * (canon episodes that name them, world sets that place them, wiki entries
 * that mention them); used ones start checked, unused ones start unchecked,
 * and the cost updates as the manager picks.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SmartImage } from '@/components/SmartImage';
import type { WorldOverviewRow } from './useTripoJob';

/** Matches BATCH_MAX on the server. */
const MAX_PICK = 50;

export type BuildPickerMode = 'build' | 'rig';

export interface BuildCandidate {
  row: WorldOverviewRow;
  /** USD estimate for this item. */
  cost: number;
  /** What this item becomes, e.g. "model" / "environment" / "rig". */
  output: string;
}

type Usage = Awaited<ReturnType<typeof trpcClient.tripo.buildPlan.query>>[string];

function usageLabel(u: Usage | undefined): string {
  if (!u || u.score === 0) return 'Not used in any episode or set yet';
  const parts: string[] = [];
  if (u.episodes) parts.push(`${u.episodes} episode${u.episodes === 1 ? '' : 's'}`);
  if (u.sets) parts.push(`${u.sets} set${u.sets === 1 ? '' : 's'}`);
  if (u.mentions) parts.push(`${u.mentions} wiki mention${u.mentions === 1 ? '' : 's'}`);
  return `In ${parts.join(' · ')}`;
}

/** Story use means episodes or sets — a wiki cross-reference alone isn't a scene. */
const isUsed = (u: Usage | undefined) => !!u && (u.episodes > 0 || u.sets > 0);

export function BuildPicker({
  open,
  onOpenChange,
  mode,
  universeId,
  candidates,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: BuildPickerMode;
  universeId: string;
  candidates: BuildCandidate[];
  pending: boolean;
  onConfirm: (entityIds: string[]) => void;
}) {
  const plan = useQuery({
    queryKey: ['tripo', 'buildPlan', universeId],
    queryFn: () => trpcClient.tripo.buildPlan.query({ universeId }),
    enabled: open,
    staleTime: 60_000,
  });
  const usage = plan.data ?? {};

  const ranked = useMemo(
    () =>
      [...candidates].sort(
        (a, b) =>
          (usage[b.row.id]?.score ?? 0) - (usage[a.row.id]?.score ?? 0) ||
          a.row.name.localeCompare(b.row.name)
      ),
    [candidates, usage]
  );
  const used = ranked.filter((c) => isUsed(usage[c.row.id]));
  const unused = ranked.filter((c) => !isUsed(usage[c.row.id]));

  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Seed the selection with what the story uses, once the plan arrives.
  const seedKey = open && plan.data ? used.map((c) => c.row.id).join(',') : null;
  useEffect(() => {
    if (seedKey === null) return;
    setPicked(new Set(seedKey ? seedKey.split(',').slice(0, MAX_PICK) : []));
  }, [seedKey]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PICK) next.add(id);
      return next;
    });
  const chosen = ranked.filter((c) => picked.has(c.row.id));
  const total = chosen.reduce((sum, c) => sum + c.cost, 0);

  const title = mode === 'build' ? 'Choose what to build in 3D' : 'Choose what to rig';
  const description =
    mode === 'build'
      ? 'Each pick turns its wiki cover art into a 3D model (places become walkable environments). Things your episodes and sets use are pre-selected. For a better result, open an entity and pick a cleaner source image first.'
      : 'Each pick gets an auto-detected skeleton plus idle/walk clips. Things your episodes and sets use are pre-selected.';

  const renderRow = (c: BuildCandidate) => {
    const u = usage[c.row.id];
    return (
      <label
        key={c.row.id}
        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/60"
      >
        <Checkbox checked={picked.has(c.row.id)} onCheckedChange={() => toggle(c.row.id)} />
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-muted">
          {c.row.imageUrl && (
            <SmartImage src={c.row.imageUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{c.row.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {c.row.kind} → {c.output} · {usageLabel(u)}
          </div>
        </div>
        <Link
          to="/wiki/entity/$id"
          params={{ id: c.row.id }}
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Open
        </Link>
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          ${c.cost.toFixed(2)}
        </span>
      </label>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {plan.isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking where each one is used…
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
            {plan.isError && (
              <p className="text-xs text-muted-foreground">
                Couldn't load usage, so nothing is pre-selected. Pick by hand.
              </p>
            )}
            {used.length > 0 && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Used in your story ({used.length})
                </h4>
                {used.map(renderRow)}
              </section>
            )}
            {unused.length > 0 && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Not used yet ({unused.length})
                </h4>
                {unused.map(renderRow)}
              </section>
            )}
          </div>
        )}

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {picked.size >= MAX_PICK ? `Up to ${MAX_PICK} at a time · ` : ''}
            {chosen.length} selected · ≈${total.toFixed(2)}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={chosen.length === 0 || pending || plan.isLoading}
              onClick={() => onConfirm(chosen.map((c) => c.row.id))}
            >
              {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {mode === 'build' ? 'Build' : 'Rig'} {chosen.length}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
