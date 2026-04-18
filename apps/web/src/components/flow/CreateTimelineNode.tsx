/**
 * Create Timeline Node Form
 *
 * Form card for creating a new timeline node with a plot description.
 * Calls createNode on the Universe smart contract via useCreateNode hook.
 *
 * @param previousNodeId - The parent node ID this new node follows
 * @param onSuccess - Callback invoked with the new node's ID after creation
 */

import { useState } from 'react';
import { keccak256, toBytes, decodeEventLog, type Log } from 'viem';
import { usePublicClient } from 'wagmi';
import { useCreateNode } from '@/hooks/useTimeline';
import { universeAbi } from '@loar/abis/generated';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

interface CreateTimelineNodeProps {
  previousNodeId: number;
  onSuccess: (nodeId: number) => void;
}

export function CreateTimelineNode({ previousNodeId, onSuccess }: CreateTimelineNodeProps) {
  const [plot, setPlot] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { writeAsync } = useCreateNode();
  const publicClient = usePublicClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!plot.trim()) {
      return;
    }

    setIsLoading(true);

    try {
      // Compute hashes for on-chain storage
      const contentHash = keccak256(toBytes(plot));
      const plotHash = keccak256(toBytes(plot));

      // Call createNode on the Universe contract
      const txHash = await writeAsync(contentHash, plotHash, previousNodeId, '', plot);

      // Wait for receipt and extract real node ID from NodeCreated event
      let nodeId = previousNodeId + 1; // fallback
      if (publicClient) {
        try {
          const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
          for (const log of receipt.logs) {
            try {
              const decoded = decodeEventLog({
                abi: universeAbi,
                data: log.data,
                topics: log.topics,
              });
              if (decoded.eventName === 'NodeCreated') {
                nodeId = Number((decoded.args as any).id);
                break;
              }
            } catch {
              // Not a NodeCreated event
            }
          }
        } catch {
          // Receipt fetch failed — use fallback
        }
      }

      toast.success(`Timeline event #${nodeId} created on-chain`);
      onSuccess(nodeId);
      setPlot('');
    } catch (error) {
      toast.error('Failed to create timeline event. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="p-6 w-full max-w-md">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Create New Timeline Event</h3>
          <p className="text-sm text-muted-foreground">Add a new narrative event to the timeline</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="plot">Plot Description</Label>
            <textarea
              id="plot"
              value={plot}
              onChange={(e) => setPlot(e.target.value)}
              placeholder="Describe what happens in this part of the story..."
              className="w-full min-h-[100px] p-3 border border-border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div className="text-sm text-muted-foreground">Previous Node ID: {previousNodeId}</div>

          <div className="flex gap-2">
            <Button type="submit" disabled={!plot.trim() || isLoading} className="flex-1">
              {isLoading ? 'Creating...' : 'Create Event'}
            </Button>
          </div>
        </form>
      </div>
    </Card>
  );
}
