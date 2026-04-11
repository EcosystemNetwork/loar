/**
 * Create License — Creator flow for issuing a new IP license on their universe.
 *
 * Steps:
 *   1. type      — Pick license type (streaming, gaming, merch, etc.)
 *   2. details   — Licensee info + terms
 *   3. pricing   — Upfront fee + royalty %
 *   4. confirm   — Review + publish
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Tv2,
  ShoppingBag,
  Gamepad2,
  BookOpen,
  Headphones,
  MoreHorizontal,
  Loader2,
  CheckCircle,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateLicense } from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { parseEther } from 'viem';

export const Route = createFileRoute('/licensing/new')({
  component: CreateLicensePage,
});

const LICENSE_TYPES = [
  {
    value: 'STREAMING' as const,
    label: 'Streaming',
    icon: <Tv2 className="w-6 h-6" />,
    description: 'License your universe for streaming on external platforms',
    example: 'Netflix, YouTube, Twitch — adapted or direct stream',
  },
  {
    value: 'MERCH' as const,
    label: 'Merchandise',
    icon: <ShoppingBag className="w-6 h-6" />,
    description: 'Physical or digital merchandise featuring your IP',
    example: 'T-shirts, posters, figurines, digital collectibles',
  },
  {
    value: 'GAMING' as const,
    label: 'Gaming',
    icon: <Gamepad2 className="w-6 h-6" />,
    description: 'Adapt your universe IP for video games',
    example: 'Mobile games, PC/console, in-game items and characters',
  },
  {
    value: 'COMIC' as const,
    label: 'Comic / Print',
    icon: <BookOpen className="w-6 h-6" />,
    description: 'Print or digital comic adaptations of your universe',
    example: 'Graphic novels, manga adaptations, illustrated guides',
  },
  {
    value: 'AUDIO' as const,
    label: 'Audio',
    icon: <Headphones className="w-6 h-6" />,
    description: 'Podcast, audiobook, or music rights to your universe',
    example: 'Audio dramas, soundtrack albums, podcast series',
  },
  {
    value: 'OTHER' as const,
    label: 'Other',
    icon: <MoreHorizontal className="w-6 h-6" />,
    description: 'Custom licensing arrangement not covered above',
    example: 'Theme parks, live events, educational use, etc.',
  },
] as const;

type LicenseType = (typeof LICENSE_TYPES)[number]['value'];
type Step = 'type' | 'details' | 'pricing' | 'confirm';
const STEPS: Step[] = ['type', 'details', 'pricing', 'confirm'];

interface LicenseForm {
  licenseType: LicenseType | '';
  universeId: string;
  licensee: string;
  licenseeContact: string;
  terms: string;
  upfrontFeeEth: string;
  royaltyBps: string;
  durationDays: string;
}

export function CreateLicensePage() {
  const navigate = useNavigate();
  const { isConnected } = useWalletAuth();
  const createLicense = useCreateLicense();
  const [step, setStep] = useState<Step>('type');
  const [form, setForm] = useState<LicenseForm>({
    licenseType: '',
    universeId: '',
    licensee: '',
    licenseeContact: '',
    terms: '',
    upfrontFeeEth: '0.1',
    royaltyBps: '500',
    durationDays: '365',
  });

  const stepIdx = STEPS.indexOf(step);

  function set<K extends keyof LicenseForm>(key: K, value: LicenseForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function canAdvance() {
    if (step === 'type') return !!form.licenseType;
    if (step === 'details')
      return !!form.universeId.trim() && !!form.licensee.trim() && !!form.terms.trim();
    if (step === 'pricing') {
      const fee = parseFloat(form.upfrontFeeEth);
      const royalty = parseInt(form.royaltyBps);
      const days = parseInt(form.durationDays);
      return fee >= 0 && royalty >= 0 && royalty <= 10000 && days >= 1;
    }
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
    else navigate({ to: '/licensing' });
  }

  async function handleCreate() {
    if (!isConnected) {
      toast.error('Connect your wallet first');
      return;
    }
    try {
      const upfrontFee = parseEther(form.upfrontFeeEth as `${number}`).toString();
      await createLicense.mutateAsync({
        universeId: form.universeId,
        licenseType: form.licenseType as LicenseType,
        licensee: form.licensee,
        licenseeContact: form.licenseeContact || undefined,
        upfrontFee,
        royaltyBps: parseInt(form.royaltyBps),
        durationDays: parseInt(form.durationDays),
        terms: form.terms,
      });
      toast.success('License created! Awaiting activation.');
      navigate({ to: '/licensing' });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to create license');
    }
  }

  const selectedType = LICENSE_TYPES.find((t) => t.value === form.licenseType);
  const royaltyPct = (parseInt(form.royaltyBps) / 100).toFixed(1);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <p className="font-semibold text-sm">New License</p>
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
        {/* Step 1: License type */}
        {step === 'type' && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold mb-4">What kind of license?</h2>
            {LICENSE_TYPES.map((lt) => (
              <button
                key={lt.value}
                className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                  form.licenseType === lt.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30'
                }`}
                onClick={() => set('licenseType', lt.value)}
              >
                <div
                  className={`shrink-0 mt-0.5 ${
                    form.licenseType === lt.value ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {lt.icon}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{lt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{lt.description}</p>
                  <p className="text-xs text-muted-foreground/70 italic mt-1">{lt.example}</p>
                </div>
                {form.licenseType === lt.value && (
                  <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Details */}
        {step === 'details' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">License details</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Describe who the licensee is and the terms of this agreement.
            </p>

            <div className="space-y-2">
              <Label htmlFor="universeId">Universe ID *</Label>
              <Input
                id="universeId"
                placeholder="Your universe identifier"
                value={form.universeId}
                onChange={(e) => set('universeId', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="licensee">Licensee *</Label>
              <Input
                id="licensee"
                placeholder="Company or individual name"
                value={form.licensee}
                onChange={(e) => set('licensee', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="licenseeContact">Licensee contact (optional)</Label>
              <Input
                id="licenseeContact"
                placeholder="Email or wallet address"
                value={form.licenseeContact}
                onChange={(e) => set('licenseeContact', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="terms">License terms *</Label>
              <Textarea
                id="terms"
                placeholder={`Describe the scope and limitations of this ${selectedType?.label ?? ''} license — territory, exclusivity, permitted uses…`}
                value={form.terms}
                onChange={(e) => set('terms', e.target.value)}
                rows={5}
              />
            </div>
          </div>
        )}

        {/* Step 3: Pricing */}
        {step === 'pricing' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold mb-1">Set the commercial terms</h2>
              <p className="text-sm text-muted-foreground">
                Define the upfront fee, ongoing royalty, and license duration.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="upfrontFee">Upfront fee (ETH) *</Label>
              <div className="relative">
                <Input
                  id="upfrontFee"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.1"
                  value={form.upfrontFeeEth}
                  onChange={(e) => set('upfrontFeeEth', e.target.value)}
                  className="pr-14"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                  ETH
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="royalty">Royalty rate (basis points) *</Label>
              <div className="relative">
                <Input
                  id="royalty"
                  type="number"
                  min="0"
                  max="10000"
                  step="50"
                  placeholder="500"
                  value={form.royaltyBps}
                  onChange={(e) => set('royaltyBps', e.target.value)}
                  className="pr-14"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                  bps
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {royaltyPct}% of licensee revenue. 100 bps = 1%.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="duration">Duration (days) *</Label>
              <Input
                id="duration"
                type="number"
                min="1"
                max="3650"
                step="1"
                placeholder="365"
                value={form.durationDays}
                onChange={(e) => set('durationDays', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                License expires after this many days from activation.
              </p>
            </div>

            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex gap-2.5">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300">
                The upfront fee is paid when the license is activated on-chain. Royalties are
                tracked and settled periodically through the smart contract.
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {step === 'confirm' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">Review your license</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Once created, this license will be in "Proposed" status until activated on-chain.
            </p>

            <div className="rounded-xl border p-4 space-y-3 text-sm">
              <ConfirmRow label="Type" value={selectedType?.label ?? form.licenseType} />
              <ConfirmRow label="Universe" value={form.universeId} />
              <ConfirmRow label="Licensee" value={form.licensee} />
              <ConfirmRow label="Upfront Fee" value={`${form.upfrontFeeEth} ETH`} />
              <ConfirmRow label="Royalty" value={`${royaltyPct}% (${form.royaltyBps} bps)`} />
              <ConfirmRow label="Duration" value={`${form.durationDays} days`} />
              {form.licenseeContact && <ConfirmRow label="Contact" value={form.licenseeContact} />}
              <div>
                <p className="text-muted-foreground mb-1">Terms</p>
                <p className="text-xs leading-relaxed">{form.terms}</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                size="lg"
                className="w-full"
                onClick={handleCreate}
                disabled={createLicense.isPending || !isConnected}
              >
                {createLicense.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Create License
              </Button>
              {!isConnected && (
                <p className="text-xs text-center text-muted-foreground">
                  Connect your wallet to create
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
