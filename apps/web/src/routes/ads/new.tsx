/**
 * Create Ad Slot — Creator flow for opening a new placement slot on their universe.
 *
 * Steps:
 *   1. placement  — Pick placement type
 *   2. details    — Description + constraints
 *   3. pricing    — Min bid (ETH) + episode count
 *   4. confirm    — Review + publish
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Tv2,
  Package,
  User,
  Volume2,
  Loader2,
  CheckCircle,
  Info,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateAdSlot } from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { parseEther } from 'viem';

export const Route = createFileRoute('/ads/new')({
  component: CreateAdSlotPage,
});

const PLACEMENT_TYPES = [
  {
    value: 'BILLBOARD' as const,
    label: 'Billboard',
    icon: <Tv2 className="w-6 h-6" />,
    description: 'Visual banner shown during episode playback — high visibility',
    example: 'A branded logo or banner visible during the story',
  },
  {
    value: 'PRODUCT' as const,
    label: 'Product Placement',
    icon: <Package className="w-6 h-6" />,
    description: 'A real brand product woven into the narrative world',
    example: 'Characters use or mention a product organically',
  },
  {
    value: 'SPONSORED_CHARACTER' as const,
    label: 'Sponsored Character',
    icon: <User className="w-6 h-6" />,
    description: 'A recurring character co-created with the sponsor\'s brand identity',
    example: 'A hero whose tech gear is branded by your company',
  },
  {
    value: 'AUDIO_MENTION' as const,
    label: 'Audio Mention',
    icon: <Volume2 className="w-6 h-6" />,
    description: 'Brand name or tagline spoken aloud in the AI-generated audio',
    example: '"Brought to you by ACME Corp" or natural in-dialogue mention',
  },
] as const;

type PlacementType = (typeof PLACEMENT_TYPES)[number]['value'];
type Step = 'placement' | 'details' | 'pricing' | 'confirm';
const STEPS: Step[] = ['placement', 'details', 'pricing', 'confirm'];

interface SlotForm {
  placementType: PlacementType | '';
  universeId: string;
  description: string;
  constraints: string;
  minBidEth: string;
  episodes: string;
}

export function CreateAdSlotPage() {
  const navigate = useNavigate();
  const { isConnected } = useWalletAuth();
  const createSlot = useCreateAdSlot();
  const [step, setStep] = useState<Step>('placement');
  const [form, setForm] = useState<SlotForm>({
    placementType: '',
    universeId: '',
    description: '',
    constraints: '',
    minBidEth: '0.01',
    episodes: '5',
  });

  const stepIdx = STEPS.indexOf(step);

  function set<K extends keyof SlotForm>(key: K, value: SlotForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function canAdvance() {
    if (step === 'placement') return !!form.placementType;
    if (step === 'details') return !!form.description.trim() && !!form.universeId.trim();
    if (step === 'pricing') {
      const bid = parseFloat(form.minBidEth);
      const eps = parseInt(form.episodes);
      return bid > 0 && eps >= 1;
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
    else navigate({ to: '/ads/' });
  }

  async function handleCreate() {
    if (!isConnected) {
      toast.error('Connect your wallet first');
      return;
    }
    try {
      const minBidWei = parseEther(form.minBidEth as `${number}`).toString();
      await createSlot.mutateAsync({
        universeId: form.universeId,
        placementType: form.placementType as PlacementType,
        minBid: minBidWei,
        episodes: parseInt(form.episodes),
        description: form.description,
        constraints: form.constraints || undefined,
      });
      toast.success('Ad slot created! Advertisers can now bid.');
      navigate({ to: '/ads/' });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to create slot');
    }
  }

  const selectedType = PLACEMENT_TYPES.find((p) => p.value === form.placementType);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <p className="font-semibold text-sm">New Ad Slot</p>
          <p className="text-xs text-muted-foreground capitalize">{step.replace('_', ' ')}</p>
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

        {/* Step 1: Placement type */}
        {step === 'placement' && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold mb-4">What kind of placement?</h2>
            {PLACEMENT_TYPES.map((pt) => (
              <button
                key={pt.value}
                className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                  form.placementType === pt.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30'
                }`}
                onClick={() => set('placementType', pt.value)}
              >
                <div
                  className={`shrink-0 mt-0.5 ${
                    form.placementType === pt.value ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {pt.icon}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{pt.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{pt.description}</p>
                  <p className="text-xs text-muted-foreground/70 italic mt-1">{pt.example}</p>
                </div>
                {form.placementType === pt.value && (
                  <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Details */}
        {step === 'details' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">Describe the placement</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Help advertisers understand exactly what they're buying.
            </p>

            <div className="space-y-2">
              <Label htmlFor="universeId">Universe ID *</Label>
              <Input
                id="universeId"
                placeholder="Your universe identifier"
                value={form.universeId}
                onChange={(e) => set('universeId', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The universe this slot belongs to. Find it in your dashboard.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                placeholder={`Describe the ${selectedType?.label ?? 'placement'} opportunity — where it appears, how prominent it is, the tone of the universe…`}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={5}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="constraints">Brand Constraints (optional)</Label>
              <Textarea
                id="constraints"
                placeholder="e.g. No alcohol brands, family-friendly only, no competing products…"
                value={form.constraints}
                onChange={(e) => set('constraints', e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        {/* Step 3: Pricing */}
        {step === 'pricing' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold mb-1">Set your floor price</h2>
              <p className="text-sm text-muted-foreground">
                Advertisers bid above this amount. The highest bidder at close wins.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="minBid">Minimum bid (ETH) *</Label>
              <div className="relative">
                <Input
                  id="minBid"
                  type="number"
                  min="0.001"
                  step="0.001"
                  placeholder="0.01"
                  value={form.minBidEth}
                  onChange={(e) => set('minBidEth', e.target.value)}
                  className="pr-14"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                  ETH
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="episodes">Number of episodes *</Label>
              <Input
                id="episodes"
                type="number"
                min="1"
                step="1"
                placeholder="5"
                value={form.episodes}
                onChange={(e) => set('episodes', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                How many episodes the sponsorship runs across. One impression is counted per episode.
              </p>
            </div>

            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex gap-2.5">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300">
                When you accept a bid, the platform takes a small fee and the remainder goes directly
                to your wallet. Impressions are recorded automatically each time an episode is
                generated.
              </p>
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {step === 'confirm' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">Review your slot</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Once published, advertisers can immediately start placing bids.
            </p>

            <div className="rounded-xl border p-4 space-y-3 text-sm">
              <ConfirmRow label="Type" value={selectedType?.label ?? form.placementType} />
              <ConfirmRow label="Universe" value={form.universeId} />
              <ConfirmRow label="Min Bid" value={`${form.minBidEth} ETH`} />
              <ConfirmRow label="Episodes" value={form.episodes} />
              <div>
                <p className="text-muted-foreground mb-1">Description</p>
                <p className="text-xs leading-relaxed">{form.description}</p>
              </div>
              {form.constraints && (
                <div>
                  <p className="text-muted-foreground mb-1">Constraints</p>
                  <p className="text-xs leading-relaxed">{form.constraints}</p>
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                size="lg"
                className="w-full"
                onClick={handleCreate}
                disabled={createSlot.isPending || !isConnected}
              >
                {createSlot.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Publish Slot
              </Button>
              {!isConnected && (
                <p className="text-xs text-center text-muted-foreground">
                  Connect your wallet to publish
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
            <Button
              size="lg"
              className="w-full"
              onClick={advance}
              disabled={!canAdvance()}
            >
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
