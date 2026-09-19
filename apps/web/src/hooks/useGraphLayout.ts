/**
 * useGraphLayout
 *
 * Shared persistence for ReactFlow canvas node positions. Several editors in
 * the app (universe DAG, timeline flow editor, anatomy graph) recompute node
 * positions from source data on every load, which silently discards any
 * manual drag. This hook loads previously-saved positions, lets callers
 * overlay them onto freshly computed nodes, and debounce-saves position
 * changes as the user drags.
 *
 * `graphKey` namespaces multiple canvases per universe, e.g. 'universe',
 * `timeline:${timelineId}`, 'anatomy'.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Node } from 'reactflow';
import { trpcClient } from '@/utils/trpc';
import { sanitizeSavedPositions } from '@/lib/savedLayout';

type Position = { x: number; y: number };
type LayoutQueryData = { positions: Record<string, Position>; updatedAt: string | null } | null;

const SAVE_DEBOUNCE_MS = 600;

export function useGraphLayout(universeId: string | undefined, graphKey: string) {
  const enabled = !!universeId;
  const queryClient = useQueryClient();
  const queryKey = ['graphLayout', universeId, graphKey] as const;

  const layoutQuery = useQuery({
    queryKey,
    queryFn: () => trpcClient.graphLayouts.get.query({ universeId: universeId!, graphKey }),
    enabled,
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: (positions: Record<string, Position>) =>
      trpcClient.graphLayouts.save.mutate({ universeId: universeId!, graphKey, positions }),
    // Merge the just-saved positions into the cached layout immediately.
    // Without this, `applySavedPositions` keeps serving pre-drag coordinates
    // (the query's 60s staleTime, or the server's own eventual consistency)
    // until the next natural refetch — so any graphData-triggered rebuild in
    // between (adding a node, refreshing the timeline, a post-save refetch)
    // silently reverts the drag the user just made.
    onSuccess: (_result, positions) => {
      queryClient.setQueryData(queryKey, (old: LayoutQueryData) => ({
        positions: { ...(old?.positions ?? {}), ...positions },
        updatedAt: new Date().toISOString(),
      }));
    },
  });

  // Batch rapid drag-stop events into one save call instead of one per node.
  const pendingRef = useRef<Record<string, Position>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const batch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(batch).length === 0 || !enabled) return;
    saveMutation.mutate(batch);
  }, [enabled, saveMutation]);

  const savePosition = useCallback(
    (nodeId: string, position: Position) => {
      if (!enabled) return;
      pendingRef.current[nodeId] = position;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [enabled, flush]
  );

  // Flush on unmount so a quick nav-away doesn't drop the last drag.
  useEffect(() => flush, [flush]);

  /** Overlay saved positions onto freshly computed nodes — saved wins. */
  const applySavedPositions = useCallback(
    <T extends Node>(nodes: T[]): T[] => {
      const rawSaved = layoutQuery.data?.positions;
      if (!rawSaved) return nodes;
      const {
        positions: saved,
        rejected,
        collapsed,
      } = sanitizeSavedPositions(
        rawSaved,
        nodes.map((n) => n.id)
      );
      if (collapsed || rejected.length > 0) {
        console.warn(
          `[graphLayout ${graphKey}] ignoring ${rejected.length} unusable saved position(s)` +
            (collapsed ? ' (all collapsed onto one point)' : '') +
            ` for universe ${universeId}; using the computed layout for them.`
        );
      }
      return nodes.map((n) => (saved[n.id] ? { ...n, position: saved[n.id] } : n));
    },
    [layoutQuery.data, graphKey, universeId]
  );

  return {
    applySavedPositions,
    savePosition,
    /** True once the saved layout has loaded (or there's nothing to load). */
    isLoaded: !enabled || layoutQuery.isSuccess || layoutQuery.isError,
  };
}
