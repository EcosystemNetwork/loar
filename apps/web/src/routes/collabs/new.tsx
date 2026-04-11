/**
 * Propose Collaboration — Creator flow for proposing a cross-universe collab.
 *
 * Steps:
 *   1. universes — Pick both universes
 *   2. terms     — Revenue share + duration
 *   3. details   — Title + description
 *   4. confirm   — Review + send proposal
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle,
  Info,
  Handshake,
  Percent,
  Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useProposeCollab } from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';

export const Route = createFileRoute('/collabs/new')({
  component: ProposeCollabPage,
});

type Step = 'universes' | 'terms' | 'details' | 'confirm';
const STEPS: Step[] = ['universes', 'terms', 'details', 'confirm'];

interface CollabForm {
  universeA: string;
  universeB: string;
  revenueShareBps: string;
  durationDays: string;
  title: string;
  description: string;
  metadataURI: string;
}

export function ProposeCollabPage() {
  const navigate = useNavigate();
  const { isConnected } = useWalletAuth();
  const proposeCollab = useProposeCollab();
  const [step, setStep] = useState<Step>('universes');
  const [form, setForm] = useState<CollabForm>({
    universeA: '',
    universeB: '',
    revenueShareBps: '5000',
    durationDays: '90',
    title: '',
    description: '',
    metadataURI: '',
  });

  const stepIdx = STEPS.indexOf(step);

  function set<K extends keyof CollabForm>(key: K, value: CollabForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function canAdvance() {
    if (step === 'universes')
      return (
        !!form.universeA.trim() && !!form.universeB.trim() && form.universeA !== form.universeB
      );
    if (step === 'terms') {
      const share = parseInt(form.revenueShareBps);
      const days = parseInt(form.durationDays);
      return share >= 0 && share <= 10000 && days >= 1;
    }
    if (step === 'details') return !!form.title.trim() && !!form.description.trim();
    return true;
  }

  function advance() {
    if (!canAdvance()) return;
    const next = STEPS[stepIdx + 1];
    if (next) setStep(next);
  }

  function back() {
    const prev = STEPS[stepIdx - 1];
    if (prev) setStep(prev);
    else navigate({ to: '/collabs' });
  }

  async function handlePropose() {
    if (!isConnected) {
      toast.error('Connect your wallet first');
      return;
    }
    try {
      await proposeCollab.mutateAsync({
        universeA: form.universeA,
        universeB: form.universeB,
        revenueShareBps: parseInt(form.revenueShareBps),
        durationDays: parseInt(form.durationDays),
        title: form.title,
        description: form.description,
        metadataURI: form.metadataURI || undefined,
      });
      toast.success('Collaboration proposed! Waiting for the other creator to accept.');
      navigate({ to: '/collabs' });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to propose collaboration');
    }
  }

  const sharePct = (parseInt(form.revenueShareBps) / 100).toFixed(1);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <p className="font-semibold text-sm">Propose Collaboration</p>
          <p className="text-xs text-muted-foreground capitalize">{step}</p>
        </div>
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 w-6 rounded-full transition-colors ${
                i <= stepIdx ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6">
        {/* Step 1: Universes */}
        {step === 'universes' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">Pick two universes</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Choose your universe and the one you want to collaborate with.
            </p>

            <div className="space-y-2">
              <Label htmlFor="universeA">Your Universe ID *</Label>
              <Input
                id="universeA"
                placeholder="Your universe identifier"
                value={form.universeA}
                onChange={(e) => set('universeA', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">The universe you own or manage.</p>
            </div>

            <div className="flex items-center justify-center py-2">
              <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Handshake className="w-5 h-5" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="universeB">Partner Universe ID *</Label>
              <Input
                id="universeB"
                placeholder="The other universe identifier"
                value={form.universeB}
                onChange={(e) => set('universeB', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The universe you'd like to partner with.
              </p>
            </div>

            {form.universeA && form.universeB && form.universeA === form.universeB && (
              <p className="text-xs text-red-400">Universes must be different.</p>
            )}
          </div>
        )}

        {/* Step 2: Terms */}
        {step === 'terms' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold mb-1">Set collaboration terms</h2>
              <p className="text-sm text-muted-foreground">
                Define how revenue is shared and how long the collab runs.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="revenueShare">Revenue share (basis points) *</Label>
              <div className="relative">
                <Input
                  id="revenueShare"
                  type="number"
                  min="0"
                  max="10000"
                  step="100"
                  placeholder="5000"
                  value={form.revenueShareBps}
                  onChange={(e) => set('revenueShareBps', e.target.value)}
                  className="pr-14"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                  bps
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {sharePct}% of joint episode revenue goes to the partner. 5000 bps = 50/50 split.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration (days) *</Label>
              <Input
                id="duration"
                type="number"
                min="1"
                max="365"
                step="1"
                placeholder="90"
                value={form.durationDays}
                onChange={(e) => set('durationDays', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The collaboration expires after this many days from activation.
              </p>
            </div>

            {/* Visual split */}
            <div className="rounded-xl border p-4">
              <p className="text-xs font-medium mb-2">Revenue split preview</p>
              <div className="flex h-6 rounded-full overflow-hidden">
                <div
                  className="bg-primary flex items-center justify-center text-xs font-medium text-primary-foreground"
                  style={{ width: `${100 - parseInt(form.revenueShareBps) / 100}%` }}
                >
                  You {(100 - parseInt(form.revenueShareBps) / 100).toFixed(1)}%
                </div>
                <div
                  className="bg-blue-500 flex items-center justify-center text-xs font-medium text-white"
                  style={{ width: `${parseInt(form.revenueShareBps) / 100}%` }}
                >
                  Partner {sharePct}%
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex gap-2.5">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300">
                Revenue from joint episodes is split automatically by the smart contract based on
                the agreed percentage. The platform fee is deducted before the split.
              </p>
            </div>
          </div>
        )}

        {/* Step 3: Details */}
        {step === 'details' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">Describe the collaboration</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Give this collab a name and explain what you envision.
            </p>

            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                placeholder="e.g. Cyberpunk x Fantasy Crossover"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                placeholder="Describe the creative vision — what kind of episodes, crossover themes, shared characters…"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={5}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="metadataURI">Metadata URI (optional)</Label>
              <Input
                id="metadataURI"
                placeholder="IPFS or https link to additional terms/docs"
                value={form.metadataURI}
                onChange={(e) => set('metadataURI', e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {step === 'confirm' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">Review your proposal</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Once sent, the partner universe creator will need to accept before the collab
              activates.
            </p>

            <div className="rounded-xl border p-4 space-y-3 text-sm">
              <ConfirmRow label="Title" value={form.title} />
              <ConfirmRow label="Your Universe" value={form.universeA} />
              <ConfirmRow label="Partner Universe" value={form.universeB} />
              <ConfirmRow
                label="Revenue Share"
                value={`${sharePct}% (${form.revenueShareBps} bps)`}
              />
              <ConfirmRow label="Duration" value={`${form.durationDays} days`} />
              <div>
                <p className="text-muted-foreground mb-1">Description</p>
                <p className="text-xs leading-relaxed">{form.description}</p>
              </div>
              {form.metadataURI && <ConfirmRow label="Metadata" value={form.metadataURI} />}
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                size="lg"
                className="w-full"
                onClick={handlePropose}
                disabled={proposeCollab.isPending || !isConnected}
              >
                {proposeCollab.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Handshake className="w-4 h-4 mr-2" />
                )}
                Send Proposal
              </Button>
              {!isConnected && (
                <p className="text-xs text-center text-muted-foreground">
                  Connect your wallet to propose
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer nav (except confirm step) */}
      {step !== 'confirm' && (
        <div className="sticky bottom-0 bg-background border-t px-4 py-4">
          <div className="max-w-lg mx-auto">
            <Button size="lg" className="w-full" onClick={advance} disabled={!canAdvance()}>
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
