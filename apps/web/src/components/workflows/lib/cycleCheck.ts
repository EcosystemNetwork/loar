import type { Edge, Node } from 'reactflow';

/**
 * Returns true iff adding `candidate` would create a cycle in the existing graph.
 * Used by WorkflowCanvas to reject bad onConnect attempts client-side. The
 * server re-validates in `validateGraph` on save.
 */
export function wouldCreateCycle(
  nodes: Node[],
  edges: Edge[],
  candidate: { source: string; target: string }
): boolean {
  if (candidate.source === candidate.target) return true;

  // Walk forward from `target`: if we can reach `source`, adding the edge
  // closes a cycle.
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }

  const stack = [candidate.target];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === candidate.source) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const next of adj.get(id) ?? []) stack.push(next);
  }
  return false;
}
