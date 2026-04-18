/**
 * Custom ReactFlow Nodes
 *
 * Presentational node types for the narrative flow graph:
 * - CharacterNode: character card with emoji avatar and optional NFT ID
 * - PlotPointNode: green-bordered story beat with timestamp
 * - MediaNode: purple-bordered media item (image/video/audio)
 * - VotingNode: amber-bordered governance voting node with vote counts
 */

import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { LoarIcon, type LoarIconName } from '@/components/loar-icons';

export const CharacterNode = memo(({ data, isConnectable, selected }: NodeProps) => {
  return (
    <div
      className={`px-4 py-2 shadow-md rounded-md bg-white border-2 ${selected ? 'border-blue-700 ring-2 ring-blue-300' : 'border-blue-500'} dark:bg-slate-800`}
    >
      <div className="flex items-center">
        <div className="rounded-full w-10 h-10 flex justify-center items-center bg-blue-100 dark:bg-blue-900">
          <LoarIcon name={(data.emoji as LoarIconName) || 'hero'} size={20} />
        </div>
        <div className="ml-2">
          <div className="text-lg font-bold">{data.label}</div>
          {data.nftId && <div className="text-xs text-muted-foreground">NFT: {data.nftId}</div>}
        </div>
      </div>
      {data.description && (
        <div className="mt-2 text-sm text-muted-foreground">{data.description}</div>
      )}
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
});

export const PlotPointNode = memo(({ data, isConnectable, selected }: NodeProps) => {
  return (
    <div
      className={`px-4 py-2 shadow-md rounded-md bg-white border-2 ${selected ? 'border-green-700 ring-2 ring-green-300' : 'border-green-500'} dark:bg-slate-800`}
    >
      <div className="flex items-center">
        <div className="rounded-full w-10 h-10 flex justify-center items-center bg-green-100 dark:bg-green-900">
          <LoarIcon name={(data.emoji as LoarIconName) || 'memo'} size={20} />
        </div>
        <div className="ml-2">
          <div className="text-lg font-bold">{data.label}</div>
          {data.canonicity && (
            <div className="text-xs text-muted-foreground">{data.canonicity}</div>
          )}
        </div>
      </div>
      {data.description && (
        <div className="mt-2 text-sm text-muted-foreground">{data.description}</div>
      )}
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
});

export const MediaNode = memo(({ data, isConnectable, selected }: NodeProps) => {
  return (
    <div
      className={`px-4 py-2 shadow-md rounded-md bg-white border-2 ${selected ? 'border-purple-700 ring-2 ring-purple-300' : 'border-purple-500'} dark:bg-slate-800`}
    >
      <div className="flex items-center">
        <div className="rounded-full w-10 h-10 flex justify-center items-center bg-purple-100 dark:bg-purple-900">
          <LoarIcon name={(data.emoji as LoarIconName) || 'clapperboard'} size={20} />
        </div>
        <div className="ml-2">
          <div className="text-lg font-bold">{data.label}</div>
          {data.storageType && (
            <div className="text-xs text-muted-foreground">{data.storageType}</div>
          )}
        </div>
      </div>
      {data.description && (
        <div className="mt-2 text-sm text-muted-foreground">{data.description}</div>
      )}
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
});

export const VotingNode = memo(({ data, isConnectable, selected }: NodeProps) => {
  return (
    <div
      className={`px-4 py-2 shadow-md rounded-md bg-white border-2 ${selected ? 'border-amber-700 ring-2 ring-amber-300' : 'border-amber-500'} dark:bg-slate-800`}
    >
      <div className="flex items-center">
        <div className="rounded-full w-10 h-10 flex justify-center items-center bg-amber-100 dark:bg-amber-900">
          <LoarIcon name={(data.emoji as LoarIconName) || 'ballot'} size={20} />
        </div>
        <div className="ml-2">
          <div className="text-lg font-bold">{data.label}</div>
          {data.status && (
            <div className="text-xs text-muted-foreground">Status: {data.status}</div>
          )}
        </div>
      </div>
      {data.description && (
        <div className="mt-2 text-sm text-muted-foreground">{data.description}</div>
      )}
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  );
});
