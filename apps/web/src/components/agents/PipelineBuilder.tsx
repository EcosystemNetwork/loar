/**
 * Pipeline Builder — Visual editor for creating AI agent pipelines
 */
import { useCreatePipeline } from '@/hooks/useAIPipelines';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { useState } from 'react';
import { Workflow, Plus, Trash2, ArrowDown, X, GripVertical } from 'lucide-react';

const AVAILABLE_ACTIONS = [
  { value: 'entities.create', label: 'Create Entity', cost: 0 },
  { value: 'entities.update', label: 'Update Entity', cost: 0 },
  { value: 'studio.createEntityPack', label: 'Generate Asset Pack', cost: 10 },
  { value: 'generation.generate', label: 'Generate Video', cost: 15 },
  { value: 'image.generate', label: 'Generate Image', cost: 5 },
  { value: 'marketplace.submit', label: 'Submit to Canon', cost: 0 },
  { value: 'collabs.propose', label: 'Propose Collab', cost: 0 },
  { value: 'content.create', label: 'Create Content', cost: 0 },
  { value: 'wiki.generate', label: 'Generate Lore Entry', cost: 0 },
] as const;

const FAILURE_BEHAVIORS = [
  { value: 'abort', label: 'Abort Pipeline' },
  { value: 'skip', label: 'Skip Step' },
  { value: 'retry', label: 'Retry Step' },
] as const;

interface PipelineStep {
  stepId: string;
  action: string;
  inputMapping: Record<string, string>;
  config: Record<string, unknown>;
  onFailure: 'skip' | 'abort' | 'retry';
  retryCount: number;
}

interface Props {
  aiAgentId: string;
  onClose: () => void;
  onCreated?: () => void;
}

export function PipelineBuilder({ aiAgentId, onClose, onCreated }: Props) {
  const create = useCreatePipeline();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<PipelineStep[]>([
    {
      stepId: 'step_1',
      action: 'entities.create',
      inputMapping: {},
      config: {},
      onFailure: 'abort',
      retryCount: 0,
    },
  ]);

  const addStep = () => {
    const stepNum = steps.length + 1;
    setSteps((prev) => [
      ...prev,
      {
        stepId: `step_${stepNum}`,
        action: 'entities.create',
        inputMapping: {},
        config: {},
        onFailure: 'abort',
        retryCount: 0,
      },
    ]);
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const updateStep = (index: number, updates: Partial<PipelineStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...updates } : s)));
  };

  const addConfigField = (stepIndex: number, key: string, value: string) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === stepIndex ? { ...s, config: { ...s.config, [key]: value } } : s))
    );
  };

  const addInputMapping = (stepIndex: number, key: string, path: string) => {
    setSteps((prev) =>
      prev.map((s, i) =>
        i === stepIndex ? { ...s, inputMapping: { ...s.inputMapping, [key]: path } } : s
      )
    );
  };

  const estimatedCredits = steps.reduce((sum, s) => {
    const action = AVAILABLE_ACTIONS.find((a) => a.value === s.action);
    return sum + (action?.cost || 0);
  }, 0);

  const handleSubmit = async () => {
    if (!name) {
      toast.error('Pipeline name is required');
      return;
    }
    if (steps.length === 0) {
      toast.error('Add at least one step');
      return;
    }

    try {
      await create.mutateAsync({
        name,
        description,
        aiAgentId,
        steps,
        triggerType: 'manual',
        triggerConfig: {},
      });
      toast.success('Pipeline created!');
      onCreated?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create pipeline');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Workflow className="h-5 w-5 text-cyan-400" />
            Build Pipeline
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <Input
            placeholder="Pipeline name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {/* Steps */}
          <div className="space-y-3">
            {steps.map((step, index) => (
              <div key={step.stepId}>
                {index > 0 && (
                  <div className="flex justify-center py-1">
                    <ArrowDown className="h-4 w-4 text-zinc-600" />
                  </div>
                )}
                <Card className="relative p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <GripVertical className="h-4 w-4 text-zinc-600" />
                    <Badge variant="outline" className="text-xs">
                      {step.stepId}
                    </Badge>
                    <div className="flex-1" />
                    {steps.length > 1 && (
                      <button
                        onClick={() => removeStep(index)}
                        className="text-zinc-500 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  {/* Action Select */}
                  <select
                    value={step.action}
                    onChange={(e) => updateStep(index, { action: e.target.value })}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-white"
                  >
                    {AVAILABLE_ACTIONS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label} {a.cost > 0 ? `(~${a.cost} credits)` : '(free)'}
                      </option>
                    ))}
                  </select>

                  {/* Config fields */}
                  <div className="mt-2">
                    <p className="mb-1 text-xs text-zinc-500">Config (key=value)</p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="key"
                        className="w-24 text-xs"
                        id={`config-key-${index}`}
                      />
                      <Input
                        placeholder="value"
                        className="flex-1 text-xs"
                        id={`config-val-${index}`}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const keyEl = document.getElementById(
                            `config-key-${index}`
                          ) as HTMLInputElement;
                          const valEl = document.getElementById(
                            `config-val-${index}`
                          ) as HTMLInputElement;
                          if (keyEl?.value && valEl?.value) {
                            addConfigField(index, keyEl.value, valEl.value);
                            keyEl.value = '';
                            valEl.value = '';
                          }
                        }}
                      >
                        Add
                      </Button>
                    </div>
                    {Object.keys(step.config).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {Object.entries(step.config).map(([k, v]) => (
                          <Badge key={k} variant="secondary" className="text-xs">
                            {k}={String(v)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Input mapping from previous steps */}
                  {index > 0 && (
                    <div className="mt-2">
                      <p className="mb-1 text-xs text-zinc-500">
                        Input Mapping (from previous steps)
                      </p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="param"
                          className="w-24 text-xs"
                          id={`map-key-${index}`}
                        />
                        <Input
                          placeholder="step_1.id"
                          className="flex-1 text-xs"
                          id={`map-val-${index}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const keyEl = document.getElementById(
                              `map-key-${index}`
                            ) as HTMLInputElement;
                            const valEl = document.getElementById(
                              `map-val-${index}`
                            ) as HTMLInputElement;
                            if (keyEl?.value && valEl?.value) {
                              addInputMapping(index, keyEl.value, valEl.value);
                              keyEl.value = '';
                              valEl.value = '';
                            }
                          }}
                        >
                          Map
                        </Button>
                      </div>
                      {Object.keys(step.inputMapping).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(step.inputMapping).map(([k, v]) => (
                            <Badge key={k} variant="outline" className="text-xs">
                              {k} ← {v}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Failure behavior */}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-zinc-500">On failure:</span>
                    <select
                      value={step.onFailure}
                      onChange={(e) => updateStep(index, { onFailure: e.target.value as any })}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-white"
                    >
                      {FAILURE_BEHAVIORS.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </Card>
              </div>
            ))}

            <Button variant="outline" className="w-full gap-2" onClick={addStep}>
              <Plus className="h-4 w-4" />
              Add Step
            </Button>
          </div>

          {/* Summary */}
          <div className="flex items-center justify-between rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
            <span className="text-sm text-zinc-400">
              {steps.length} step{steps.length !== 1 ? 's' : ''}
            </span>
            <span className="text-sm text-zinc-400">Est. ~{estimatedCredits} credits per run</span>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={create.isPending}>
              {create.isPending ? 'Creating...' : 'Create Pipeline'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
