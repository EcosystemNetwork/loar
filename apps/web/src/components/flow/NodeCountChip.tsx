/**
 * Always-visible node-count readout for the universe editor toolbar.
 *
 * Built after two incidents (2026-09-19) that both took direct Firestore/RPC
 * queries to diagnose because nothing on screen said how many nodes a
 * universe actually had, or where they came from:
 *  - "Cyber War": nodes popped up, then most of them vanished a couple of
 *    seconds later (a loading-state race — see useUniverseBlockchain.ts's
 *    isLoadingMediaOverrides).
 *  - "Orange Pills": an on-chain-minted universe with zero on-chain nodes
 *    fell back to its off-chain nodes, then — per a live screenshot — those
 *    also flashed in and back out, cause still open.
 *
 * This chip shows the current count + where it's from, and keeps a short
 * timestamped log of every change, so a "nodes disappeared" report can be
 * diagnosed straight from a screenshot of the *chip*, not a screenshot of
 * the empty canvas plus a follow-up archaeology session.
 */
import { useEffect, useReducer, useRef } from 'react';
import { Hash } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { GraphSource } from '@/hooks/useUniverseBlockchain';

export interface NodeCountChipProps {
  /** Nodes currently rendered on the ReactFlow canvas (scene/branch/root — not the trailing "add" node). */
  liveCount: number;
  /** graphData.nodeIds.length from useUniverseBlockchain — what the data layer currently says exists. */
  graphDataCount: number;
  /** On-chain mode only: node count before hidden-override filtering. 0 otherwise. */
  rawOnChainNodeCount: number;
  graphSource: GraphSource;
  isLoadingAny: boolean;
}

interface HistoryEntry {
  t: number;
  liveCount: number;
  graphDataCount: number;
  isLoadingAny: boolean;
  source: GraphSource;
}

const MAX_HISTORY = 25;

const SOURCE_LABEL: Record<GraphSource, string> = {
  'on-chain': 'on-chain',
  'off-chain-fallback': 'off-chain (fallback)',
  'off-chain': 'off-chain',
  empty: 'none yet',
};

function formatClock(t: number): string {
  return new Date(t).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function NodeCountChip({
  liveCount,
  graphDataCount,
  rawOnChainNodeCount,
  graphSource,
  isLoadingAny,
}: NodeCountChipProps) {
  const historyRef = useRef<HistoryEntry[]>([]);
  const lastRef = useRef<{ liveCount: number; isLoadingAny: boolean } | null>(null);
  // Only re-renders when a new history entry actually lands — the count/
  // loading props below already drive the chip's own re-render otherwise.
  const [, bumpHistoryVersion] = useReducer((n: number) => n + 1, 0);

  // Record a new line only on a real transition (count or loading state
  // actually changed), not on every render this component happens to get —
  // otherwise a healthy, static universe would still spam the log.
  useEffect(() => {
    const last = lastRef.current;
    if (last && last.liveCount === liveCount && last.isLoadingAny === isLoadingAny) return;
    lastRef.current = { liveCount, isLoadingAny };
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_HISTORY - 1)),
      { t: Date.now(), liveCount, graphDataCount, isLoadingAny, source: graphSource },
    ];
    bumpHistoryVersion();
  }, [liveCount, graphDataCount, isLoadingAny, graphSource]);

  const hiddenByOverride =
    graphSource === 'on-chain' ? Math.max(0, rawOnChainNodeCount - graphDataCount) : 0;
  // Canvas hasn't caught up to the data layer yet (the graph-rebuild effect
  // in $id.tsx hasn't run since graphData last changed) — not itself a bug,
  // but worth a visual nudge while it's true.
  const catchingUp = !isLoadingAny && liveCount !== graphDataCount;
  // The specific shape both incidents had: a healthy count, then a drop to
  // fewer nodes (or zero) with no loading state in between to explain it.
  const history = historyRef.current;
  const justDropped =
    history.length >= 2 &&
    !isLoadingAny &&
    history[history.length - 1].liveCount < history[history.length - 2].liveCount;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          data-testid="node-count-chip"
          className={cn(
            'flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1.5 bg-zinc-900/80 backdrop-blur-sm border rounded-lg text-sm transition-colors',
            justDropped
              ? 'border-red-500/50 text-red-300 animate-pulse'
              : catchingUp
                ? 'border-amber-500/40 text-amber-300'
                : 'border-zinc-700 text-zinc-300 hover:border-zinc-500 hover:text-white'
          )}
          title="Node count — click for a breakdown and recent history"
        >
          <Hash className="h-4 w-4" />
          {isLoadingAny ? '…' : liveCount} node{liveCount === 1 ? '' : 's'}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-3">
        <div className="text-sm font-medium mb-2">Node count</div>
        <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs mb-2">
          <dt className="text-muted-foreground">Live on canvas</dt>
          <dd className="text-right font-mono">{liveCount}</dd>
          <dt className="text-muted-foreground">From data source</dt>
          <dd className="text-right font-mono">{isLoadingAny ? '…' : graphDataCount}</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="text-right">{SOURCE_LABEL[graphSource]}</dd>
          {graphSource === 'on-chain' && (
            <>
              <dt className="text-muted-foreground">Raw on-chain total</dt>
              <dd className="text-right font-mono">{rawOnChainNodeCount}</dd>
              <dt className="text-muted-foreground">Hidden by override</dt>
              <dd className="text-right font-mono">{hiddenByOverride}</dd>
            </>
          )}
          <dt className="text-muted-foreground">Loading</dt>
          <dd className="text-right">{isLoadingAny ? 'yes' : 'no'}</dd>
        </dl>

        {catchingUp && (
          <p className="text-xs text-amber-400 mb-2">
            Canvas ({liveCount}) hasn't caught up to the data layer ({graphDataCount}) yet.
          </p>
        )}
        {justDropped && (
          <p className="text-xs text-red-400 mb-2">
            The live count just dropped with no loading state in between — the exact shape of the
            "nodes pop up and disappear" bug. See the log below for the sequence.
          </p>
        )}

        <div className="text-xs font-medium mb-1">Recent changes</div>
        <div
          data-testid="node-count-history"
          className="space-y-0.5 max-h-40 overflow-y-auto font-mono text-[11px]"
        >
          {history.length === 0 && <div className="text-muted-foreground">no changes yet</div>}
          {history
            .slice()
            .reverse()
            .map((e, i) => {
              const prev = history[history.length - 2 - i];
              const dropped = prev && !e.isLoadingAny && e.liveCount < prev.liveCount;
              return (
                <div key={e.t + '-' + i} className={dropped ? 'text-red-400' : 'text-zinc-400'}>
                  {`${formatClock(e.t)} — ${e.isLoadingAny ? 'loading…' : `${e.liveCount} nodes`} (${SOURCE_LABEL[e.source]})`}
                </div>
              );
            })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
