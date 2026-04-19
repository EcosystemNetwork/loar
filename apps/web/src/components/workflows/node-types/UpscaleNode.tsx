import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { ScalingIcon } from 'lucide-react';
import type { UpscaleNodeParams } from './shared';

export const UpscaleNode = memo(
  ({ data, selected, isConnectable }: NodeProps<UpscaleNodeParams>) => {
    return (
      <div
        className={`min-w-[200px] max-w-[240px] rounded-md border-2 bg-white shadow-md dark:bg-slate-900 ${
          selected ? 'border-amber-700 ring-2 ring-amber-300' : 'border-amber-400'
        }`}
      >
        <Handle
          type="target"
          position={Position.Left}
          id="imageUrl"
          isConnectable={isConnectable}
          className="!h-3 !w-3 !bg-amber-500"
        />
        <div className="flex items-center gap-2 rounded-t-sm bg-amber-50 px-3 py-2 dark:bg-amber-950">
          <ScalingIcon className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <div className="text-sm font-semibold text-amber-900 dark:text-amber-100">Upscale</div>
          <div className="ml-auto text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
            ×{data.factor ?? 4}
          </div>
        </div>
        <div className="px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
          {data.prompt ? (
            <div className="truncate text-[11px] text-slate-500">guide: {data.prompt}</div>
          ) : (
            <div className="text-[11px] text-slate-500">Real-ESRGAN</div>
          )}
        </div>
        <Handle
          type="source"
          position={Position.Right}
          id="imageUrl"
          isConnectable={isConnectable}
          className="!h-3 !w-3 !bg-amber-500"
        />
      </div>
    );
  }
);
UpscaleNode.displayName = 'UpscaleNode';
