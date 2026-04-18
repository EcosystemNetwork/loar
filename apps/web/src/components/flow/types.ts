/**
 * Shared types for the node management system.
 *
 * Used by: NodeOutlinePanel, NodeFilterBar, BulkOperationsToolbar,
 * NodeContextMenu, NodeArcOverlay, and the universe editor.
 */

import type { Node, Edge } from 'reactflow';
import type { TimelineNodeData } from './TimelineNodes';

// ── Arc Definitions ─────────────────────────────────────────────────────

export interface ArcDefinition {
  id: string;
  name: string;
  color: string;
  nodeIds: string[]; // ReactFlow node IDs belonging to this arc
}

export const ARC_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f59e0b', // amber
] as const;

// ── Node Filter ─────────────────────────────────────────────────────────

export interface NodeFilter {
  searchText: string;
  canonStatus: 'all' | 'canon' | 'non-canon';
  arcId: string | null;
  hasVideo: 'all' | 'yes' | 'no';
}

export const DEFAULT_FILTER: NodeFilter = {
  searchText: '',
  canonStatus: 'all',
  arcId: null,
  hasVideo: 'all',
};

// ── Context Menu ────────────────────────────────────────────────────────

export interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  nodeId: string | null;
}

// ── Node Actions (callbacks passed to management components) ────────────

export interface NodeActions {
  onAddEvent: (type: 'after' | 'branch', nodeId?: string) => void;
  onEditScene: (eventId: string) => void;
  onDeleteNode: (eventId: string) => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  onPlaySelected: () => void;
  onClearSelection: () => void;
  onSetCenter: (x: number, y: number, opts?: { zoom?: number; duration?: number }) => void;
  onSelectNode: (node: Node<TimelineNodeData>) => void;
}

// ── Shared helpers ──────────────────────────────────────────────────────

/** Get scene nodes only (filters out 'add' and 'branch' node types) */
export function getSceneNodes(nodes: Node<TimelineNodeData>[]): Node<TimelineNodeData>[] {
  return nodes.filter((n) => n.data.nodeType === 'scene');
}

/** Build parent-child map from edges */
export function buildParentMap(
  nodes: Node<TimelineNodeData>[],
  edges: Edge[]
): Map<string, string[]> {
  const parentMap = new Map<string, string[]>();
  const sceneIds = new Set(nodes.filter((n) => n.data.nodeType === 'scene').map((n) => n.id));

  for (const edge of edges) {
    if (!sceneIds.has(edge.source) || !sceneIds.has(edge.target)) continue;
    const children = parentMap.get(edge.source) || [];
    children.push(edge.target);
    parentMap.set(edge.source, children);
  }

  return parentMap;
}

/** Find root nodes (scene nodes with no incoming edge from another scene node) */
export function findRootNodes(
  nodes: Node<TimelineNodeData>[],
  edges: Edge[]
): Node<TimelineNodeData>[] {
  const sceneNodes = getSceneNodes(nodes);
  const sceneIds = new Set(sceneNodes.map((n) => n.id));
  const hasParent = new Set<string>();

  for (const edge of edges) {
    if (sceneIds.has(edge.source) && sceneIds.has(edge.target)) {
      hasParent.add(edge.target);
    }
  }

  return sceneNodes.filter((n) => !hasParent.has(n.id));
}
