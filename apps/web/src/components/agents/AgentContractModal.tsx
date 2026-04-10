/**
 * Agent Contract Modal — Propose a talent agent contract
 */
import { useProposeContract } from '@/hooks/useTalentAgents';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useState } from 'react';
import { X, Handshake } from 'lucide-react';

const CONTRACT_SCOPES = ['licensing', 'collabs', 'marketplace', 'merch'] as const;

interface Props {
  agentUid: string;
  onClose: () => void;
}

export function AgentContractModal({ agentUid, onClose }: Props) {
  const propose = useProposeContract();
  const [form, setForm] = useState({
    commissionBps: 1000, // 10%
    exclusivity: 'NON_EXCLUSIVE' as 'EXCLUSIVE' | 'NON_EXCLUSIVE',
    scope: ['licensing'] as string[],
    durationDays: 90,
    terms: '',
  });

  const toggleScope = (s: string) => {
    setForm((prev) => ({
      ...prev,
      scope: prev.scope.includes(s) ? prev.scope.filter((x) => x !== s) : [...prev.scope, s],
    }));
  };

  const handleSubmit = async () => {
    if (form.scope.length === 0) {
      toast.error('Select at least one scope');
      return;
    }
    if (!form.terms) {
      toast.error('Terms are required');
      return;
    }

    try {
      await propose.mutateAsync({
        targetUid: agentUid,
        commissionBps: form.commissionBps,
        exclusivity: form.exclusivity,
        scope: form.scope as any[],
        durationDays: form.durationDays,
        terms: form.terms,
      });
      toast.success('Contract proposed!');
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to propose contract');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Handshake className="h-5 w-5 text-violet-400" />
            Propose Contract
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Commission Rate */}
          <div>
            <label className="mb-1 block text-sm text-zinc-400">
              Commission Rate: {(form.commissionBps / 100).toFixed(1)}%
            </label>
            <input
              type="range"
              min={100}
              max={3000}
              step={50}
              value={form.commissionBps}
              onChange={(e) => setForm((p) => ({ ...p, commissionBps: Number(e.target.value) }))}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-xs text-zinc-500">
              <span>1%</span>
              <span>30%</span>
            </div>
          </div>

          {/* Exclusivity */}
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Exclusivity</label>
            <div className="flex gap-2">
              {(['NON_EXCLUSIVE', 'EXCLUSIVE'] as const).map((opt) => (
                <Button
                  key={opt}
                  variant={form.exclusivity === opt ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setForm((p) => ({ ...p, exclusivity: opt }))}
                >
                  {opt.replace('_', '-')}
                </Button>
              ))}
            </div>
          </div>

          {/* Scope */}
          <div>
            <label className="mb-2 block text-sm text-zinc-400">Contract Scope</label>
            <div className="flex flex-wrap gap-2">
              {CONTRACT_SCOPES.map((s) => (
                <Badge
                  key={s}
                  variant={form.scope.includes(s) ? 'default' : 'outline'}
                  className="cursor-pointer capitalize"
                  onClick={() => toggleScope(s)}
                >
                  {s}
                </Badge>
              ))}
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Duration (days)</label>
            <Input
              type="number"
              min={30}
              max={730}
              value={form.durationDays}
              onChange={(e) => setForm((p) => ({ ...p, durationDays: Number(e.target.value) }))}
            />
          </div>

          {/* Terms */}
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Terms *</label>
            <textarea
              placeholder="Describe the contract terms..."
              value={form.terms}
              onChange={(e) => setForm((p) => ({ ...p, terms: e.target.value }))}
              className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-white placeholder:text-zinc-500"
              rows={4}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSubmit} disabled={propose.isPending}>
              {propose.isPending ? 'Proposing...' : 'Propose Contract'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
