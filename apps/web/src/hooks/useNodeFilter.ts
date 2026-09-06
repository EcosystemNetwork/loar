/**
 * useNodeFilter — Filter state + derived filtered node list.
 *
 * Provides a NodeFilter state object and a `matchesFilter` predicate that
 * the editor uses to dim non-matching nodes on the canvas.
 */

import { useState, useMemo, useCallback } from 'react';
import type { Node } from 'reactflow';
import type { TimelineNodeData } from '@/components/flow/TimelineNodes';
import {
  type NodeFilter,
  type ArcDefinition,
  DEFAULT_FILTER,
  isFilterActive,
  nodeMatchesFilter,
} from '@/components/flow/types';

export function useNodeFilter(nodes: Node<TimelineNodeData>[], arcs: ArcDefinition[]) {
  const [filter, setFilter] = useState<NodeFilter>(DEFAULT_FILTER);

  const isActive = useMemo(() => isFilterActive(filter), [filter]);

  const matchesFilter = useCallback(
    (node: Node<TimelineNodeData>): boolean => nodeMatchesFilter(node, filter, arcs),
    [filter, arcs]
  );

  /** IDs of nodes that match the current filter */
  const matchingNodeIds = useMemo(() => {
    if (!isActive) return null; // null = no filter active, show all
    return new Set(nodes.filter(matchesFilter).map((n) => n.id));
  }, [nodes, matchesFilter, isActive]);

  const setSearchText = useCallback(
    (searchText: string) => setFilter((f) => ({ ...f, searchText })),
    []
  );

  const setCanonStatus = useCallback(
    (canonStatus: NodeFilter['canonStatus']) => setFilter((f) => ({ ...f, canonStatus })),
    []
  );

  const setArcId = useCallback((arcId: string | null) => setFilter((f) => ({ ...f, arcId })), []);

  const setHasVideo = useCallback(
    (hasVideo: NodeFilter['hasVideo']) => setFilter((f) => ({ ...f, hasVideo })),
    []
  );

  const clearFilter = useCallback(() => setFilter(DEFAULT_FILTER), []);

  return {
    filter,
    isActive,
    matchesFilter,
    matchingNodeIds,
    setSearchText,
    setCanonStatus,
    setArcId,
    setHasVideo,
    clearFilter,
  };
}
