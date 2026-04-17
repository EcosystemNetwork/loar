/**
 * Node Outline Panel
 *
 * A collapsible sidebar showing all timeline nodes in a tree hierarchy.
 * Supports search, click-to-navigate, arc badges, and drag reorder.
 */

import { useState, useMemo, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Search, ChevronRight, ChevronDown, Film, Eye, GripVertical, Locate } from 'lucide-react';
import type { Node, Edge } from 'reactflow';
import type { TimelineNodeData } from './TimelineNodes';
import type { ArcDefinition } from './types';
import { getSceneNodes, buildParentMap, findRootNodes } from './types';

interface NodeOutlinePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: Node<TimelineNodeData>[];
  edges: Edge[];
  arcs: ArcDefinition[];
  selectedNodeIds: Set<string>;
  onNavigateToNode: (node: Node<TimelineNodeData>) => void;
  onToggleSelect: (nodeId: string) => void;
}

interface TreeNodeProps {
  node: Node<TimelineNodeData>;
  childrenMap: Map<string, string[]>;
  allNodes: Map<string, Node<TimelineNodeData>>;
  arcs: ArcDefinition[];
  selectedNodeIds: Set<string>;
  searchQuery: string;
  onNavigate: (node: Node<TimelineNodeData>) => void;
  onToggleSelect: (nodeId: string) => void;
  depth: number;
}

function TreeNode({
  node,
  childrenMap,
  allNodes,
  arcs,
  selectedNodeIds,
  searchQuery,
  onNavigate,
  onToggleSelect,
  depth,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const children = childrenMap.get(node.id) || [];
  const hasChildren = children.length > 0;
  const arc = arcs.find((a) => a.nodeIds.includes(node.id));
  const isSelected = selectedNodeIds.has(node.id);

  // Check if this node or any descendant matches the search
  const matchesSearch = useMemo(() => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const checkNode = (nid: string): boolean => {
      const n = allNodes.get(nid);
      if (!n) return false;
      const text = [n.data.label, n.data.description, n.data.eventId, n.data.displayName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (text.includes(q)) return true;
      const kids = childrenMap.get(nid) || [];
      return kids.some(checkNode);
    };
    return checkNode(node.id);
  }, [searchQuery, node.id, allNodes, childrenMap]);

  if (!matchesSearch) return null;

  const label = node.data.displayName || node.data.label || `Event ${node.data.eventId || '?'}`;

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 px-2 rounded-md cursor-pointer transition-colors group ${
          isSelected ? 'bg-blue-500/20 text-blue-300' : 'hover:bg-zinc-800 text-zinc-300'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onNavigate(node)}
      >
        {/* Expand/collapse */}
        <button
          className="w-4 h-4 flex items-center justify-center shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) setExpanded(!expanded);
          }}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )
          ) : (
            <span className="w-3" />
          )}
        </button>

        {/* Color dot */}
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: node.data.timelineColor || '#10b981' }}
        />

        {/* Label */}
        <span className="text-xs truncate flex-1 min-w-0">{label}</span>

        {/* Badges */}
        {node.data.isInCanonChain && (
          <Badge
            variant="secondary"
            className="bg-yellow-500/20 text-yellow-400 text-[9px] px-1 py-0 h-4"
          >
            Canon
          </Badge>
        )}
        {arc && (
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 h-4 border-current"
            style={{ color: arc.color }}
          >
            {arc.name}
          </Badge>
        )}
        {node.data.videoUrl && <Film className="h-3 w-3 text-zinc-500 shrink-0" />}

        {/* Actions on hover */}
        <button
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(node.id);
          }}
          title={isSelected ? 'Deselect' : 'Select'}
        >
          <Eye className={`h-3 w-3 ${isSelected ? 'text-blue-400' : 'text-zinc-600'}`} />
        </button>
        <Locate className="h-3 w-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      </div>

      {/* Children */}
      {expanded &&
        hasChildren &&
        children.map((childId) => {
          const childNode = allNodes.get(childId);
          if (!childNode) return null;
          return (
            <TreeNode
              key={childId}
              node={childNode}
              childrenMap={childrenMap}
              allNodes={allNodes}
              arcs={arcs}
              selectedNodeIds={selectedNodeIds}
              searchQuery={searchQuery}
              onNavigate={onNavigate}
              onToggleSelect={onToggleSelect}
              depth={depth + 1}
            />
          );
        })}
    </div>
  );
}

export function NodeOutlinePanel({
  open,
  onOpenChange,
  nodes,
  edges,
  arcs,
  selectedNodeIds,
  onNavigateToNode,
  onToggleSelect,
}: NodeOutlinePanelProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const sceneNodes = useMemo(() => getSceneNodes(nodes), [nodes]);
  const allNodesMap = useMemo(() => new Map(sceneNodes.map((n) => [n.id, n])), [sceneNodes]);
  const childrenMap = useMemo(() => buildParentMap(nodes, edges), [nodes, edges]);
  const roots = useMemo(() => findRootNodes(nodes, edges), [nodes, edges]);

  // Count stats
  const totalScenes = sceneNodes.length;
  const canonCount = sceneNodes.filter((n) => n.data.isInCanonChain).length;
  const withVideo = sceneNodes.filter((n) => n.data.videoUrl).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-80 bg-zinc-950 border-zinc-800 p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="text-sm font-medium text-zinc-200">Node Outline</SheetTitle>
        </SheetHeader>

        {/* Stats bar */}
        <div className="px-4 pb-2 flex items-center gap-3 text-[10px] text-zinc-500">
          <span>{totalScenes} nodes</span>
          <span>{canonCount} canon</span>
          <span>{withVideo} with video</span>
          <span>{selectedNodeIds.size} selected</span>
        </div>

        {/* Search */}
        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter nodes..."
              className="pl-7 h-7 text-xs bg-zinc-900 border-zinc-700"
            />
          </div>
        </div>

        {/* Tree */}
        <div
          className="flex-1 overflow-y-auto px-2 pb-4"
          style={{ maxHeight: 'calc(100vh - 140px)' }}
        >
          {roots.length === 0 ? (
            <div className="text-center text-sm text-zinc-500 py-8">No scene nodes</div>
          ) : (
            roots.map((root) => (
              <TreeNode
                key={root.id}
                node={root}
                childrenMap={childrenMap}
                allNodes={allNodesMap}
                arcs={arcs}
                selectedNodeIds={selectedNodeIds}
                searchQuery={searchQuery}
                onNavigate={onNavigateToNode}
                onToggleSelect={onToggleSelect}
                depth={0}
              />
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
