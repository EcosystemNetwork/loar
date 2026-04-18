/**
 * Create Ad Seed — Advertiser wizard for planting a new seed.
 *
 * Steps:
 *   1. type       — Pick seed type (logo, product, character, audio, billboard, narrative)
 *   2. brand      — Brand name, title, description, creative assets
 *   3. guidelines — Placement guidelines + target genres
 *   4. bounty     — Reward per placement, max placements, deadline
 *   5. confirm    — Review + publish
 */
import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  CheckCircle,
  Info,
  Image,
  Package,
  User,
  Volume2,
  Tv2,
  BookOpen,
  Sparkles,
  Coins,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useCreateAdSeed } from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';

export const Route = createFileRoute('/ads/seeds/new')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/ads/seeds/new' } });
    }
  },
  component: CreateAdSeedPage,
});

const SEED_TYPES = [
  {
    value: 'LOGO' as const,
    label: 'Logo Placement',
    icon: <Image className="w-6 h-6" />,
    description: 'Your brand logo appears visually in scenes — on walls, screens, products',
    example: "Logo on a billboard in the city, or on a character's shirt",
  },
  {
    value: 'PRODUCT' as const,
    label: 'Product Placement',
    icon: <Package className="w-6 h-6" />,
    description: 'A real product woven into the story world — characters use or interact with it',
    example: 'Hero grabs your energy drink mid-chase scene',
  },
  {
    value: 'CHARACTER' as const,
    label: 'Sponsored Character',
    icon: <User className="w-6 h-6" />,
    description: 'A recurring character that embodies your brand identity',
    example: 'A tech-savvy sidekick who always uses your gadgets',
  },
  {
    value: 'AUDIO' as const,
    label: 'Audio Mention',
    icon: <Volume2 className="w-6 h-6" />,
    description: 'Brand name or tagline spoken in dialogue or narration',
    example: '"Powered by ACME" or a natural in-dialogue reference',
  },
  {
    value: 'BILLBOARD' as const,
    label: 'Visual Billboard',
    icon: <Tv2 className="w-6 h-6" />,
    description: 'Banner or overlay displayed during episode playback',
    example: 'A sponsored banner in the opening or closing credits',
  },
  {
    value: 'NARRATIVE' as const,
    label: 'Narrative Integration',
    icon: <BookOpen className="w-6 h-6" />,
    description: 'Your brand becomes part of the story — a plot device, location, or lore element',
    example: 'Your company is a major corporation in the story universe',
  },
] as const;

type SeedType = (typeof SEED_TYPES)[number]['value'];
type Step = 'type' | 'brand' | 'guidelines' | 'bounty' | 'confirm';
const STEPS: Step[] = ['type', 'brand', 'guidelines', 'bounty', 'confirm'];

const GENRE_OPTIONS = [
  'Sci-Fi',
  'Fantasy',
  'Horror',
  'Comedy',
  'Drama',
  'Action',
  'Romance',
  'Thriller',
  'Mystery',
  'Anime',
  'Documentary',
  'Cyberpunk',
];

interface SeedForm {
  seedType: SeedType | '';
  brandName: string;
  title: string;
  description: string;
  creativeUrl: string;
  guidelines: string;
  targetGenres: string[];
  rewardPerPlacement: string;
  maxPlacements: string;
  deadlineDays: string;
}

export function CreateAdSeedPage() {
  const navigate = useNavigate();
  const { isConnected, isAuthenticated, isAuthenticating } = useWalletAuth();
  const createSeed = useCreateAdSeed();
  const [step, setStep] = useState<Step>('type');

  useEffect(() => {
    if (!isAuthenticated && !isAuthenticating) {
      navigate({ to: '/login', search: { redirect: '/ads/seeds/new' } });
    }
  }, [isAuthenticated, isAuthenticating, navigate]);

  const [form, setForm] = useState<SeedForm>({
    seedType: '',
    brandName: '',
    title: '',
    description: '',
    creativeUrl: '',
    guidelines: '',
    targetGenres: [],
    rewardPerPlacement: '100',
    maxPlacements: '10',
    deadlineDays: '30',
  });

  if (isAuthenticating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const stepIdx = STEPS.indexOf(step);
  const selectedType = SEED_TYPES.find((t) => t.value === form.seedType);

  function set<K extends keyof SeedForm>(key: K, value: SeedForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleGenre(genre: string) {
    setForm((f) => ({
      ...f,
      targetGenres: f.targetGenres.includes(genre)
        ? f.targetGenres.filter((g) => g !== genre)
        : [...f.targetGenres, genre],
    }));
  }

  function canAdvance() {
    if (step === 'type') return !!form.seedType;
    if (step === 'brand')
      return !!form.brandName.trim() && !!form.title.trim() && !!form.description.trim();
    if (step === 'guidelines') return true; // optional
    if (step === 'bounty') {
      const reward = parseInt(form.rewardPerPlacement);
      const max = parseInt(form.maxPlacements);
      const days = parseInt(form.deadlineDays);
      return reward >= 10 && max >= 1 && days >= 1;
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
    else navigate({ to: '/ads/seeds' });
  }

  async function handleCreate() {
    if (!isConnected) {
      toast.error('Connect your wallet first');
      return;
    }
    try {
      await createSeed.mutateAsync({
        brandName: form.brandName.trim(),
        seedType: form.seedType as SeedType,
        title: form.title.trim(),
        description: form.description.trim(),
        creativeUrl: form.creativeUrl.trim() || undefined,
        guidelines: form.guidelines.trim() || undefined,
        rewardPerPlacement: parseInt(form.rewardPerPlacement),
        maxPlacements: parseInt(form.maxPlacements),
        deadlineDays: parseInt(form.deadlineDays),
        targetGenres: form.targetGenres.length > 0 ? form.targetGenres : undefined,
      });
      toast.success('Seed planted! Filmmakers can now claim it.');
      navigate({ to: '/ads/seeds' });
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to create seed');
    }
  }

  const totalBudget =
    parseInt(form.rewardPerPlacement || '0') * parseInt(form.maxPlacements || '0');

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={back}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <p className="font-semibold text-sm flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-primary" />
            Plant a Seed
          </p>
          <p className="text-xs text-muted-foreground capitalize">{step}</p>
        </div>
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 w-5 rounded-full transition-colors ${
                i <= stepIdx ? 'bg-primary' : 'bg-muted'
              }`}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 max-w-lg mx-auto w-full px-4 py-6">
        {/* Step 1: Seed Type */}
        {step === 'type' && (
          <div className="space-y-3">
            <h2 className="text-lg font-bold mb-4">What kind of ad seed?</h2>
            {SEED_TYPES.map((st) => (
              <button
                key={st.value}
                className={`w-full flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                  form.seedType === st.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/30'
                }`}
                onClick={() => set('seedType', st.value)}
              >
                <div
                  className={`shrink-0 mt-0.5 ${
                    form.seedType === st.value ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {st.icon}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{st.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{st.description}</p>
                  <p className="text-xs text-muted-foreground/70 italic mt-1">{st.example}</p>
                </div>
                {form.seedType === st.value && (
                  <CheckCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* Step 2: Brand Info */}
        {step === 'brand' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">Your brand & creative</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Tell filmmakers what to feature and provide assets.
            </p>

            <div className="space-y-2">
              <Label htmlFor="brandName">Brand Name *</Label>
              <Input
                id="brandName"
                placeholder="ACME Corp"
                value={form.brandName}
                onChange={(e) => set('brandName', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="title">Seed Title *</Label>
              <Input
                id="title"
                placeholder="e.g. ACME Energy Drink in Sci-Fi Films"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A clear, catchy title filmmakers will see when browsing.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                placeholder="Describe your brand, what you want featured, and the vibe you're going for..."
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                rows={5}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="creativeUrl">Creative Assets URL (optional)</Label>
              <Input
                id="creativeUrl"
                placeholder="Link to logo, brand kit, product images, etc."
                value={form.creativeUrl}
                onChange={(e) => set('creativeUrl', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                IPFS, Google Drive, Dropbox — anywhere filmmakers can download your assets.
              </p>
            </div>
          </div>
        )}

        {/* Step 3: Guidelines */}
        {step === 'guidelines' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">Placement guidelines</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Help filmmakers know what's acceptable. These are optional but improve quality.
            </p>

            <div className="space-y-2">
              <Label htmlFor="guidelines">Guidelines</Label>
              <Textarea
                id="guidelines"
                placeholder="e.g. Logo must be clearly visible for at least 3 seconds. No association with violence. Family-friendly contexts preferred..."
                value={form.guidelines}
                onChange={(e) => set('guidelines', e.target.value)}
                rows={5}
              />
            </div>

            <div className="space-y-2">
              <Label>Target Genres (optional)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Select genres that fit your brand. Leave empty for any genre.
              </p>
              <div className="flex flex-wrap gap-2">
                {GENRE_OPTIONS.map((genre) => (
                  <button
                    key={genre}
                    onClick={() => toggleGenre(genre)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      form.targetGenres.includes(genre)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-background border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {genre}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Bounty */}
        {step === 'bounty' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-bold mb-1">Set your bounty</h2>
              <p className="text-sm text-muted-foreground">
                How much $LOAR per placement and how many placements you want.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reward">Reward per placement ($LOAR) *</Label>
              <div className="relative">
                <Input
                  id="reward"
                  type="number"
                  min="10"
                  step="10"
                  placeholder="100"
                  value={form.rewardPerPlacement}
                  onChange={(e) => set('rewardPerPlacement', e.target.value)}
                  className="pr-16"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">
                  $LOAR
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxPlacements">Max placements *</Label>
              <Input
                id="maxPlacements"
                type="number"
                min="1"
                step="1"
                placeholder="10"
                value={form.maxPlacements}
                onChange={(e) => set('maxPlacements', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Total number of films that can earn the bounty.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deadline">Deadline (days) *</Label>
              <Input
                id="deadline"
                type="number"
                min="1"
                max="365"
                placeholder="30"
                value={form.deadlineDays}
                onChange={(e) => set('deadlineDays', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                How long filmmakers have to claim and submit placements.
              </p>
            </div>

            <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 flex gap-2.5">
              <Coins className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
              <div className="text-xs text-green-300">
                <p className="font-medium">Total Budget: {totalBudget.toLocaleString()} $LOAR</p>
                <p className="mt-0.5 text-green-300/70">
                  {form.rewardPerPlacement} per placement x {form.maxPlacements} placements
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 flex gap-2.5">
              <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
              <p className="text-xs text-blue-300">
                $LOAR is released to filmmakers only after you approve their placement. You review
                each submission individually.
              </p>
            </div>
          </div>
        )}

        {/* Step 5: Confirm */}
        {step === 'confirm' && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold mb-1">Review your seed</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Once published, filmmakers can immediately start placing your ad.
            </p>

            <div className="rounded-xl border p-4 space-y-3 text-sm">
              <ConfirmRow label="Seed Type" value={selectedType?.label ?? form.seedType} />
              <ConfirmRow label="Brand" value={form.brandName} />
              <ConfirmRow label="Title" value={form.title} />
              <ConfirmRow label="Reward" value={`${form.rewardPerPlacement} $LOAR`} />
              <ConfirmRow label="Max Placements" value={form.maxPlacements} />
              <ConfirmRow label="Total Budget" value={`${totalBudget.toLocaleString()} $LOAR`} />
              <ConfirmRow label="Deadline" value={`${form.deadlineDays} days`} />
              {form.targetGenres.length > 0 && (
                <ConfirmRow label="Genres" value={form.targetGenres.join(', ')} />
              )}
              <div>
                <p className="text-muted-foreground mb-1">Description</p>
                <p className="text-xs leading-relaxed">{form.description}</p>
              </div>
              {form.guidelines && (
                <div>
                  <p className="text-muted-foreground mb-1">Guidelines</p>
                  <p className="text-xs leading-relaxed">{form.guidelines}</p>
                </div>
              )}
              {form.creativeUrl && <ConfirmRow label="Creative URL" value={form.creativeUrl} />}
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <Button
                size="lg"
                className="w-full"
                onClick={handleCreate}
                disabled={createSeed.isPending || !isConnected}
              >
                {createSeed.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Sparkles className="w-4 h-4 mr-2" />
                )}
                Plant Seed
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
      <span className="font-medium text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}
