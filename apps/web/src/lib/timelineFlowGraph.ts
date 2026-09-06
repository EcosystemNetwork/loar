/**
 * timelineFlowGraph — pure ReactFlow node/edge construction for the universe
 * timeline editor.
 *
 * Lifted verbatim from the "Convert blockchain data to timeline nodes"
 * effect in universe/$id.tsx (the scene-node + scene-edge half). The effect
 * keeps everything that needs the live component: the localStorage archive
 * guard, `getStoredEvents()`, the unsaved-draft merge, the trailing "add"
 * node, the pending-generation placeholder, `applySavedPositions`, and
 * attaching the per-node action callbacks. This module is just the
 * deterministic graphData → {nodes, edges} transform, so its edge cases
 * (bytes32-hash stripping, canon vs branch edge styling, the
 * segmentCount/childCount > 1 thresholds, the 50-char label truncation, the
 * archived-node skip) can be unit-tested without React.
 */
import { MarkerType, type Edge, type Node } from 'reactflow';
import {
  calculateTreeLayout,
  normalizeNodeId,
  type TreeLayoutConfig,
  type TreeLayoutResult,
} from '@/utils/treeLayout';
import { isBytes32Hash } from '@/utils/bytes32';
import type { GraphData } from '@/hooks/universeGraphData';
import type { TimelineNodeData } from '@/components/flow/TimelineNodes';

/** Layout knobs the editor passes to calculateTreeLayout for the main canvas. */
export const TIMELINE_LAYOUT_CONFIG: TreeLayoutConfig = {
  horizontalSpacing: 420,
  verticalSpacing: 320,
  startX: 100,
  startY: 100,
};

/** Node/edge accent palette; index 0 is the canon colour. */
export const TIMELINE_NODE_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

export interface BuildSceneFlowGraphArgs {
  graphData: GraphData;
  /** Result of calculateTreeLayout(graphData.nodeIds, graphData.previousNodes, TIMELINE_LAYOUT_CONFIG). */
  layout: TreeLayoutResult;
  /** Soft-deleted node ids (as decimal strings) to skip. */
  archivedNodeIds: Set<string>;
  /** localStorage event store, keyed by decimal node id — provides resolved url/description/title/versions/trim. */
  localEvents: Record<string, any>;
  /** Value for `data.universeId` on every node. */
  universeId: string;
  /** Per-node segment count (localStorage-backed in the app; injected so this stays pure). */
  getSegmentCount?: (nodeId: number) => number;
  /** Override the accent palette (tests). */
  colors?: string[];
}

export interface SceneFlowGraph {
  nodes: Node<TimelineNodeData>[];
  edges: Edge[];
}

/** Convenience wrapper: run the standard layout then build the graph. */
export function buildTimelineFlowGraph(
  args: Omit<BuildSceneFlowGraphArgs, 'layout'>
): SceneFlowGraph {
  const layout = calculateTreeLayout(
    args.graphData.nodeIds,
    args.graphData.previousNodes,
    TIMELINE_LAYOUT_CONFIG
  );
  return buildSceneFlowGraph({ ...args, layout });
}

export function buildSceneFlowGraph({
  graphData,
  layout,
  archivedNodeIds,
  localEvents,
  universeId,
  getSegmentCount,
  colors = TIMELINE_NODE_COLORS,
}: BuildSceneFlowGraphArgs): SceneFlowGraph {
  const nodes: Node<TimelineNodeData>[] = [];
  const edges: Edge[] = [];

  graphData.nodeIds.forEach((nodeIdStr, index) => {
    const nodeId = normalizeNodeId(nodeIdStr);

    // Skip archived (soft-deleted) nodes.
    if (archivedNodeIds.has(nodeId.toString()) || archivedNodeIds.has(String(nodeId))) return;

    // Prefer a locally-saved event (has a resolved url/description) over the
    // raw graphData value.
    const localEvent = localEvents[nodeId.toString()] || localEvents[String(nodeId)];

    const rawUrl = graphData.urls[index] || '';
    const url =
      localEvent?.videoUrl || (typeof rawUrl === 'string' && !isBytes32Hash(rawUrl) ? rawUrl : '');

    // description may arrive as a string or a {timestamp, description} object.
    const rawDesc = graphData.descriptions[index];
    const rawDescStr =
      rawDesc && typeof rawDesc === 'object' && 'description' in rawDesc
        ? String((rawDesc as any).description)
        : String(rawDesc || '');
    const description = localEvent?.description || (isBytes32Hash(rawDescStr) ? '' : rawDescStr);

    const previousNode = graphData.previousNodes[index] || '';
    const isCanon = graphData.flags[index] || false;

    const isInCanonChain =
      !!graphData.canonChain &&
      graphData.canonChain.some((canonId: any) => normalizeNodeId(canonId) === nodeId);

    const position = layout.nodePositions.get(nodeId) || { x: 100, y: 100 };
    const color = isCanon ? colors[0] : colors[(index + 1) % colors.length];

    const displayLabel =
      localEvent?.title ||
      (description && description.length > 0 && description !== `Timeline event ${nodeId}`
        ? description.substring(0, 50) + (description.length > 50 ? '...' : '')
        : `Event ${nodeId}`);

    const childNodes = graphData.children[index];
    const childCount = Array.isArray(childNodes) ? childNodes.length : 0;
    const segmentCount = getSegmentCount ? getSegmentCount(nodeId) : 0;

    let videoVersions: any[] | undefined;
    let currentVersionIndex: number | undefined;
    if (localEvent?.videoVersions && localEvent.videoVersions.length > 0) {
      videoVersions = localEvent.videoVersions.map((v: any) => ({
        videoUrl: v.videoUrl,
        versionNumber: v.versionNumber,
        generatedAt: v.generatedAt,
        model: v.model,
      }));
      currentVersionIndex = localEvent.currentVersionIndex ?? -1;
    }

    nodes.push({
      id: `blockchain-node-${nodeId}`,
      type: 'timelineEvent',
      position,
      data: {
        label: displayLabel,
        description: description || `Event ${nodeId}`,
        videoUrl: url,
        timelineColor: color,
        nodeType: 'scene',
        eventId: nodeId.toString(),
        blockchainNodeId: nodeId,
        displayName: nodeId.toString(),
        timelineId: `timeline-1`,
        universeId,
        isRoot: String(previousNode) === '0' || !previousNode,
        isInCanonChain,
        segmentCount: segmentCount > 1 ? segmentCount : undefined,
        childCount: childCount > 1 ? childCount : undefined,
        isSelected: false,
        videoVersions,
        currentVersionIndex,
        trimStart: localEvent?.trimStart,
        trimEnd: localEvent?.trimEnd,
      } as TimelineNodeData,
    });
  });

  graphData.nodeIds.forEach((nodeIdStr, index) => {
    const nodeId = normalizeNodeId(nodeIdStr);
    const previousNodeStr = graphData.previousNodes[index];
    if (!previousNodeStr || String(previousNodeStr) === '0') return;

    const previousNodeId = normalizeNodeId(previousNodeStr);
    const isCanonEdge = graphData.flags[index];
    const color = isCanonEdge ? colors[0] : colors[(index + 1) % colors.length];

    // A branch is a non-first child of a parent that has more than one child.
    const parentChildren = layout.nodesByParent.get(previousNodeId) || [];
    const isBranch = parentChildren.length > 1 && parentChildren.indexOf(nodeId) > 0;

    edges.push({
      id: `edge-${previousNodeId}-${nodeId}`,
      source: `blockchain-node-${previousNodeId}`,
      target: `blockchain-node-${nodeId}`,
      animated: true,
      label: isCanonEdge ? 'Canon' : isBranch ? 'Branch' : undefined,
      labelStyle: { fill: isCanonEdge ? '#eab308' : '#94a3b8', fontSize: 10, fontWeight: 600 },
      labelBgStyle: { fill: '#09090b', fillOpacity: 0.85 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      style: { stroke: color, strokeWidth: isCanonEdge ? 3 : 2 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
    });
  });

  return { nodes, edges };
}
