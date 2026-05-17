/**
 * ListPersonaForSaleDialog — three-step flow that lists an existing persona
 * entity on the Likeness Marketplace:
 *
 *   1. Scope:   bundle summary (which components are in the package) + any
 *               moderation gate (parody pending review blocks the whole flow).
 *   2. Consent: ConsentStep adapted for bundle (modalities locked to ['full']).
 *   3. Pricing: standard pricing + splits.
 *
 * Reuses the existing `likenessMarketplace.submitConsent` + `createListing`
 * endpoints — the persona entity is treated as a first-class listable entity
 * via the kind=persona branch added to `readOwnedEntity`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Loader2,
  X,
  Tag,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Mic2,
  Box,
  Sparkles,
  AlertTriangle,
  UserCircle2,
  ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { trpcClient } from '@/utils/trpc';
import { LIKENESS_ATTESTATION_TEXT_V1 } from '@/hooks/useEntities';
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
} from './consent-pricing-steps';

interface ListPersonaForSaleDialogProps {
  persona: {
    id: string;
    name: string;
    description?: string | null;
    imageUrl?: string | null;
    metadata: Record<string, unknown>;
  };
  onClose: () => void;
  onSuccess?: (listingId: string) => void;
}

type Step = 'scope' | 'consent' | 'pricing' | 'submitting' | 'success';

interface PersonaMetaShape {
  origin: 'self' | 'parody' | 'fictional';
  parodySubject?: string;
  parodyDisclaimer?: string;
  voiceEntityId?: string;
  likenessEntityId?: string;
  threeDAssetUrl?: string;
  moderationStatus: 'not_required' | 'pending_review' | 'approved' | 'rejected';
}

export function ListPersonaForSaleDialog({
  persona,
  onClose,
  onSuccess,
}: ListPersonaForSaleDialogProps) {
  const queryClient = useQueryClient();
  const meta = persona.metadata as unknown as PersonaMetaShape;

  // ── Gate: parody pending or rejected blocks the whole flow ──────────
  const moderationBlocked =
    meta.moderationStatus === 'pending_review' || meta.moderationStatus === 'rejected';

  const [step, setStep] = useState<Step>('scope');
  const [consent, setConsent] = useState<ConsentState>(() =>
    emptyConsentState({
      defaultModalities: ['full'],
      // Default `realPerson` based on origin so the consent form starts
      // honest. Parody/fictional get realPerson=false; self defaults true.
      defaultUseCases: undefined,
    })
  );
  // L-2: initialize `realPerson` from the persona's origin ONCE per mount.
  // Previously the dep was [meta.origin], which meant any flip of origin
  // while the dialog was open (rare but possible with non-keyed remounts)
  // would stomp user input on the consent step. Use a didInit ref so the
  // alignment runs exactly one time, on first paint, capturing the origin
  // the dialog was opened with.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    setConsent((c) => ({ ...c, realPerson: meta.origin === 'self' }));
    didInit.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pricing, setPricing] = useState<PricingState>(() =>
    emptyPricingState({ title: persona.name, description: persona.description ?? '' })
  );
  const [newListingId, setNewListingId] = useState<string | null>(null);

  // Look up component entity names for the bundle summary.
  const voice = useQuery({
    queryKey: ['entities', 'one', meta.voiceEntityId ?? null],
    queryFn: () =>
      meta.voiceEntityId ? trpcClient.entities.get.query({ entityId: meta.voiceEntityId }) : null,
    enabled: !!meta.voiceEntityId,
  });
  const likeness = useQuery({
    queryKey: ['entities', 'one', meta.likenessEntityId ?? null],
    queryFn: () =>
      meta.likenessEntityId
        ? trpcClient.entities.get.query({ entityId: meta.likenessEntityId })
        : null,
    enabled: !!meta.likenessEntityId,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      await trpcClient.likenessMarketplace.submitConsent.mutate({
        entityId: persona.id,
        modalities: ['full'],
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
        entityId: persona.id,
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
      setStep('success');
      queryClient.invalidateQueries({ queryKey: ['likenessMarketplace'] });
      queryClient.invalidateQueries({ queryKey: ['listings', 'persona', persona.id] });
      onSuccess?.(listing.id);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setStep('pricing');
    },
  });

  const consentReady = useMemo(() => consentStateReady(consent), [consent]);
  const pricingReady = useMemo(() => pricingStateReady(pricing, consent), [pricing, consent]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b p-5">
          <div className="flex min-w-0 items-center gap-3">
            <Tag className="size-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h2 className="truncate font-bold">List "{persona.name}" for sale</h2>
              <p className="flex items-center gap-1 text-xs text-muted-foreground capitalize">
                Persona package
                {meta.origin !== 'self' && (
                  <Badge variant="outline" className="ml-1 text-[10px] capitalize">
                    {meta.origin}
                  </Badge>
                )}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* ── Scope ────────────────────────────────────────────── */}
          {step === 'scope' && (
            <div className="space-y-5 p-5">
              {moderationBlocked && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <AlertTriangle className="mr-1 inline h-4 w-4 text-amber-600" />
                  {meta.moderationStatus === 'pending_review' ? (
                    <>
                      This parody persona is awaiting admin review. Listing is locked until it is
                      approved. You'll be able to publish from this dialog the moment the review
                      completes.
                    </>
                  ) : (
                    <>
                      This persona was rejected in moderation review. Listings are permanently
                      blocked. Create a new persona if you want to retry.
                    </>
                  )}
                </div>
              )}

              <div>
                <h3 className="font-semibold">Bundle scope</h3>
                <p className="text-sm text-muted-foreground">
                  A buyer who licenses this persona gets the components below as one bundle, scoped
                  to the use cases you authorize on the next step.
                </p>
              </div>

              <div className="space-y-2">
                <ComponentSummary
                  icon={<Mic2 className="h-4 w-4" />}
                  label="Voice"
                  value={
                    meta.voiceEntityId
                      ? (voice.data?.name ?? `Linked (${meta.voiceEntityId.slice(0, 8)}…)`)
                      : 'Not included'
                  }
                  on={!!meta.voiceEntityId}
                />
                <ComponentSummary
                  icon={<ImageIcon className="h-4 w-4" />}
                  label="Looks"
                  value={
                    meta.likenessEntityId
                      ? (likeness.data?.name ?? `Linked (${meta.likenessEntityId.slice(0, 8)}…)`)
                      : 'Not included'
                  }
                  on={!!meta.likenessEntityId}
                />
                <ComponentSummary
                  icon={<Box className="h-4 w-4" />}
                  label="3D model"
                  value={meta.threeDAssetUrl ? 'Attached (GLB)' : 'Not included'}
                  on={!!meta.threeDAssetUrl}
                />
                <ComponentSummary
                  icon={<Sparkles className="h-4 w-4" />}
                  label="Personality"
                  value="Bio + system prompt + tone + exemplars"
                  on
                />
              </div>

              {meta.origin === 'parody' && meta.parodyDisclaimer && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                  <div className="mb-1 font-medium">Parody disclaimer (shown on every listing)</div>
                  <p className="text-muted-foreground">{meta.parodyDisclaimer}</p>
                </div>
              )}

              {meta.origin === 'fictional' && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                  <Sparkles className="mr-1 inline h-4 w-4" />
                  Fictional-origin personas are sold under the original-IP track. You affirmed no
                  real person is depicted at creation time.
                </div>
              )}

              <div className="rounded-md bg-primary/5 border border-primary/20 p-3 text-xs text-muted-foreground">
                <UserCircle2 className="mr-1 inline h-3.5 w-3.5" />
                Components stay individually licensable. Anyone with a deal on{' '}
                <strong>this persona</strong> gets the bundle; deals on the underlying voice or
                likeness entities are independent.
              </div>
            </div>
          )}

          {/* ── Consent ──────────────────────────────────────────── */}
          {step === 'consent' && (
            <ConsentStep state={consent} onChange={setConsent} showModalities={false} />
          )}

          {/* ── Pricing ──────────────────────────────────────────── */}
          {step === 'pricing' && (
            <PricingStep
              state={pricing}
              onChange={setPricing}
              permitSale={consent.permitSale}
              permitLease={consent.permitLease}
              permitLicense={consent.permitLicense}
            />
          )}

          {step === 'submitting' && (
            <div className="py-16 text-center">
              <Loader2 className="mx-auto mb-4 size-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Recording bundle consent, publishing listing…
              </p>
            </div>
          )}

          {step === 'success' && newListingId && (
            <div className="px-6 py-16 text-center">
              <CheckCircle2 className="mx-auto mb-4 size-12 text-emerald-500" />
              <h3 className="mb-2 text-lg font-bold">Persona is live</h3>
              <p className="mb-6 text-sm text-muted-foreground">
                Your persona is now on the Likeness Marketplace. Buyers can purchase, lease, or
                license it under the terms you authorized.
              </p>
              <div className="flex flex-col gap-2">
                <Button asChild className="w-full">
                  <a href={`/marketplace/persona/${persona.id}`}>View persona</a>
                </Button>
                <Button asChild variant="outline" className="w-full">
                  <a href={`/marketplace/likeness/${newListingId}`}>View listing terms</a>
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {(step === 'scope' || step === 'consent' || step === 'pricing') && (
          <div className="flex items-center justify-between gap-3 border-t bg-muted/30 p-4">
            {step === 'scope' ? (
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setStep(step === 'pricing' ? 'consent' : 'scope')}
                disabled={submitMutation.isPending}
              >
                <ChevronLeft className="mr-1 size-4" />
                Back
              </Button>
            )}
            {step === 'scope' && (
              <Button
                onClick={() => setStep('consent')}
                disabled={moderationBlocked}
                title={
                  moderationBlocked ? 'Listing is locked until moderation completes' : undefined
                }
              >
                Continue
                <ChevronRight className="ml-1 size-4" />
              </Button>
            )}
            {step === 'consent' && (
              <Button onClick={() => setStep('pricing')} disabled={!consentReady}>
                Continue
                <ChevronRight className="ml-1 size-4" />
              </Button>
            )}
            {step === 'pricing' && (
              <Button
                onClick={() => {
                  setStep('submitting');
                  submitMutation.mutate();
                }}
                disabled={!pricingReady || submitMutation.isPending}
              >
                {submitMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                Publish listing
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ComponentSummary({
  icon,
  label,
  value,
  on,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  on: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-md border p-2.5 text-sm ${
        on ? '' : 'opacity-50'
      }`}
    >
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-md ${on ? 'bg-primary/10 text-primary' : 'bg-muted'}`}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{label}</div>
        <div className="truncate text-xs text-muted-foreground">{value}</div>
      </div>
      {on && <CheckCircle2 className="size-4 text-emerald-500" />}
    </div>
  );
}
