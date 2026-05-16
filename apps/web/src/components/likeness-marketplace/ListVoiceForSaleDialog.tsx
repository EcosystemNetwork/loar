/**
 * ListVoiceForSaleDialog — three-step flow that promotes a cloned/designed
 * voice into a marketplace listing:
 *   1. Promote: create the `voice` entity (idempotent — re-uses existing).
 *   2. Consent: record an attestation revision authorizing sale/lease/license.
 *   3. List:    publish a marketplace listing with pricing.
 *
 * Used from VoiceStudio → MyVoices on `clone` and `design` source voices.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, X, Tag, CheckCircle2, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  type ConsentState,
  type PricingState,
} from './consent-pricing-steps';
import type { MyVoice } from '@/components/voice-studio/voice-studio.types';

interface ListVoiceForSaleDialogProps {
  voice: MyVoice;
  onClose: () => void;
  onSuccess?: (listingId: string) => void;
}

type Step = 'consent' | 'pricing' | 'submitting' | 'success';

export function ListVoiceForSaleDialog({ voice, onClose, onSuccess }: ListVoiceForSaleDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('consent');
  const [consent, setConsent] = useState<ConsentState>(() =>
    emptyConsentState({ defaultModalities: ['full'] })
  );
  const [pricing, setPricing] = useState<PricingState>(() =>
    emptyPricingState({ title: voice.name, description: voice.description ?? '' })
  );
  const [newListingId, setNewListingId] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const entity = await trpcClient.likenessMarketplace.promoteVoiceToEntity.mutate({
        userVoiceId: voice.id,
        realPerson: consent.realPerson,
      });

      await trpcClient.likenessMarketplace.submitConsent.mutate({
        entityId: entity.id,
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

      const listing = await trpcClient.likenessMarketplace.createListing.mutate({
        entityId: entity.id,
        title: pricing.title,
        description: pricing.description,
        buyPriceWei: buyWei.toString(),
        leasePricePerDayWei: leaseWei.toString(),
        licenseFeeWei: licenseWei.toString(),
        licenseRoyaltyBps: Number(pricing.licenseRoyaltyBps) || 0,
        maxDurationDays: Math.max(1, Math.min(365, Number(pricing.maxDurationDays) || 30)),
      });
      return listing;
    },
    onSuccess: (listing) => {
      setNewListingId(listing.id);
      setStep('success');
      queryClient.invalidateQueries({ queryKey: ['likenessMarketplace'] });
      onSuccess?.(listing.id);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setStep('pricing');
    },
  });

  const consentReady = consentStateReady(consent);
  const pricingReady = pricingStateReady(pricing, consent);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card rounded-2xl border w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-5 border-b">
          <div className="flex items-center gap-3 min-w-0">
            <Tag className="size-5 text-primary shrink-0" />
            <div className="min-w-0">
              <h2 className="font-bold truncate">List "{voice.name}" for sale</h2>
              <p className="text-xs text-muted-foreground capitalize">
                {voice.source} voice · ElevenLabs
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {step === 'consent' && (
            <ConsentStep state={consent} onChange={setConsent} showModalities={false} />
          )}

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
              <Loader2 className="size-8 mx-auto mb-4 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Creating entity, recording consent, publishing listing…
              </p>
            </div>
          )}

          {step === 'success' && newListingId && (
            <div className="py-16 text-center px-6">
              <CheckCircle2 className="size-12 mx-auto mb-4 text-green-500" />
              <h3 className="text-lg font-bold mb-2">Listed on the Likeness Marketplace</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Your voice is now live. Buyers can purchase, lease, or license it according to the
                terms you set. You can update pricing or revoke consent any time from your listings
                dashboard.
              </p>
              <Button asChild className="w-full">
                <a href={`/marketplace/likeness/${newListingId}`}>View Listing</a>
              </Button>
            </div>
          )}
        </div>

        {(step === 'consent' || step === 'pricing') && (
          <div className="flex items-center justify-between gap-3 p-4 border-t bg-muted/30">
            <Button variant="ghost" onClick={onClose} disabled={submitMutation.isPending}>
              Cancel
            </Button>
            {step === 'consent' ? (
              <Button onClick={() => setStep('pricing')} disabled={!consentReady}>
                Continue
                <ChevronRight className="size-4 ml-1" />
              </Button>
            ) : (
              <Button
                onClick={() => {
                  setStep('submitting');
                  submitMutation.mutate();
                }}
                disabled={!pricingReady || submitMutation.isPending}
              >
                {submitMutation.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                Publish listing
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
