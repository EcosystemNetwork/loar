/**
 * Timeline Flow With Data
 *
 * Data-fetching wrapper around TimelineFlowEditor. Loads the full graph from
 * the blockchain via useGetFullGraph, converts raw contract data into ReactFlow
 * nodes and edges, then passes them to the editor component.
 */

import { useState, useEffect } from 'react';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { Loader2 } from 'lucide-react';
import type { Node, Edge } from 'reactflow';
import { MarkerType } from 'reactflow';
import { TimelineFlowEditor } from './TimelineFlowEditor';
import type { TimelineNodeData } from './TimelineNodes';
import { useUniverseBlockchain } from '@/hooks/useUniverseBlockchain';

export function TimelineFlowWithData({
  universeId,
  timelineId,
  rootNodeId = 1,
  isCreateDialogOpen = false,
  setIsCreateDialogOpen = () => {},
  timelineAddress,
  readOnly = false,
}: {
  universeId: string;
  timelineId: string;
  rootNodeId?: number;
  isCreateDialogOpen?: boolean;
  setIsCreateDialogOpen?: (open: boolean) => void;
  timelineAddress?: string;
  readOnly?: boolean;
}) {
  const [initialNodes, setInitialNodes] = useState<Node<TimelineNodeData>[]>([]);
  const [initialEdges, setInitialEdges] = useState<Edge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { isConnected } = useAccount();

  const isBlockchainUniverse = !!universeId?.startsWith('0x');
  const contractAddress = isBlockchainUniverse ? universeId : timelineAddress;

  // Fetch graph data with Ponder-resolved content (URLs + descriptions)
  const { graphData, isLoadingAny: isLoadingGraph } = useUniverseBlockchain({
    universeId,
    contractAddress,
    isBlockchainUniverse,
  });

  const isError = !isLoadingGraph && !graphData.nodeIds.length && !!contractAddress;

  // Process the resolved graph data into ReactFlow nodes and edges
  useEffect(() => {
    if (!isConnected || isLoadingGraph || !graphData.nodeIds.length) {
      return;
    }

    try {
      setIsLoading(true);

      const nodes: Node<TimelineNodeData>[] = [];
      const edges: Edge[] = [];

      for (let i = 0; i < graphData.nodeIds.length; i++) {
        const id = Number(graphData.nodeIds[i]);
        const videoUrl = String(graphData.urls[i] || '');
        const plot = String(graphData.descriptions[i] || '');
        const previousId = Number(graphData.previousNodes[i]);
        const isCanon = Boolean(graphData.flags[i]);

        // Skip empty nodes (id === 0)
        if (id === 0) continue;

        const newNode: Node<TimelineNodeData> = {
          id: `node-${id}`,
          type: 'timelineEvent',
          position: {
            x: (id % 3) * 300,
            y: Math.floor(id / 3) * 200,
          },
          data: {
            label: `Event ${id}${isCanon ? ' (Canon)' : ''}`,
            description: plot,
            videoUrl: videoUrl,
            eventId: id.toString(),
            timelineId: timelineId,
            universeId: universeId,
            isCanon: isCanon,
          },
        };

        nodes.push(newNode);

        if (previousId > 0) {
          const newEdge: Edge = {
            id: `edge-node-${previousId}-node-${id}`,
            source: `node-${previousId}`,
            target: `node-${id}`,
            animated: true,
            style: { stroke: isCanon ? '#10b981' : '#94a3b8' },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: isCanon ? '#10b981' : '#94a3b8',
            },
          };
          edges.push(newEdge);
        }
      }

      setInitialNodes(nodes);
      setInitialEdges(edges);
    } catch (error) {
      // Error handled by loading state
    } finally {
      setIsLoading(false);
    }
  }, [graphData, isConnected, isLoadingGraph, timelineId, universeId]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-semibold">Narrative Timeline Editor</h2>
      <p className="text-muted-foreground">
        Create and connect narrative elements to build your story's timeline. Each node represents a
        plot point that can be connected to form a coherent narrative.
      </p>

      {!isConnected ? (
        <div className="h-[600px] w-full border rounded-lg flex flex-col items-center justify-center gap-4">
          <p className="text-lg">Connect your wallet to view and edit the timeline</p>
          <p className="text-sm text-muted-foreground">
            You need to connect a wallet to interact with the blockchain
          </p>
        </div>
      ) : isLoading || isLoadingGraph ? (
        <div className="h-[600px] w-full border rounded-lg flex items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p>Loading timeline data from blockchain...</p>
          </div>
        </div>
      ) : isError ? (
        <div className="h-[600px] w-full border rounded-lg flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-destructive">
            <p>Error loading timeline data</p>
            <p className="text-sm">Please check your connection and try again</p>
          </div>
        </div>
      ) : (
        <TimelineFlowEditor
          universeId={universeId}
          timelineId={timelineId}
          initialNodes={initialNodes}
          initialEdges={initialEdges}
          rootNodeId={rootNodeId}
          isCreateDialogOpen={readOnly ? false : isCreateDialogOpen}
          setIsCreateDialogOpen={readOnly ? () => {} : setIsCreateDialogOpen}
          readOnly={readOnly}
        />
      )}
    </div>
  );
}
