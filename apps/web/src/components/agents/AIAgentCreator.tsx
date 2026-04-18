/**
 * AI Agent Creator — Form to create and configure autonomous AI agents
 */
import { useCreateAIAgent } from '@/hooks/useAIAgents';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useState } from 'react';
import { Bot, X } from 'lucide-react';

const AGENT_TYPES = [
  { value: 'content_creator', label: 'Content Creator', desc: 'Generates assets, images, videos' },
  {
    value: 'universe_manager',
    label: 'Universe Manager',
    desc: 'Manages entities, storylines, lore',
  },
  { value: 'moderator', label: 'Moderator', desc: 'Reviews and flags content' },
  {
    value: 'universe_representative',
    label: 'Universe Rep',
    desc: 'Negotiates collabs, manages treasury',
  },
] as const;

const PERMISSIONS = [
  { value: 'create_entities', label: 'Create Entities' },
  { value: 'generate_assets', label: 'Generate Assets' },
  { value: 'submit_canon', label: 'Submit to Canon' },
  { value: 'manage_storylines', label: 'Manage Storylines' },
  { value: 'negotiate_collabs', label: 'Negotiate Collabs' },
  { value: 'moderate', label: 'Moderate Content' },
] as const;

interface Props {
  universeId?: string;
  onClose: () => void;
  onCreated?: () => void;
}

export function AIAgentCreator({ universeId, onClose, onCreated }: Props) {
  const createAgent = useCreateAIAgent();
  const [form, setForm] = useState({
    name: '',
    type: 'content_creator' as string,
    description: '',
    permissions: ['create_entities', 'generate_assets'] as string[],
    creditBudgetPeriod: 'total' as 'monthly' | 'total',
  });

  const togglePermission = (p: string) => {
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(p)
        ? prev.permissions.filter((x) => x !== p)
        : [...prev.permissions, p],
    }));
  };

  const handleSubmit = async () => {
    if (!form.name) {
      toast.error('Agent name is required');
      return;
    }
    if (form.permissions.length === 0) {
      toast.error('Select at least one permission');
      return;
    }

    try {
      await createAgent.mutateAsync({
        name: form.name,
        type: form.type as any,
        description: form.description,
        universeId,
        permissions: form.permissions as any[],
        creditBudgetPeriod: form.creditBudgetPeriod,
      });
      toast.success('AI Agent created!');
      onCreated?.();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create agent');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Create AI Agent"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Bot className="h-5 w-5 text-cyan-400" />
            Create AI Agent
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Agent Name *</label>
            <Input
              placeholder="e.g. Universe Showrunner"
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
            />
          </div>

          {/* Type */}
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Agent Type</label>
            <div className="grid grid-cols-2 gap-2">
              {AGENT_TYPES.map((t) => (
                <button
                  key={t.value}
                  onClick={() => setForm((p) => ({ ...p, type: t.value }))}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    form.type === t.value
                      ? 'border-cyan-500 bg-cyan-500/10'
                      : 'border-zinc-700 hover:border-zinc-600'
                  }`}
                >
                  <p className="text-sm font-medium text-white">{t.label}</p>
                  <p className="text-xs text-zinc-400">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Description</label>
            <textarea
              placeholder="What will this agent do?"
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-white placeholder:text-zinc-500"
              rows={2}
            />
          </div>

          {/* Permissions */}
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Permissions</label>
            <div className="flex flex-wrap gap-2">
              {PERMISSIONS.map((p) => (
                <Badge
                  key={p.value}
                  variant={form.permissions.includes(p.value) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => togglePermission(p.value)}
                >
                  {p.label}
                </Badge>
              ))}
            </div>
          </div>

          {/* Budget Period */}
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Credit Budget Period</label>
            <div className="flex gap-2">
              {(['total', 'monthly'] as const).map((opt) => (
                <Button
                  key={opt}
                  variant={form.creditBudgetPeriod === opt ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setForm((p) => ({ ...p, creditBudgetPeriod: opt }))}
                  className="capitalize"
                >
                  {opt}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={createAgent.isPending}>
              {createAgent.isPending ? 'Creating...' : 'Create Agent'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
