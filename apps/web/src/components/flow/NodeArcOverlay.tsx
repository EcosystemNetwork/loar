/**
 * Node Arc Overlay
 *
 * Renders colored bounding rectangles around groups of nodes
 * that belong to the same arc. Displayed as an SVG layer within
 * the ReactFlow viewport using useReactFlow's viewport transform.
 */

import { useMemo } from 'react';
import { useReactFlow } from 'reactflow';
import type { Node } from 'reactflow';
import type { TimelineNodeData } from './TimelineNodes';
import type { ArcDefinition } from './types';

interface NodeArcOverlayProps {
  nodes: Node<TimelineNodeData>[];
  arcs: ArcDefinition[];
}

interface ArcBounds {
  arc: ArcDefinition;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const NODE_WIDTH = 320; // w-80 = 320px
const NODE_HEIGHT = 288; // h-72 = 288px
const PADDING = 24;

export function NodeArcOverlay({ nodes, arcs }: NodeArcOverlayProps) {
  const { getViewport } = useReactFlow();
  const viewport = getViewport();

  const arcBounds = useMemo(() => {
    const bounds: ArcBounds[] = [];

    for (const arc of arcs) {
      if (arc.nodeIds.length === 0) continue;

      const arcNodes = nodes.filter((n) => arc.nodeIds.includes(n.id));
      if (arcNodes.length === 0) continue;

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (const node of arcNodes) {
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + NODE_WIDTH);
        maxY = Math.max(maxY, node.position.y + NODE_HEIGHT);
      }

      bounds.push({
        arc,
        minX: minX - PADDING,
        minY: minY - PADDING,
        maxX: maxX + PADDING,
        maxY: maxY + PADDING,
      });
    }

    return bounds;
  }, [nodes, arcs]);

  if (arcBounds.length === 0) return null;

  return (
    <svg
      className="absolute inset-0 pointer-events-none z-0"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'visible',
      }}
    >
      <g transform={`translate(${viewport.x}, ${viewport.y}) scale(${viewport.zoom})`}>
        {arcBounds.map(({ arc, minX, minY, maxX, maxY }) => (
          <g key={arc.id}>
            {/* Background fill */}
            <rect
              x={minX}
              y={minY}
              width={maxX - minX}
              height={maxY - minY}
              rx={12}
              ry={12}
              fill={arc.color}
              fillOpacity={0.06}
              stroke={arc.color}
              strokeOpacity={0.25}
              strokeWidth={1.5 / viewport.zoom}
              strokeDasharray={`${6 / viewport.zoom} ${4 / viewport.zoom}`}
            />
            {/* Label */}
            <text
              x={minX + 8}
              y={minY - 6}
              fill={arc.color}
              fontSize={12 / viewport.zoom}
              fontWeight="600"
              fontFamily="system-ui, sans-serif"
              opacity={0.7}
            >
              {arc.name}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
