/**
 * /marketplace/likeness/$listingId — Listing detail + Buy/Lease/License flow.
 *
 * Pays the seller directly via ETH transfer (Circle DCW-signed), then calls
 * `likenessMarketplace.recordDeal` to register the deal server-side. The
 * buyer must pick an authorized use case (from the listing's consent) and,
 * for lease/license, a duration capped at the listing maximum.
 */

import { useMemo, useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useSignMessage } from 'wagmi';
import { toast } from 'sonner';
import { formatEther, type Hex } from 'viem';
import {
  Mic,
  Sparkles,
  ShieldCheck,
  BadgeCheck,
  Loader2,
  ChevronLeft,
  CheckCircle2,
  Play,
  Pause,
  AlertTriangle,
  Link2,
} from 'lucide-react';
import { useSendTransaction, useWriteContract } from '@/hooks/useCircleWrite';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { contentLicensingAbi } from '@loar/abis/generated';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  LIKENESS_USE_CASE_LABELS,
  LIKENESS_PROHIBITION_LABELS,
  type LikenessDealType,
  type LikenessUseCase,
} from '@/hooks/useEntities';
import { RoyaltySplitPreview } from '@/components/royalty/RoyaltySplitPreview';

export const Route = createFileRoute('/marketplace/likeness/$listingId')({
  component: ListingDetailPage,
});

function formatEthDisplay(wei: string): string {
  if (wei === '0') return '—';
  try {
    return `${formatEther(BigInt(wei))} ETH`;
  } catch {
    return '?';
  }
}

function ListingDetailPage() {
  const { listingId } = Route.useParams();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['likenessMarketplace', 'getListing', listingId],
    queryFn: () => trpcClient.likenessMarketplace.getListing.query({ listingId }),
  });

  const [dealType, setDealType] = useState<LikenessDealType>('LICENSE');
  const [duration, setDuration] = useState('7');
  const [useCase, setUseCase] = useState<LikenessUseCase | null>(null);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);
  const [completedDealId, setCompletedDealId] = useState<string | null>(null);

  const { sendTransactionAsync, isPending: txPending } = useSendTransaction();
  const { writeContractAsync, isPending: contractPending } = useWriteContract();
  const { signMessageAsync, isPending: signPending } = useSignMessage();

  const { data: onChainAvail } = useQuery({
    queryKey: ['likenessMarketplace', 'onChainAvailability'],
    queryFn: () => trpcClient.likenessMarketplace.onChainAvailability.query(),
    staleTime: 60_000,
  });

  const listing = data?.listing;
  const consentTerms = data?.consentTerms;
  const isOnChainListing = !!listing?.onChainContentHash && listing?.onChainChainId !== null;
  const isOwner =
    address && listing && address.toLowerCase() === listing.sellerAddress.toLowerCase();

  // Default useCase to the first allowed value once consent loads.
  if (consentTerms && useCase === null && consentTerms.allowedUseCases.length > 0) {
    setUseCase(consentTerms.allowedUseCases[0] as LikenessUseCase);
  }

  const requiredWei = useMemo(() => {
    if (!listing) return 0n;
    try {
      if (dealType === 'BUY') return BigInt(listing.buyPriceWei);
      if (dealType === 'LEASE') {
        return BigInt(listing.leasePricePerDayWei) * BigInt(Math.max(1, Number(duration) || 0));
      }
      return BigInt(listing.licenseFeeWei);
    } catch {
      return 0n;
    }
  }, [listing, dealType, duration]);

  const purchaseMutation = useMutation({
    mutationFn: async () => {
      if (!listing) throw new Error('Listing not loaded');
      if (!isConnected || !address) throw new Error('Connect a wallet first');
      if (!useCase) throw new Error('Pick a use case');
      if (address.toLowerCase() === listing.sellerAddress.toLowerCase()) {
        throw new Error("You can't purchase your own listing");
      }
      const needsDuration = dealType !== 'BUY';
      const days = needsDuration ? Math.max(1, Number(duration) || 0) : undefined;
      if (needsDuration && (!days || days > listing.maxDurationDays)) {
        throw new Error(`Duration must be between 1 and ${listing.maxDurationDays} days`);
      }
      if (requiredWei <= 0n) {
        throw new Error('This listing does not support the selected deal type');
      }

      // ── On-chain path (ContentLicensing.sol) ─────────────────────────
      if (
        isOnChainListing &&
        listing.onChainContentHash &&
        listing.onChainContentLicensingAddress
      ) {
        const contentHash = listing.onChainContentHash as Hex;
        const contractAddress = listing.onChainContentLicensingAddress as `0x${string}`;
        let txHash: `0x${string}`;
        if (dealType === 'BUY') {
          txHash = await writeContractAsync({
            address: contractAddress,
            abi: contentLicensingAbi,
            functionName: 'buyContent',
            args: [contentHash],
            value: requiredWei,
          });
        } else if (dealType === 'LEASE') {
          txHash = await writeContractAsync({
            address: contractAddress,
            abi: contentLicensingAbi,
            functionName: 'rentContent',
            args: [contentHash, BigInt(days!)],
            value: requiredWei,
          });
        } else {
          txHash = await writeContractAsync({
            address: contractAddress,
            abi: contentLicensingAbi,
            functionName: 'licenseContent',
            args: [contentHash, BigInt(days!)],
            value: requiredWei,
          });
        }
        const deal = await trpcClient.likenessMarketplace.recordOnChainDeal.mutate({
          listingId,
          dealType,
          declaredUseCase: useCase,
          txHash,
        });
        return deal;
      }

      // ── Off-chain fallback (Phase 1: direct ETH transfer) ─────────────
      const txHash = await sendTransactionAsync({
        to: listing.sellerAddress,
        value: requiredWei,
      });
      const deal = await trpcClient.likenessMarketplace.recordDeal.mutate({
        listingId,
        dealType,
        pricePaidWei: requiredWei.toString(),
        durationDays: days,
        declaredUseCase: useCase,
        txHash,
      });
      return deal;
    },
    onSuccess: (deal) => {
      setCompletedDealId(deal.id);
      toast.success(`${dealType} confirmed`);
      refetch();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  /**
   * Server-side seller publish flow: prepare digest → sign → submit rights →
   * register on-chain → confirm. Walks the seller through 3 server calls +
   * 1 wallet signature + 1 Circle DCW contract call.
   */
  const publishOnChainMutation = useMutation({
    mutationFn: async () => {
      if (!listing) throw new Error('Listing not loaded');
      if (!isOwner) throw new Error('Only the listing owner can publish on-chain');

      // Step 1 — get digest from server
      const prep = await trpcClient.likenessMarketplace.prepareOnChainPublish.mutate({
        listingId,
      });

      let rightsTxHash: string | null = null;
      if (!prep.skipRightsAttestation) {
        // Step 2 — seller signs the EIP-191 digest (wallet popup)
        const signature = await signMessageAsync({
          message: { raw: prep.digest as `0x${string}` },
        });
        // Step 3 — server submits setRightsWithCreatorSig
        const rightsResult = await trpcClient.likenessMarketplace.submitOnChainRights.mutate({
          listingId,
          signature,
          deadline: prep.deadline,
        });
        rightsTxHash = rightsResult.rightsTxHash;
      }

      // Step 3.5 — if the listing has multi-recipient splits, the server
      // already pre-claimed split ownership for us; we just submit setSplits
      // via Circle DCW now (no popup) so payments route through SplitRouter.
      let splitsTxHash: `0x${string}` | undefined;
      if (prep.setSplitsCall) {
        splitsTxHash = await writeContractAsync({
          address: prep.setSplitsCall.address as `0x${string}`,
          abi: prep.setSplitsCall.abi,
          functionName: prep.setSplitsCall.functionName,
          args: prep.setSplitsCall.args as never,
        });
      }

      // Step 4 — seller calls registerContent via Circle DCW (no popup)
      const registerTxHash = await writeContractAsync({
        address: prep.contentLicensing as `0x${string}`,
        abi: contentLicensingAbi,
        functionName: 'registerContent',
        args: [
          prep.registerContentArgs.contentHash as `0x${string}`,
          BigInt(prep.registerContentArgs.universeId),
          prep.registerContentArgs.splitEntityHash as `0x${string}`,
          BigInt(prep.registerContentArgs.buyPriceWei),
          BigInt(prep.registerContentArgs.rentPricePerDayWei),
          BigInt(prep.registerContentArgs.licenseFeeWei),
          prep.registerContentArgs.licenseRoyaltyBps,
        ],
      });

      // Step 5 — server verifies registerContent (+ splits) + stamps the listing
      const result = await trpcClient.likenessMarketplace.confirmOnChainPublish.mutate({
        listingId,
        registerTxHash,
        ...(splitsTxHash ? { splitsTxHash } : {}),
      });
      return { ...result, rightsTxHash, registerTxHash, splitsTxHash };
    },
    onSuccess: () => {
      toast.success('Listing published on-chain');
      refetch();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function togglePreview() {
    if (!listing?.previewUrl) return;
    if (audioEl) {
      audioEl.pause();
      audioEl.currentTime = 0;
    }
    if (audioPlaying) {
      setAudioPlaying(false);
      return;
    }
    const a = new Audio(listing.previewUrl);
    a.onended = () => setAudioPlaying(false);
    a.play().catch((e) => toast.error(`Preview failed: ${e.message}`));
    setAudioEl(a);
    setAudioPlaying(true);
  }

  if (isLoading) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <p className="text-sm text-muted-foreground">Listing not found.</p>
      </div>
    );
  }

  if (completedDealId) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <CheckCircle2 className="size-12 mx-auto mb-4 text-green-500" />
        <h1 className="text-2xl font-bold mb-2">Deal recorded</h1>
        <p className="text-sm text-muted-foreground mb-6">
          {dealType === 'BUY'
            ? 'You now own perpetual rights to use this likeness.'
            : `Your ${dealType.toLowerCase()} runs for ${duration} day${duration === '1' ? '' : 's'}.`}
        </p>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => navigate({ to: '/marketplace/likeness' })}>
            Back to marketplace
          </Button>
          <Button variant="outline" onClick={() => navigate({ to: '/dashboard' })}>
            View dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <Link
        to="/marketplace/likeness"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="size-4 mr-1" />
        Back to marketplace
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Media + preview */}
        <Card className="overflow-hidden">
          <div className="relative aspect-square bg-muted">
            {listing.thumbnailUrl ? (
              <img
                src={listing.thumbnailUrl}
                alt={listing.title}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {listing.entityKind === 'voice' ? (
                  <Mic className="size-20 text-muted-foreground/40" />
                ) : (
                  <Sparkles className="size-20 text-muted-foreground/40" />
                )}
              </div>
            )}
            {listing.previewUrl && (
              <Button
                size="icon"
                variant="secondary"
                className="absolute bottom-3 right-3 rounded-full size-12"
                onClick={togglePreview}
              >
                {audioPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
              </Button>
            )}
          </div>
        </Card>

        {/* Listing details + buy panel */}
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Badge variant="secondary" className="text-[10px] capitalize">
                {listing.entityKind === 'voice' ? (
                  <>
                    <Mic className="size-2.5 mr-1" />
                    Voice
                  </>
                ) : (
                  <>
                    <Sparkles className="size-2.5 mr-1" />
                    Likeness
                  </>
                )}
              </Badge>
              {consentTerms?.realPerson && (
                <Badge variant="outline" className="text-[10px]">
                  Real person
                </Badge>
              )}
              {consentTerms?.verified ? (
                <Badge variant="default" className="text-[10px]">
                  <ShieldCheck className="size-2.5 mr-1" />
                  Verified
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px]">
                  <BadgeCheck className="size-2.5 mr-1" />
                  Consent attested
                </Badge>
              )}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{listing.title}</h1>
            {listing.description && (
              <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                {listing.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Listed by{' '}
              <span className="font-mono">
                {listing.sellerAddress.slice(0, 6)}…{listing.sellerAddress.slice(-4)}
              </span>
              {isOnChainListing && (
                <Badge variant="default" className="ml-2 text-[10px]">
                  <Link2 className="size-2.5 mr-1" />
                  On-chain
                </Badge>
              )}
            </p>
          </div>

          {/* Owner: Publish on-chain CTA */}
          {isOwner && !isOnChainListing && onChainAvail?.available && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-2">
                  <Link2 className="size-4 text-primary mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold mb-1">Publish on-chain</p>
                    <p className="text-muted-foreground">
                      Route payments through ContentLicensing.sol on {onChainAvail.chainLabel}.
                      Splits + platform fee handled by the contract. One wallet signature + one
                      Circle DCW tx.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={publishOnChainMutation.isPending || signPending || contractPending}
                  onClick={() => publishOnChainMutation.mutate()}
                >
                  {publishOnChainMutation.isPending ? (
                    <>
                      <Loader2 className="size-3.5 mr-2 animate-spin" />
                      Publishing…
                    </>
                  ) : (
                    <>
                      <Link2 className="size-3.5 mr-2" />
                      Publish on-chain
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          )}

          <Separator />

          {/* Deal-type selector */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Choose deal type</Label>
            <div className="grid grid-cols-3 gap-2">
              <DealTypeButton
                dealType="BUY"
                active={dealType === 'BUY'}
                onClick={() => setDealType('BUY')}
                priceLabel={formatEthDisplay(listing.buyPriceWei)}
                disabled={listing.buyPriceWei === '0' || !consentTerms?.permitSale}
                subLabel="Permanent"
              />
              <DealTypeButton
                dealType="LEASE"
                active={dealType === 'LEASE'}
                onClick={() => setDealType('LEASE')}
                priceLabel={`${formatEthDisplay(listing.leasePricePerDayWei)}/d`}
                disabled={listing.leasePricePerDayWei === '0' || !consentTerms?.permitLease}
                subLabel="Auto-expires"
              />
              <DealTypeButton
                dealType="LICENSE"
                active={dealType === 'LICENSE'}
                onClick={() => setDealType('LICENSE')}
                priceLabel={formatEthDisplay(listing.licenseFeeWei)}
                disabled={listing.licenseFeeWei === '0' || !consentTerms?.permitLicense}
                subLabel="+ royalty"
              />
            </div>
          </div>

          {/* Duration */}
          {dealType !== 'BUY' && (
            <div className="space-y-2">
              <Label htmlFor="lm-duration" className="text-sm font-semibold">
                Duration (days) — max {listing.maxDurationDays}
              </Label>
              <Input
                id="lm-duration"
                type="number"
                min={1}
                max={listing.maxDurationDays}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>
          )}

          {/* Use case */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold">Declared use case</Label>
            <p className="text-xs text-muted-foreground">
              Must match one of the categories the rights holder authorized.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(consentTerms?.allowedUseCases ?? []).map((uc) => (
                <button
                  key={uc}
                  onClick={() => setUseCase(uc as LikenessUseCase)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${
                    useCase === uc
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-muted'
                  }`}
                >
                  {LIKENESS_USE_CASE_LABELS[uc as LikenessUseCase] ?? uc}
                </button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Royalty split preview — buyer sees exactly where the payment flows
              given this listing's entity lineage. */}
          {listing.entityId && <RoyaltySplitPreview assetId={listing.entityId} compact />}

          {/* Total + buy button */}
          <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">
                {requiredWei > 0n ? `${formatEther(requiredWei)} ETH` : '—'}
              </p>
            </div>
            <Button
              size="lg"
              disabled={
                !isConnected ||
                requiredWei <= 0n ||
                !useCase ||
                txPending ||
                purchaseMutation.isPending
              }
              onClick={() => purchaseMutation.mutate()}
            >
              {txPending || purchaseMutation.isPending ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" />
                  Confirming…
                </>
              ) : (
                <>Confirm {dealType}</>
              )}
            </Button>
          </div>

          {!isConnected && (
            <p className="text-xs text-muted-foreground text-center">
              Connect a wallet to buy, lease, or license this likeness.
            </p>
          )}
        </div>
      </div>

      {/* Terms panel */}
      {consentTerms && (
        <Card className="mt-8">
          <CardContent className="p-6 space-y-4">
            <div className="flex items-start gap-2">
              <ShieldCheck className="size-4 text-primary mt-0.5" />
              <div>
                <h3 className="font-semibold text-sm">Rights holder terms</h3>
                <p className="text-xs text-muted-foreground">
                  Consent attestation captured at listing time.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  Allowed uses
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {consentTerms.allowedUseCases.map((uc) => (
                    <Badge key={uc} variant="secondary" className="text-[10px]">
                      {LIKENESS_USE_CASE_LABELS[uc as LikenessUseCase] ?? uc}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                  Hard prohibitions
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {consentTerms.prohibitions.length === 0 ? (
                    <span className="text-xs text-muted-foreground">None</span>
                  ) : (
                    consentTerms.prohibitions.map((p) => (
                      <Badge
                        key={p}
                        variant="outline"
                        className="text-[10px] border-destructive/30 text-destructive"
                      >
                        <AlertTriangle className="size-2.5 mr-1" />
                        {LIKENESS_PROHIBITION_LABELS[
                          p as keyof typeof LIKENESS_PROHIBITION_LABELS
                        ] ?? p}
                      </Badge>
                    ))
                  )}
                </div>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground pt-2 border-t">
              By completing this deal you agree that any use outside the terms above is unauthorized
              and may carry legal liability. LOAR routes payment directly to the rights holder; the
              underlying biometric model is not transferred — only usage rights for the chosen scope
              are.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface DealTypeButtonProps {
  dealType: LikenessDealType;
  active: boolean;
  onClick: () => void;
  priceLabel: string;
  subLabel: string;
  disabled: boolean;
}

function DealTypeButton({
  dealType,
  active,
  onClick,
  priceLabel,
  subLabel,
  disabled,
}: DealTypeButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-0.5 rounded-lg border p-3 text-center transition-colors ${
        disabled
          ? 'opacity-40 cursor-not-allowed border-border'
          : active
            ? 'border-primary bg-primary/5'
            : 'border-border hover:bg-muted'
      }`}
    >
      <span className="text-xs font-semibold">{dealType}</span>
      <span className="text-sm font-bold">{priceLabel}</span>
      <span className="text-[10px] text-muted-foreground">{subLabel}</span>
    </button>
  );
}
