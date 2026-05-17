/**
 * /create/likeness — Create a likeness entity + marketplace listing.
 *
 * Multi-step flow:
 *   1. Upload reference assets — face / body photos, optional video clips, optional 3D scan.
 *      These are the private "ground-truth" biometric references. They are stored on Pinata
 *      and exposed to license holders only.
 *   2. (Optional) Generate stylized character renders via image.generate using the uploaded
 *      photos as image-to-image conditioning. The selected render becomes the public
 *      marketplace thumbnail — raw selfies stay behind the license.
 *   3. Subject metadata (gender, age, ethnicity, real-person flag).
 *   4. Consent attestation (shared component).
 *   5. Pricing (shared component).
 *   6. Publish — creates the `likeness` entity, then submits consent, then opens a listing.
 */

import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  Sparkles,
  Trash2,
  Image as ImageIcon,
  Video,
  Box,
  UserCircle,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Wand2,
} from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { DirectUpload } from '@/components/DirectUpload';
import {
  ConsentStep,
  PricingStep,
  emptyConsentState,
  emptyPricingState,
  consentStateReady,
  pricingStateReady,
  safeParseEther,
  splitsToBpsPayload,
  type ConsentState,
  type PricingState,
} from '@/components/likeness-marketplace/consent-pricing-steps';
import { LIKENESS_ATTESTATION_TEXT_V1, type LikenessModality } from '@/hooks/useEntities';

export const Route = createFileRoute('/create/likeness')({
  component: CreateLikenessPage,
});

type Stage = 'upload' | 'render' | 'meta' | 'consent' | 'pricing' | 'submitting' | 'success';

interface UploadedAsset {
  url: string;
  contentHash: string;
  mimeType: string;
}

function CreateLikenessPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useWalletAuth();

  const [stage, setStage] = useState<Stage>('upload');

  // Uploaded refs
  const [faceImages, setFaceImages] = useState<UploadedAsset[]>([]);
  const [bodyImages, setBodyImages] = useState<UploadedAsset[]>([]);
  const [videoClips, setVideoClips] = useState<UploadedAsset[]>([]);
  const [threeDAsset, setThreeDAsset] = useState<UploadedAsset | null>(null);

  // Character renders
  const [renderPrompt, setRenderPrompt] = useState(
    'Stylized cinematic character portrait, neutral background, expressive lighting'
  );
  const [renderJobs, setRenderJobs] = useState<{ url: string; prompt: string }[]>([]);
  const [selectedThumbnail, setSelectedThumbnail] = useState<string | null>(null);

  // Subject metadata
  const [name, setName] = useState('');
  const [shortDescription, setShortDescription] = useState('');
  const [gender, setGender] = useState('');
  const [ethnicity, setEthnicity] = useState('');
  const [approximateAge, setApproximateAge] = useState('');

  // Consent + pricing
  const detectedModalities = useMemo<LikenessModality[]>(() => {
    const m: LikenessModality[] = [];
    if (faceImages.length > 0) m.push('face');
    if (bodyImages.length > 0) m.push('body');
    if (videoClips.length > 0) m.push('video');
    if (threeDAsset) m.push('3d');
    if (m.length >= 2) m.push('full');
    return m;
  }, [faceImages.length, bodyImages.length, videoClips.length, threeDAsset]);

  const [consent, setConsent] = useState<ConsentState>(() => emptyConsentState());
  const [pricing, setPricing] = useState<PricingState>(() => emptyPricingState());
  const [newListingId, setNewListingId] = useState<string | null>(null);

  // Sync detected modalities into consent state when they first appear, but
  // don't clobber explicit user choices later — only seed on the empty case.
  useEffect(() => {
    if (consent.modalities.size === 0 && detectedModalities.length > 0) {
      setConsent((c) => ({ ...c, modalities: new Set(detectedModalities) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedModalities.length]);

  // Sync pricing title once user types a name
  useEffect(() => {
    if (!pricing.title && name) {
      setPricing((p) => ({ ...p, title: name, description: shortDescription }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  const renderMutation = useMutation({
    mutationFn: async () => {
      const refs = [...faceImages.map((a) => a.url), ...bodyImages.map((a) => a.url)].slice(0, 4);
      if (refs.length === 0) {
        throw new Error('Upload at least one face or body image first.');
      }
      const result = await trpcClient.image.generate.mutate({
        prompt: renderPrompt,
        task: 'image_to_image',
        imageUrls: refs,
        numImages: 2,
        imageSize: 'portrait_4_3',
      } as never);
      const urls: string[] = ((result as { imageUrls?: string[] }).imageUrls ?? []).filter(
        (u): u is string => typeof u === 'string' && u.length > 0
      );
      return urls;
    },
    onSuccess: (urls) => {
      setRenderJobs((prev) => [...prev, ...urls.map((u) => ({ url: u, prompt: renderPrompt }))]);
      if (!selectedThumbnail && urls.length > 0) setSelectedThumbnail(urls[0]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const entityResult = await trpcClient.entities.create.mutate({
        name: name.trim(),
        description: shortDescription.trim(),
        kind: 'likeness',
        universeAddress: null,
        parentId: null,
        imageUrl: selectedThumbnail ?? null,
        monetized: false,
        rightsDeclaration: null,
        metadata: {
          modalities: Array.from(consent.modalities),
          faceImageUrls: faceImages.map((a) => a.url),
          bodyImageUrls: bodyImages.map((a) => a.url),
          videoUrls: videoClips.map((a) => a.url),
          threeDAssetUrl: threeDAsset?.url,
          gender: gender || undefined,
          ethnicity: ethnicity || undefined,
          approximateAge: approximateAge ? Number(approximateAge) : undefined,
          realPerson: consent.realPerson,
          characterRenders: renderJobs.map((r) => ({ url: r.url, prompt: r.prompt })),
        },
      });
      const entityId = (entityResult as { id: string }).id;

      await trpcClient.likenessMarketplace.submitConsent.mutate({
        entityId,
        modalities: Array.from(consent.modalities),
        allowedUseCases: Array.from(consent.allowedUseCases),
        prohibitions: Array.from(consent.prohibitions),
        permitSale: consent.permitSale,
        permitLease: consent.permitLease,
        permitLicense: consent.permitLicense,
        realPerson: consent.realPerson,
        attestationText: LIKENESS_ATTESTATION_TEXT_V1,
      });

      const buyWei = consent.permitSale ? safeParseEther(pricing.buyPriceEth) : 0n;
      const leaseWei = consent.permitLease ? safeParseEther(pricing.leasePerDayEth) : 0n;
      const licenseWei = consent.permitLicense ? safeParseEther(pricing.licenseFeeEth) : 0n;
      if (buyWei < 0n || leaseWei < 0n || licenseWei < 0n) {
        throw new Error('One of the prices is not a valid ETH amount.');
      }
      const splitRecipients = splitsToBpsPayload(pricing.splitRecipients) ?? undefined;

      const listing = await trpcClient.likenessMarketplace.createListing.mutate({
        entityId,
        title: pricing.title,
        description: pricing.description,
        buyPriceWei: buyWei.toString(),
        leasePricePerDayWei: leaseWei.toString(),
        licenseFeeWei: licenseWei.toString(),
        licenseRoyaltyBps: Number(pricing.licenseRoyaltyBps) || 0,
        maxDurationDays: Math.max(1, Math.min(365, Number(pricing.maxDurationDays) || 30)),
        ...(splitRecipients ? { splitRecipients } : {}),
      });
      return listing;
    },
    onSuccess: (listing) => {
      setNewListingId(listing.id);
      setStage('success');
      queryClient.invalidateQueries({ queryKey: ['likenessMarketplace'] });
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setStage('pricing');
    },
  });

  const totalAssets =
    faceImages.length + bodyImages.length + videoClips.length + (threeDAsset ? 1 : 0);

  const uploadStageReady = faceImages.length + bodyImages.length > 0;
  const metaStageReady = name.trim().length > 0 && shortDescription.trim().length > 0;
  const consentReady = consentStateReady(consent, { requireModalities: true });
  const pricingReady = pricingStateReady(pricing, consent);

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <UserCircle className="size-12 mx-auto mb-4 text-muted-foreground" />
        <h1 className="text-xl font-bold mb-2">Connect a wallet to continue</h1>
        <p className="text-sm text-muted-foreground">
          Listing your likeness on the marketplace requires a connected wallet so payouts route to
          you.
        </p>
      </div>
    );
  }

  if (stage === 'success' && newListingId) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <CheckCircle2 className="size-12 mx-auto mb-4 text-green-500" />
        <h1 className="text-2xl font-bold mb-2">Likeness listed</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Your likeness is live on the marketplace under the terms you set. You can update pricing
          or revoke consent at any time from your listings dashboard.
        </p>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => navigate({ to: '/marketplace/likeness' })}>
            Browse marketplace
          </Button>
          <Button variant="outline" asChild>
            <a href={`/marketplace/likeness/${newListingId}`}>View listing</a>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6">
        <Badge variant="secondary" className="text-[10px] mb-2">
          Verified Likeness Marketplace
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight">List your likeness</h1>
        <p className="text-muted-foreground mt-2">
          Upload reference photos, optionally generate stylized character renders, then publish
          under your own terms. Raw biometric assets stay private — only license holders can pull
          them as conditioning.
        </p>
      </header>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-6 text-xs text-muted-foreground">
        <StageDot label="1. Upload" active={stage === 'upload'} done={totalAssets > 0} />
        <StageDot label="2. Render" active={stage === 'render'} done={renderJobs.length > 0} />
        <StageDot label="3. Profile" active={stage === 'meta'} done={metaStageReady} />
        <StageDot label="4. Consent" active={stage === 'consent'} done={consentReady} />
        <StageDot label="5. Price" active={stage === 'pricing'} done={pricingReady} />
      </div>

      {stage === 'upload' && (
        <UploadStage
          faceImages={faceImages}
          setFaceImages={setFaceImages}
          bodyImages={bodyImages}
          setBodyImages={setBodyImages}
          videoClips={videoClips}
          setVideoClips={setVideoClips}
          threeDAsset={threeDAsset}
          setThreeDAsset={setThreeDAsset}
        />
      )}

      {stage === 'render' && (
        <RenderStage
          faceImages={faceImages}
          renderPrompt={renderPrompt}
          setRenderPrompt={setRenderPrompt}
          renderJobs={renderJobs}
          isGenerating={renderMutation.isPending}
          onGenerate={() => renderMutation.mutate()}
          selectedThumbnail={selectedThumbnail}
          setSelectedThumbnail={setSelectedThumbnail}
        />
      )}

      {stage === 'meta' && (
        <MetaStage
          name={name}
          setName={setName}
          shortDescription={shortDescription}
          setShortDescription={setShortDescription}
          gender={gender}
          setGender={setGender}
          ethnicity={ethnicity}
          setEthnicity={setEthnicity}
          approximateAge={approximateAge}
          setApproximateAge={setApproximateAge}
          detectedModalities={detectedModalities}
        />
      )}

      {stage === 'consent' && (
        <Card>
          <CardContent className="p-0">
            <ConsentStep state={consent} onChange={setConsent} showModalities={true} />
          </CardContent>
        </Card>
      )}

      {stage === 'pricing' && (
        <Card>
          <CardContent className="p-0">
            <PricingStep
              state={pricing}
              onChange={setPricing}
              permitSale={consent.permitSale}
              permitLease={consent.permitLease}
              permitLicense={consent.permitLicense}
            />
          </CardContent>
        </Card>
      )}

      {stage === 'submitting' && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="size-8 mx-auto mb-4 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Creating likeness entity, recording consent, publishing listing…
            </p>
          </CardContent>
        </Card>
      )}

      {/* Footer nav */}
      {stage !== 'submitting' && stage !== 'success' && (
        <div className="flex items-center justify-between mt-6">
          <Button
            variant="ghost"
            onClick={() => {
              if (stage === 'render') setStage('upload');
              else if (stage === 'meta') setStage('render');
              else if (stage === 'consent') setStage('meta');
              else if (stage === 'pricing') setStage('consent');
              else navigate({ to: '/create' });
            }}
          >
            <ChevronLeft className="size-4 mr-1" />
            {stage === 'upload' ? 'Back to /create' : 'Back'}
          </Button>

          {stage === 'pricing' ? (
            <Button
              onClick={() => {
                setStage('submitting');
                publishMutation.mutate();
              }}
              disabled={!pricingReady || publishMutation.isPending}
            >
              {publishMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
              Publish listing
            </Button>
          ) : (
            <Button
              onClick={() => {
                if (stage === 'upload') setStage('render');
                else if (stage === 'render') setStage('meta');
                else if (stage === 'meta') setStage('consent');
                else if (stage === 'consent') setStage('pricing');
              }}
              disabled={
                (stage === 'upload' && !uploadStageReady) ||
                (stage === 'meta' && !metaStageReady) ||
                (stage === 'consent' && !consentReady)
              }
            >
              {stage === 'render' && renderJobs.length === 0 ? 'Skip renders' : 'Continue'}
              <ChevronRight className="size-4 ml-1" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Stage components ─────────────────────────────────────────────────────

function StageDot({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div
      className={`flex items-center gap-1 px-2 py-1 rounded-full text-[11px] ${
        active
          ? 'bg-primary text-primary-foreground'
          : done
            ? 'text-foreground'
            : 'text-muted-foreground'
      }`}
    >
      {done && !active && <CheckCircle2 className="size-3" />}
      {label}
    </div>
  );
}

interface UploadStageProps {
  faceImages: UploadedAsset[];
  setFaceImages: (next: UploadedAsset[]) => void;
  bodyImages: UploadedAsset[];
  setBodyImages: (next: UploadedAsset[]) => void;
  videoClips: UploadedAsset[];
  setVideoClips: (next: UploadedAsset[]) => void;
  threeDAsset: UploadedAsset | null;
  setThreeDAsset: (next: UploadedAsset | null) => void;
}

function UploadStage(p: UploadStageProps) {
  return (
    <div className="space-y-5">
      <UploadGroup
        title="Face photos"
        sub="3–8 clear photos: front, 3/4 left, 3/4 right, profile. Neutral expression preferred. These stay private."
        icon={<ImageIcon className="size-4" />}
        accepted={['image/jpeg', 'image/png', 'image/webp', 'image/heic']}
        max={8}
        assets={p.faceImages}
        setAssets={p.setFaceImages}
      />
      <UploadGroup
        title="Body / full-figure photos"
        sub="Optional. Full-body or half-body shots in neutral poses."
        icon={<ImageIcon className="size-4" />}
        accepted={['image/jpeg', 'image/png', 'image/webp', 'image/heic']}
        max={8}
        assets={p.bodyImages}
        setAssets={p.setBodyImages}
      />
      <UploadGroup
        title="Video clips"
        sub="Optional. 5–15s idle + expression clips for motion / talking-scene licensing."
        icon={<Video className="size-4" />}
        accepted={['video/mp4', 'video/webm', 'video/quicktime']}
        max={4}
        assets={p.videoClips}
        setAssets={p.setVideoClips}
      />
      <UploadGroup
        title="3D scan"
        sub="Optional. GLB/GLTF/OBJ. Enables 3D / avatar licensing."
        icon={<Box className="size-4" />}
        accepted={['model/gltf+json', 'model/gltf-binary', 'model/obj']}
        max={1}
        assets={p.threeDAsset ? [p.threeDAsset] : []}
        setAssets={(next) => p.setThreeDAsset(next[0] ?? null)}
      />
    </div>
  );
}

function UploadGroup({
  title,
  sub,
  icon,
  accepted,
  max,
  assets,
  setAssets,
}: {
  title: string;
  sub: string;
  icon: React.ReactNode;
  accepted: string[];
  max: number;
  assets: UploadedAsset[];
  setAssets: (next: UploadedAsset[]) => void;
}) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon}
            <div>
              <h3 className="font-semibold text-sm">{title}</h3>
              <p className="text-xs text-muted-foreground">{sub}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {assets.length}/{max}
          </Badge>
        </div>

        {assets.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {assets.map((a, i) => (
              <div
                key={a.url}
                className="relative aspect-square rounded-md overflow-hidden bg-muted"
              >
                {a.mimeType.startsWith('image/') ? (
                  <img src={a.url} alt="" className="w-full h-full object-cover" />
                ) : a.mimeType.startsWith('video/') ? (
                  <video src={a.url} className="w-full h-full object-cover" muted />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Box className="size-6 text-muted-foreground" />
                  </div>
                )}
                <button
                  onClick={() => setAssets(assets.filter((_, j) => j !== i))}
                  className="absolute top-1 right-1 rounded-full bg-black/60 text-white p-1 hover:bg-black/80"
                  aria-label="Remove asset"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {assets.length < max && (
          <DirectUpload
            acceptedTypes={accepted}
            maxSizeMB={accepted[0]?.startsWith('video') ? 100 : 25}
            label={`Add ${title.toLowerCase()}`}
            onUploadComplete={(manifest, previewUrl) =>
              setAssets([
                ...assets,
                {
                  url: previewUrl,
                  contentHash: manifest.contentHash,
                  mimeType: manifest.mimeType,
                },
              ])
            }
          />
        )}
      </CardContent>
    </Card>
  );
}

interface RenderStageProps {
  faceImages: UploadedAsset[];
  renderPrompt: string;
  setRenderPrompt: (v: string) => void;
  renderJobs: { url: string; prompt: string }[];
  isGenerating: boolean;
  onGenerate: () => void;
  selectedThumbnail: string | null;
  setSelectedThumbnail: (v: string) => void;
}

function RenderStage(p: RenderStageProps) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Wand2 className="size-5 text-primary mt-0.5" />
          <div>
            <h3 className="font-semibold">Character renders (optional)</h3>
            <p className="text-xs text-muted-foreground">
              Generate stylized renders from your reference photos. The one you select becomes the
              public marketplace thumbnail — raw selfies stay private.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="render-prompt" className="text-sm">
            Style prompt
          </Label>
          <Textarea
            id="render-prompt"
            value={p.renderPrompt}
            onChange={(e) => p.setRenderPrompt(e.target.value)}
            rows={2}
          />
          <Button
            onClick={p.onGenerate}
            disabled={p.faceImages.length === 0 || p.isGenerating}
            size="sm"
          >
            {p.isGenerating ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="size-4 mr-2" />
                Generate 2 renders
              </>
            )}
          </Button>
          {p.faceImages.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Upload at least one face photo on the previous step to enable rendering.
            </p>
          )}
        </div>

        {p.renderJobs.length > 0 && (
          <>
            <Separator />
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Pick a thumbnail
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {p.renderJobs.map((r) => (
                  <button
                    key={r.url}
                    onClick={() => p.setSelectedThumbnail(r.url)}
                    className={`relative aspect-square rounded-md overflow-hidden border-2 transition-colors ${
                      p.selectedThumbnail === r.url
                        ? 'border-primary'
                        : 'border-transparent hover:border-border'
                    }`}
                  >
                    <img src={r.url} alt="" className="w-full h-full object-cover" />
                    {p.selectedThumbnail === r.url && (
                      <div className="absolute top-1 right-1 rounded-full bg-primary text-primary-foreground p-1">
                        <CheckCircle2 className="size-3" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface MetaStageProps {
  name: string;
  setName: (v: string) => void;
  shortDescription: string;
  setShortDescription: (v: string) => void;
  gender: string;
  setGender: (v: string) => void;
  ethnicity: string;
  setEthnicity: (v: string) => void;
  approximateAge: string;
  setApproximateAge: (v: string) => void;
  detectedModalities: LikenessModality[];
}

function MetaStage(p: MetaStageProps) {
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="lk-name" className="text-sm font-semibold">
            Display name
          </Label>
          <Input
            id="lk-name"
            value={p.name}
            onChange={(e) => p.setName(e.target.value)}
            placeholder="The name buyers see on the marketplace card"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lk-desc" className="text-sm font-semibold">
            Short description
          </Label>
          <Textarea
            id="lk-desc"
            value={p.shortDescription}
            onChange={(e) => p.setShortDescription(e.target.value)}
            rows={3}
            placeholder="A few sentences — look, range, what kinds of projects this suits."
          />
        </div>
        <Separator />
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label htmlFor="lk-gender" className="text-xs">
              Gender
            </Label>
            <Input
              id="lk-gender"
              value={p.gender}
              onChange={(e) => p.setGender(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lk-ethn" className="text-xs">
              Ethnicity
            </Label>
            <Input
              id="lk-ethn"
              value={p.ethnicity}
              onChange={(e) => p.setEthnicity(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lk-age" className="text-xs">
              Approx age
            </Label>
            <Input
              id="lk-age"
              type="number"
              value={p.approximateAge}
              onChange={(e) => p.setApproximateAge(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <Separator />
        <div className="space-y-1">
          <Label className="text-xs">Detected modalities (from uploads)</Label>
          <div className="flex flex-wrap gap-1.5">
            {p.detectedModalities.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                None yet — upload assets on the previous step.
              </span>
            ) : (
              p.detectedModalities.map((m) => (
                <Badge key={m} variant="secondary" className="text-[10px] capitalize">
                  {m}
                </Badge>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
