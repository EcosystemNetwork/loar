import type { Node } from 'reactflow';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  AnimateNodeParams,
  AnyNodeParams,
  PromptNodeParams,
  RefNodeParams,
  UpscaleNodeParams,
  WorkflowNodeKind,
} from './node-types';

interface Props {
  node: Node | null;
  onChange: (nodeId: string, patch: Partial<AnyNodeParams>) => void;
  onDelete: (nodeId: string) => void;
}

export function NodeInspector({ node, onChange, onDelete }: Props) {
  if (!node) {
    return (
      <div className="p-4 text-sm text-muted-foreground">Select a node to edit its parameters.</div>
    );
  }
  const kind = node.type as WorkflowNodeKind;
  const data = node.data as AnyNodeParams;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-wider">{kind}</div>
        <button className="text-xs text-red-500 hover:underline" onClick={() => onDelete(node.id)}>
          delete
        </button>
      </div>
      {kind === 'prompt' && (
        <PromptForm node={node} data={data as PromptNodeParams} onChange={onChange} />
      )}
      {kind === 'ref' && <RefForm node={node} data={data as RefNodeParams} onChange={onChange} />}
      {kind === 'animate' && (
        <AnimateForm node={node} data={data as AnimateNodeParams} onChange={onChange} />
      )}
      {kind === 'upscale' && (
        <UpscaleForm node={node} data={data as UpscaleNodeParams} onChange={onChange} />
      )}
    </div>
  );
}

const ASPECT_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;

function PromptForm({
  node,
  data,
  onChange,
}: {
  node: Node;
  data: PromptNodeParams;
  onChange: Props['onChange'];
}) {
  return (
    <>
      <div>
        <Label htmlFor="text">Prompt</Label>
        <Textarea
          id="text"
          value={data.text ?? ''}
          rows={4}
          onChange={(e) => onChange(node.id, { text: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="negative">Negative prompt</Label>
        <Textarea
          id="negative"
          value={data.negativePrompt ?? ''}
          rows={2}
          onChange={(e) => onChange(node.id, { negativePrompt: e.target.value })}
        />
      </div>
      <div>
        <Label htmlFor="aspect">Aspect ratio</Label>
        <Select
          value={data.aspectRatio ?? '1:1'}
          onValueChange={(v) =>
            onChange(node.id, { aspectRatio: v as PromptNodeParams['aspectRatio'] })
          }
        >
          <SelectTrigger id="aspect">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASPECT_RATIOS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="seed">Seed (optional)</Label>
        <Input
          id="seed"
          type="number"
          value={data.seed ?? ''}
          onChange={(e) =>
            onChange(node.id, { seed: e.target.value ? Number(e.target.value) : undefined })
          }
        />
      </div>
    </>
  );
}

function RefForm({
  node,
  data,
  onChange,
}: {
  node: Node;
  data: RefNodeParams;
  onChange: Props['onChange'];
}) {
  return (
    <>
      <div>
        <Label htmlFor="assetUrl">Asset URL</Label>
        <Input
          id="assetUrl"
          value={data.assetUrl ?? ''}
          placeholder="https://…/image.png"
          onChange={(e) => onChange(node.id, { assetUrl: e.target.value || undefined })}
        />
      </div>
      <div className="text-center text-xs text-muted-foreground">— or —</div>
      <div>
        <Label htmlFor="entityId">Entity ID</Label>
        <Input
          id="entityId"
          value={data.entityId ?? ''}
          placeholder="entity-uuid…"
          onChange={(e) => onChange(node.id, { entityId: e.target.value || undefined })}
        />
        <div className="mt-1 text-[11px] text-muted-foreground">
          Resolves the entity's portrait at run-time.
        </div>
      </div>
    </>
  );
}

function AnimateForm({
  node,
  data,
  onChange,
}: {
  node: Node;
  data: AnimateNodeParams;
  onChange: Props['onChange'];
}) {
  return (
    <>
      <div>
        <Label htmlFor="duration">Duration (s)</Label>
        <Input
          id="duration"
          type="number"
          min={2}
          max={10}
          value={data.durationSec ?? 5}
          onChange={(e) => onChange(node.id, { durationSec: Number(e.target.value) || 5 })}
        />
      </div>
      <div>
        <Label htmlFor="aspect">Aspect ratio</Label>
        <Select
          value={data.aspectRatio ?? '16:9'}
          onValueChange={(v) =>
            onChange(node.id, { aspectRatio: v as AnimateNodeParams['aspectRatio'] })
          }
        >
          <SelectTrigger id="aspect">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ASPECT_RATIOS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="hint">Model hint</Label>
        <Select
          value={data.modelHint ?? 'balanced'}
          onValueChange={(v) =>
            onChange(node.id, { modelHint: v as AnimateNodeParams['modelHint'] })
          }
        >
          <SelectTrigger id="hint">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fastest">Fastest / cheapest</SelectItem>
            <SelectItem value="balanced">Balanced (default)</SelectItem>
            <SelectItem value="highest_quality">Highest quality</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="motionPrompt">Motion prompt (optional)</Label>
        <Textarea
          id="motionPrompt"
          value={data.motionPrompt ?? ''}
          rows={2}
          onChange={(e) => onChange(node.id, { motionPrompt: e.target.value || undefined })}
        />
      </div>
    </>
  );
}

function UpscaleForm({
  node,
  data,
  onChange,
}: {
  node: Node;
  data: UpscaleNodeParams;
  onChange: Props['onChange'];
}) {
  return (
    <>
      <div>
        <Label htmlFor="factor">Scale</Label>
        <Select
          value={String(data.factor ?? 4)}
          onValueChange={(v) =>
            onChange(node.id, { factor: Number(v) as UpscaleNodeParams['factor'] })
          }
        >
          <SelectTrigger id="factor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2">×2</SelectItem>
            <SelectItem value="4">×4</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="upscale-prompt">Creative guide prompt (optional)</Label>
        <Textarea
          id="upscale-prompt"
          value={data.prompt ?? ''}
          rows={2}
          placeholder="Switches to creative-upscaler when filled"
          onChange={(e) => onChange(node.id, { prompt: e.target.value || undefined })}
        />
      </div>
    </>
  );
}
