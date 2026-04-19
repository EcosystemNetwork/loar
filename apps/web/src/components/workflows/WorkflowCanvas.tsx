import { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toast } from 'sonner';
import {
  workflowNodeTypes,
  NODE_KIND_META,
  NODE_IO,
  type WorkflowNodeKind,
  type AnyNodeParams,
} from './node-types';
import { wouldCreateCycle } from './lib/cycleCheck';

export interface WorkflowCanvasHandle {
  serialize: () => { nodes: Node[]; edges: Edge[] };
  applyNodeUpdate: (nodeId: string, patch: Partial<AnyNodeParams>) => void;
  highlightNode: (nodeId: string) => void;
}

interface Props {
  initialNodes: Node[];
  initialEdges: Edge[];
  onChange: (nodes: Node[], edges: Edge[]) => void;
  onSelectionChange: (selectedNodeId: string | null) => void;
  highlightNodeIds?: string[];
}

function CanvasInner({
  initialNodes,
  initialEdges,
  onChange,
  onSelectionChange,
  highlightNodeIds,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const flow = useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const rfInstance = useRef<ReactFlowInstance | null>(null);

  // Notify parent on every change (debounced upstream by editor page)
  useEffect(() => {
    onChange(nodes, edges);
  }, [nodes, edges, onChange]);

  // Apply highlight pulses for active nodes during a run
  useEffect(() => {
    setNodes((current) =>
      current.map((n) => ({
        ...n,
        className: highlightNodeIds?.includes(n.id) ? 'wf-node-running' : '',
      }))
    );
  }, [highlightNodeIds, setNodes]);

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;

      // Validate handle compatibility per kind
      const source = nodes.find((n) => n.id === conn.source);
      const target = nodes.find((n) => n.id === conn.target);
      if (!source || !target) return;
      const sKind = source.type as WorkflowNodeKind;
      const tKind = target.type as WorkflowNodeKind;
      const validSourceHandle = NODE_IO[sKind].outputs.includes(conn.sourceHandle ?? '');
      const validTargetHandle = NODE_IO[tKind].inputs.includes(conn.targetHandle ?? '');
      if (!validSourceHandle || !validTargetHandle) {
        toast.error(`Cannot connect ${sKind}.${conn.sourceHandle} → ${tKind}.${conn.targetHandle}`);
        return;
      }

      // Cycle prevention
      if (wouldCreateCycle(nodes, edges, { source: conn.source, target: conn.target })) {
        toast.error('Connection would create a cycle');
        return;
      }
      setEdges((eds) =>
        addEdge({ ...conn, id: `e-${conn.source}-${conn.target}-${Date.now()}` }, eds)
      );
    },
    [nodes, edges, setEdges]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const kind = event.dataTransfer.getData('application/loar-node-kind') as WorkflowNodeKind;
      if (!kind || !workflowNodeTypes[kind]) return;
      const bounds = containerRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const position = flow.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });
      const newNode: Node = {
        id: `${kind}-${Date.now()}`,
        type: kind,
        position,
        data: { ...NODE_KIND_META[kind].defaultParams },
      };
      setNodes((nds) => nds.concat(newNode));
    },
    [flow, setNodes]
  );

  const onSelChange = useCallback(
    ({ nodes: selNodes }: { nodes: Node[] }) => {
      onSelectionChange(selNodes[0]?.id ?? null);
    },
    [onSelectionChange]
  );

  const memoNodeTypes = useMemo(() => workflowNodeTypes, []);

  return (
    <div ref={containerRef} className="h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(inst) => (rfInstance.current = inst)}
        onSelectionChange={onSelChange}
        nodeTypes={memoNodeTypes}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
      <style>{`
        .wf-node-running { animation: wf-pulse 1.2s ease-in-out infinite; }
        @keyframes wf-pulse {
          0%, 100% { filter: drop-shadow(0 0 0 rgba(59,130,246,0)); }
          50% { filter: drop-shadow(0 0 8px rgba(59,130,246,0.7)); }
        }
      `}</style>
    </div>
  );
}

export function WorkflowCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
