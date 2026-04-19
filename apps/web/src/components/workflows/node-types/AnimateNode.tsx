import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Film } from 'lucide-react';
import type { AnimateNodeParams } from './shared';

export const AnimateNode = memo(
  ({ data, selected, isConnectable }: NodeProps<AnimateNodeParams>) => {
    return (
      <div
        className={`min-w-[220px] max-w-[260px] rounded-md border-2 bg-white shadow-md dark:bg-slate-900 ${
          selected ? 'border-blue-700 ring-2 ring-blue-300' : 'border-blue-400'
        }`}
      >
        <Handle
          type="target"
          position={Position.Left}
          id="imageUrl"
          isConnectable={isConnectable}
          className="!h-3 !w-3 !bg-blue-500"
        />
        <div className="flex items-center gap-2 rounded-t-sm bg-blue-50 px-3 py-2 dark:bg-blue-950">
          <Film className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <div className="text-sm font-semibold text-blue-900 dark:text-blue-100">Animate</div>
          <div className="ml-auto text-[10px] uppercase tracking-wider text-blue-600 dark:text-blue-400">
            {data.modelHint || 'balanced'}
          </div>
        </div>
        <div className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
          <div>
            {data.durationSec ?? 5}s · {data.aspectRatio ?? '16:9'}
          </div>
          {data.motionPrompt && (
            <div className="mt-1 truncate text-[11px] text-slate-500">{data.motionPrompt}</div>
          )}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="videoUrl"
          isConnectable={isConnectable}
          className="!h-3 !w-3 !bg-blue-500"
        />
      </div>
    );
  }
);
AnimateNode.displayName = 'AnimateNode';
