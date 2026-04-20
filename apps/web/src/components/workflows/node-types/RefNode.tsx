import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { Image as ImageIcon } from 'lucide-react';
import type { RefNodeParams } from './shared';

export const RefNode = memo(({ data, selected, isConnectable }: NodeProps<RefNodeParams>) => {
  const label = data.assetUrl
    ? data.assetUrl.split('/').pop()?.slice(0, 24) || data.assetUrl
    : data.entityId
      ? `entity ${data.entityId.slice(0, 10)}…`
      : '(no source)';

  return (
    <div
      className={`min-w-[200px] max-w-[240px] rounded-md border-2 bg-white shadow-md dark:bg-slate-900 ${
        selected ? 'border-emerald-700 ring-2 ring-emerald-300' : 'border-emerald-400'
      }`}
    >
      <div className="flex items-center gap-2 rounded-t-sm bg-emerald-50 px-3 py-2 dark:bg-emerald-950">
        <ImageIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <div className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
          Reference
        </div>
      </div>
      <div className="px-3 py-2">
        {data.assetUrl ? (
          <img
            src={data.assetUrl}
            alt=""
            className="max-h-20 w-full rounded object-cover"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
        ) : null}
        <div className="mt-1 truncate text-[11px] text-slate-500">{label}</div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="imageUrl"
        isConnectable={isConnectable}
        className="!h-3 !w-3 !bg-emerald-500"
      />
    </div>
  );
});
RefNode.displayName = 'RefNode';
