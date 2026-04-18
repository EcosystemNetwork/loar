/**
 * useNodeArcs — Arc/group CRUD with localStorage persistence.
 *
 * Arcs let users tag groups of timeline nodes into narrative chapters
 * (e.g., "Act 1", "Flashback Sequence"). Persisted per-universe in localStorage.
 */

import { useState, useCallback, useEffect } from 'react';
import { type ArcDefinition, ARC_COLORS } from '@/components/flow/types';

function storageKey(universeId: string) {
  return `universe_arcs_${universeId}`;
}

export function useNodeArcs(universeId: string) {
  const [arcs, setArcs] = useState<ArcDefinition[]>([]);

  // Load from localStorage on mount / universe change
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey(universeId));
      if (stored) setArcs(JSON.parse(stored));
      else setArcs([]);
    } catch {
      setArcs([]);
    }
  }, [universeId]);

  // Persist whenever arcs change
  const persist = useCallback(
    (next: ArcDefinition[]) => {
      setArcs(next);
      localStorage.setItem(storageKey(universeId), JSON.stringify(next));
    },
    [universeId]
  );

  const addArc = useCallback(
    (name: string) => {
      const id = `arc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const color = ARC_COLORS[arcs.length % ARC_COLORS.length];
      const arc: ArcDefinition = { id, name, color, nodeIds: [] };
      persist([...arcs, arc]);
      return arc;
    },
    [arcs, persist]
  );

  const removeArc = useCallback(
    (arcId: string) => {
      persist(arcs.filter((a) => a.id !== arcId));
    },
    [arcs, persist]
  );

  const renameArc = useCallback(
    (arcId: string, name: string) => {
      persist(arcs.map((a) => (a.id === arcId ? { ...a, name } : a)));
    },
    [arcs, persist]
  );

  const addNodesToArc = useCallback(
    (arcId: string, nodeIds: string[]) => {
      persist(
        arcs.map((a) => {
          if (a.id !== arcId) {
            // Remove these nodes from other arcs (a node belongs to one arc)
            return { ...a, nodeIds: a.nodeIds.filter((nid) => !nodeIds.includes(nid)) };
          }
          const merged = new Set([...a.nodeIds, ...nodeIds]);
          return { ...a, nodeIds: [...merged] };
        })
      );
    },
    [arcs, persist]
  );

  const removeNodesFromArc = useCallback(
    (arcId: string, nodeIds: string[]) => {
      persist(
        arcs.map((a) =>
          a.id === arcId ? { ...a, nodeIds: a.nodeIds.filter((nid) => !nodeIds.includes(nid)) } : a
        )
      );
    },
    [arcs, persist]
  );

  const getArcForNode = useCallback(
    (nodeId: string): ArcDefinition | undefined => {
      return arcs.find((a) => a.nodeIds.includes(nodeId));
    },
    [arcs]
  );

  return {
    arcs,
    addArc,
    removeArc,
    renameArc,
    addNodesToArc,
    removeNodesFromArc,
    getArcForNode,
  };
}
