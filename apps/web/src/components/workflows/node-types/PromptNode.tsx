import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Sparkles } from 'lucide-react';
import type { PromptNodeParams } from './shared';

export const PromptNode = memo(({ data, selected, isConnectable }: NodeProps<PromptNodeParams>) => {
  const text = data.text?.trim() || '(empty prompt)';
  const preview = text.length > 90 ? `${text.slice(0, 90)}…` : text;

  return (
    <div
      className={`min-w-[220px] max-w-[260px] rounded-md border-2 bg-white shadow-md dark:bg-slate-900 ${
        selected ? 'border-violet-700 ring-2 ring-violet-300' : 'border-violet-400'
      }`}
    >
      <div className="flex items-center gap-2 rounded-t-sm bg-violet-50 px-3 py-2 dark:bg-violet-950">
        <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
        <div className="text-sm font-semibold text-violet-900 dark:text-violet-100">Prompt</div>
        <div className="ml-auto text-[10px] uppercase tracking-wider text-violet-600 dark:text-violet-400">
          imagen 4
        </div>
      </div>
      <div className="px-3 py-2">
        <div className="text-xs text-slate-700 dark:text-slate-300">{preview}</div>
        {data.aspectRatio && (
          <div className="mt-1 text-[10px] text-slate-500">aspect {data.aspectRatio}</div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="imageUrl"
        isConnectable={isConnectable}
        className="!h-3 !w-3 !bg-violet-500"
      />
    </div>
  );
});
PromptNode.displayName = 'PromptNode';
