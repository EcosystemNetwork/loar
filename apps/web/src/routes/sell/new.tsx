/**
 * Create Listing — mobile multi-step listing flow
 */
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Film,
  Users,
  Package,
  Crown,
  Gavel,
  ShoppingBag,
  Megaphone,
  FileText,
  Loader2,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { useCreateListing } from '@/hooks/useListings';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { useVocab } from '@/hooks/use-vocab';

export const Route = createFileRoute('/sell/new')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/sell/new' } });
    }
  },
  component: CreateListingPage,
});

const PRODUCT_TYPES = [
  {
    value: 'EPISODE_NFT',
    label: 'Own Episode',
    description: 'A scene or episode collectible',
    icon: <Film className="w-6 h-6" />,
  },
  {
    value: 'CHARACTER_NFT',
    label: 'Own Character',
    description: 'A character collectible',
    icon: <Users className="w-6 h-6" />,
  },
  {
    value: 'ARTIFACT',
    label: 'Artifact',
    description: 'Any collectible item',
    icon: <Package className="w-6 h-6" />,
  },
  {
    value: 'SUBSCRIPTION_TIER',
    label: 'Subscription',
    description: 'Access tier for your universe',
    icon: <Crown className="w-6 h-6" />,
  },
  {
    value: 'CANON_LICENSE',
    label: 'Canon License',
    description: 'Contribution rights',
    icon: <Gavel className="w-6 h-6" />,
  },
  {
    value: 'MERCH',
    label: 'Merchandise',
    description: 'Physical or digital merch',
    icon: <ShoppingBag className="w-6 h-6" />,
  },
  {
    value: 'SPONSORED_SLOT',
    label: 'Sponsored Slot',
    description: 'Ad placement inventory',
    icon: <Megaphone className="w-6 h-6" />,
  },
  {
    value: 'IP_LICENSE',
    label: 'IP License',
    description: 'Commercial rights to your IP',
    icon: <FileText className="w-6 h-6" />,
  },
] as const;

type Step = 'type' | 'details' | 'pricing' | 'publish';

interface FormData {
  productType: string;
  title: string;
  description: string;
  price: string;
  currency: 'ETH' | 'LOAR' | 'CREDITS' | 'USD';
  supply: string;
  rightsLane: 'fan' | 'original' | 'licensed';
  royaltyBps: string;
  mediaUrl: string;
  thumbnailUrl: string;
  universeId: string;
}

const STEPS: Step[] = ['type', 'details', 'pricing', 'publish'];
const STEP_LABELS: Record<Step, string> = {
  type: 'Product Type',
  details: 'Details',
  pricing: 'Pricing',
  publish: 'Publish',
};

function CreateListingPage() {
  const navigate = useNavigate();
  const { isConnected, isAuthenticated, isAuthenticating } = useWalletAuth();
  const isAutoConnecting = false; // Circle DCW session hydration is synchronous
  const v = useVocab();
  const create = useCreateListing();
  const [step, setStep] = useState<Step>('type');

  useEffect(() => {
    if (!isAuthenticated && !isAuthenticating) {
      navigate({ to: '/login', search: { redirect: '/sell/new' } });
    }
  }, [isAuthenticated, isAuthenticating, navigate]);

  const [form, setForm] = useState<FormData>({
    productType: '',
    title: '',
    description: '',
    price: '0',
    currency: 'ETH',
    supply: '0',
    rightsLane: 'original',
    royaltyBps: '500',
    mediaUrl: '',
    thumbnailUrl: '',
    universeId: '',
  });

  if (isAuthenticating || isAutoConnecting) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  function update(key: keyof FormData, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const stepIdx = STEPS.indexOf(step);

  function canAdvance() {
    if (step === 'type') return !!form.productType;
    if (step === 'details') return !!form.title.trim();
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
    else navigate({ to: '/sell' });
  }

  async function handlePublish(immediately: boolean) {
    if (!isConnected) {
      toast.error('Connect your wallet first');
      return;
    }
    try {
      const result = await create.mutateAsync({
        productType: form.productType as any,
        title: form.title,
        description: form.description,
        price: form.price,
        currency: form.currency as any,
        supply: parseInt(form.supply) || 0,
        rightsLane: form.rightsLane,
        royaltyBps: parseInt(form.royaltyBps) || 500,
        mediaUrl: form.mediaUrl || null,
        thumbnailUrl: form.thumbnailUrl || null,
        universeId: form.universeId || null,
        assetRef: null,
        publishImmediately: immediately,
      });
      toast.success(immediately ? 'Listing published!' : 'Saved as draft');
      navigate({ to: '/sell' });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to create listing');
    }
  }

  if (isAutoConnecting) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Connect your wallet</p>
          <p className="text-sm mt-1">to create a new listing</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <p className="font-semibold text-sm">New Listing</p>
          <p className="text-xs text-muted-foreground">{STEP_LABELS[step]}</p>
        </div>
        {/* Step indicator */}
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
        {/* Step: Product Type */}
        {step === 'type' && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold mb-4">What are you selling?</h2>
            {PRODUCT_TYPES.map((pt) => (
              <button
                key={pt.value}
                className={`w-full flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                  form.productType === pt.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30'
                }`}
                onClick={() => update('productType', pt.value)}
              >
                <div
                  className={`text-primary ${form.productType === pt.value ? 'opacity-100' : 'opacity-50'}`}
                >
                  {pt.icon}
                </div>
                <div>
                  <p className="font-medium text-sm">{pt.label}</p>
                  <p className="text-xs text-muted-foreground">{pt.description}</p>
                </div>
                {form.productType === pt.value && (
                  <CheckCircle className="w-4 h-4 text-primary ml-auto shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step: Details */}
        {step === 'details' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-4">Tell us about it</h2>
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                placeholder="Give your listing a name"
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Description</Label>
              <Textarea
                id="desc"
                placeholder="Describe what buyers are getting…"
                value={form.description}
                onChange={(e) => update('description', e.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="thumb">Thumbnail URL</Label>
              <Input
                id="thumb"
                placeholder="https://…"
                value={form.thumbnailUrl}
                onChange={(e) => update('thumbnailUrl', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="media">Media URL (image or video)</Label>
              <Input
                id="media"
                placeholder="https://…"
                value={form.mediaUrl}
                onChange={(e) => update('mediaUrl', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="universe">Universe ID (optional)</Label>
              <Input
                id="universe"
                placeholder="Attach to a universe"
                value={form.universeId}
                onChange={(e) => update('universeId', e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Step: Pricing */}
        {step === 'pricing' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-4">Set your price</h2>
            <div className="flex gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="price">Price</Label>
                <Input
                  id="price"
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="0"
                  value={form.price}
                  onChange={(e) => update('price', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={(v) => update('currency', v)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ETH">ETH</SelectItem>
                    <SelectItem value="LOAR">LOAR</SelectItem>
                    <SelectItem value="CREDITS">Credits</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="supply">Supply (0 = unlimited)</Label>
              <Input
                id="supply"
                type="number"
                min="0"
                placeholder="0"
                value={form.supply}
                onChange={(e) => update('supply', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="royalty">{v('royalty')} (basis points, 500 = 5%)</Label>
              <Input
                id="royalty"
                type="number"
                min="0"
                max="10000"
                placeholder="500"
                value={form.royaltyBps}
                onChange={(e) => update('royaltyBps', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Rights Lane</Label>
              <Select value={form.rightsLane} onValueChange={(v) => update('rightsLane', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="original">Original — Creator-Owned</SelectItem>
                  <SelectItem value="licensed">Licensed — Rights-Cleared</SelectItem>
                  <SelectItem value="fan">Fan — Non-Commercial</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Step: Publish */}
        {step === 'publish' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-2">Ready to go?</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Review your listing before publishing. You can always edit or delist later.
            </p>

            {/* Summary */}
            <div className="rounded-xl border p-4 space-y-2 text-sm">
              <SummaryRow label="Type" value={form.productType.replace(/_/g, ' ')} />
              <SummaryRow label="Title" value={form.title} />
              <SummaryRow label="Price" value={`${form.price || '0'} ${form.currency}`} />
              <SummaryRow label="Supply" value={form.supply === '0' ? 'Unlimited' : form.supply} />
              <SummaryRow label="Rights" value={form.rightsLane} />
              <SummaryRow
                label={v('royalty')}
                value={`${(parseInt(form.royaltyBps) / 100).toFixed(1)}%`}
              />
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                size="lg"
                onClick={() => handlePublish(true)}
                disabled={create.isPending}
                className="w-full"
              >
                {create.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <CheckCircle className="w-4 h-4 mr-2" />
                )}
                Publish Now
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => handlePublish(false)}
                disabled={create.isPending}
                className="w-full"
              >
                Save as Draft
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Next button (except publish step) */}
      {step !== 'publish' && (
        <div className="sticky bottom-0 bg-background border-t px-4 py-4 safe-area-bottom">
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

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </div>
  );
}
