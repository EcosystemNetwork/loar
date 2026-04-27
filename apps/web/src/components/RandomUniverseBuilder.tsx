/**
 * RandomUniverseBuilder — pick a mix of entity kinds and roll each one with
 * a fresh style and image model, persisting them to the active universe.
 *
 * Designed for the /create hub. The user picks counts per kind and clicks
 * "Roll" — the builder runs each entity sequentially, showing live progress
 * and surfacing failures without blocking the rest of the queue.
 */
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Wand2, Dices, Plus, Minus, Check, X, ExternalLink } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { resolveIpfsUrl } from '@/utils/ipfs-url';
import {
  rollRandomEntity,
  KIND_LABELS,
  type EntityKind,
  type RolledEntity,
} from '@/lib/random-entity';

// Kinds the builder offers. Excludes structural/ontology kinds and
// visual-language helpers — those are best authored deliberately.
const BUILDER_KINDS: EntityKind[] = [
  'person',
  'place',
  'thing',
  'faction',
  'event',
  'lore',
  'species',
  'vehicle',
  'technology',
  'organization',
];

const DEFAULT_PLAN: Record<EntityKind, number> = {
  person: 2,
  place: 1,
  thing: 1,
  faction: 1,
  event: 0,
  lore: 0,
  species: 0,
  vehicle: 0,
  technology: 0,
  organization: 0,
  moodboard: 0,
  style_pack: 0,
  timeline: 0,
  reality: 0,
  dimension: 0,
  plane: 0,
  realm: 0,
  domain: 0,
};

const MAX_PER_KIND = 5;
const HARD_CAP_TOTAL = 12;

interface QueueItem {
  id: string;
  kind: EntityKind;
  status: 'pending' | 'rolling' | 'saving' | 'done' | 'failed';
  rolled?: RolledEntity;
  entityId?: string;
  error?: string;
}

interface RandomUniverseBuilderProps {
  universeAddress: string;
  universeName?: string;
}

export function RandomUniverseBuilder({
  universeAddress,
  universeName,
}: RandomUniverseBuilderProps) {
  const [plan, setPlan] = useState<Record<EntityKind, number>>(DEFAULT_PLAN);
  const [running, setRunning] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const total = useMemo(() => BUILDER_KINDS.reduce((sum, k) => sum + (plan[k] ?? 0), 0), [plan]);

  const setCount = (kind: EntityKind, next: number) => {
    setPlan((prev) => ({ ...prev, [kind]: Math.max(0, Math.min(MAX_PER_KIND, next)) }));
  };

  const buildQueue = (): QueueItem[] => {
    // Group items by kind first, then round-robin so the user sees variety
    // quickly instead of N people in a row before any place shows up.
    const groups: QueueItem[][] = BUILDER_KINDS.map((kind) => {
      const n = plan[kind] ?? 0;
      return Array.from({ length: n }, (_, i) => ({
        id: `${kind}-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind,
        status: 'pending' as const,
      }));
    });
    const out: QueueItem[] = [];
    let added = true;
    while (added) {
      added = false;
      for (const g of groups) {
        const next = g.shift();
        if (next) {
          out.push(next);
          added = true;
        }
      }
    }
    return out;
  };

  const handleRoll = async () => {
    if (total === 0) {
      toast.error('Pick at least one entity to roll.');
      return;
    }
    if (total > HARD_CAP_TOTAL) {
      toast.error(`Cap of ${HARD_CAP_TOTAL} entities per run — trim the plan first.`);
      return;
    }
    const initialQueue = buildQueue();
    setQueue(initialQueue);
    setRunning(true);
    let successes = 0;
    let failures = 0;

    for (const item of initialQueue) {
      // Roll
      setQueue((prev) => prev.map((q) => (q.id === item.id ? { ...q, status: 'rolling' } : q)));
      let rolled: RolledEntity;
      try {
        rolled = await rollRandomEntity({
          kind: item.kind,
          universeAddress,
        });
      } catch (err: any) {
        failures++;
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: 'failed', error: err?.message ?? 'Roll failed' } : q
          )
        );
        continue;
      }
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: 'saving', rolled } : q))
      );

      // Persist
      try {
        const result = await trpcClient.entities.create.mutate({
          name: rolled.name,
          description: rolled.description,
          kind: rolled.kind,
          imageUrl: rolled.imageUrl,
          metadata: rolled.metadata,
          monetized: false,
          rightsDeclaration: null,
          unstoppableDomain: null,
          universeAddress,
        });
        successes++;
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'done', entityId: result.id } : q))
        );
      } catch (err: any) {
        failures++;
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: 'failed', error: err?.message ?? 'Save failed' } : q
          )
        );
      }
    }

    setRunning(false);
    if (successes > 0 && failures === 0) {
      toast.success(
        `Rolled ${successes} ${successes === 1 ? 'entity' : 'entities'} into your universe.`
      );
    } else if (successes > 0) {
      toast.warning(`Rolled ${successes} succeeded, ${failures} failed.`);
    } else {
      toast.error(`All ${failures} rolls failed.`);
    }
  };

  const handleReset = () => {
    if (running) return;
    setQueue([]);
  };

  return (
    <Card className="border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-purple-500/5">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-violet-400" />
          Random Universe Builder
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Pick how many of each kind to roll into{' '}
          <span className="text-violet-300">{universeName || 'this universe'}</span>. Each roll
          picks a fresh name, style preset, and image model — so the universe ends up with variety,
          not 12 versions of the same look.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {BUILDER_KINDS.map((kind) => {
            const count = plan[kind] ?? 0;
            return (
              <div
                key={kind}
                className={`flex items-center justify-between rounded-md border px-2 py-1.5 text-xs ${
                  count > 0
                    ? 'border-violet-500/40 bg-violet-500/10'
                    : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <span className="font-medium truncate">{KIND_LABELS[kind]}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setCount(kind, count - 1)}
                    disabled={running || count === 0}
                    className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30"
                    aria-label={`Decrease ${KIND_LABELS[kind]}`}
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-4 text-center tabular-nums">{count}</span>
                  <button
                    type="button"
                    onClick={() => setCount(kind, count + 1)}
                    disabled={running || count >= MAX_PER_KIND}
                    className="rounded p-0.5 hover:bg-white/10 disabled:opacity-30"
                    aria-label={`Increase ${KIND_LABELS[kind]}`}
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={handleRoll} disabled={running || total === 0}>
            {running ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Dices className="w-4 h-4 mr-2" />
            )}
            {running
              ? `Rolling ${queue.filter((q) => q.status === 'done').length}/${queue.length}…`
              : `Roll ${total} ${total === 1 ? 'entity' : 'entities'}`}
          </Button>
          {queue.length > 0 && !running && (
            <Button type="button" variant="outline" onClick={handleReset}>
              Clear results
            </Button>
          )}
          <span className="text-[11px] text-muted-foreground ml-auto">
            Caps: {MAX_PER_KIND}/kind · {HARD_CAP_TOTAL} total per run
          </span>
        </div>

        {queue.length > 0 && (
          <div className="rounded-lg border border-white/10 bg-black/20 divide-y divide-white/5">
            {queue.map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-2 text-xs">
                <div className="w-12 h-12 flex-shrink-0 rounded-md bg-muted/40 overflow-hidden flex items-center justify-center">
                  {item.rolled?.imageUrl ? (
                    <img
                      src={resolveIpfsUrl(item.rolled.imageUrl)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : item.status === 'rolling' || item.status === 'saving' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : item.status === 'failed' ? (
                    <X className="w-4 h-4 text-destructive" />
                  ) : (
                    <Wand2 className="w-3 h-3 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="uppercase tracking-wider text-[10px] text-muted-foreground">
                      {KIND_LABELS[item.kind]}
                    </span>
                    <span className="font-medium truncate">
                      {item.rolled?.name ??
                        (item.status === 'pending'
                          ? 'queued…'
                          : item.status === 'rolling'
                            ? 'rolling…'
                            : item.status === 'saving'
                              ? 'saving…'
                              : (item.error ?? 'failed'))}
                    </span>
                  </div>
                  {item.rolled && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      <span className="text-violet-300">{item.rolled.styleLabel}</span> on{' '}
                      <span className="text-violet-300">{item.rolled.modelLabel}</span>
                    </p>
                  )}
                  {item.status === 'failed' && item.error && (
                    <p className="text-[11px] text-destructive truncate">{item.error}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {item.status === 'done' && <Check className="w-4 h-4 text-emerald-400" />}
                  {item.entityId && (
                    <Link
                      to="/wiki/entity/$id"
                      params={{ id: item.entityId }}
                      className="text-violet-300 hover:text-violet-100"
                      title="Open entity"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
