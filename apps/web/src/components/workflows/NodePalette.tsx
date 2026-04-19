import { Sparkles, Image as ImageIcon, Film, ScalingIcon } from 'lucide-react';
import { NODE_KIND_META, type WorkflowNodeKind } from './node-types';

const ICONS: Record<WorkflowNodeKind, React.ComponentType<{ className?: string }>> = {
  prompt: Sparkles,
  ref: ImageIcon,
  animate: Film,
  upscale: ScalingIcon,
};

const ACCENT_BG: Record<string, string> = {
  violet: 'bg-violet-50 dark:bg-violet-950 border-violet-300',
  emerald: 'bg-emerald-50 dark:bg-emerald-950 border-emerald-300',
  blue: 'bg-blue-50 dark:bg-blue-950 border-blue-300',
  amber: 'bg-amber-50 dark:bg-amber-950 border-amber-300',
};

export function NodePalette() {
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Drag onto canvas
      </div>
      {(Object.keys(NODE_KIND_META) as WorkflowNodeKind[]).map((kind) => {
        const meta = NODE_KIND_META[kind];
        const Icon = ICONS[kind];
        return (
          <div
            key={kind}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('application/loar-node-kind', kind);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={`cursor-grab rounded-md border p-2 transition-shadow active:cursor-grabbing hover:shadow-md ${ACCENT_BG[meta.accent] ?? ''}`}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4" />
              <div className="text-sm font-semibold">{meta.label}</div>
            </div>
            <div className="mt-1 text-[11px] leading-snug text-muted-foreground">
              {meta.description}
            </div>
          </div>
        );
      })}
    </div>
  );
}
