/**
 * Pricing Page — Higgsfield-style subscription tier cards.
 *
 * Dark card layout with monthly/annual toggle, highlighted "popular" tier,
 * feature bullet lists, and Stripe Checkout integration.
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useChainId } from 'wagmi';
import { getEvmAddresses, isZeroAddress } from '@/configs/addresses';
import { Button } from '@/components/ui/button';
import {
  Check,
  Zap,
  Crown,
  Rocket,
  Building2,
  Loader2,
  ArrowRight,
  Sparkles,
  Coins,
} from 'lucide-react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/states';

export const Route = createFileRoute('/pricing')({
  component: PricingPage,
});

const TIER_ICONS: Record<string, React.ReactNode> = {
  starter: <Zap className="h-5 w-5" />,
  plus: <Rocket className="h-5 w-5" />,
  ultra: <Crown className="h-5 w-5" />,
  business: <Building2 className="h-5 w-5" />,
};

// One brand, one highlighted plan: the server-flagged `popular` tier gets the
// primary accent; every other tier is neutral. No per-tier rainbow.
const tierBorder = (popular: boolean) => (popular ? 'border-primary' : 'border-border');
const tierButton = (popular: boolean) =>
  popular
    ? 'bg-primary hover:bg-primary/90 text-primary-foreground'
    : 'border border-border bg-transparent hover:bg-muted text-foreground';
const TIER_BADGE = 'bg-muted text-foreground/80';

// ERC20 ABI fragment for transfer
const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

function PricingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, sessionReady } = useWalletAuth();
  const walletChainId = useChainId();
  const queryClient = useQueryClient();
  const [billing, setBilling] = useState<'monthly' | 'annual'>('monthly');
  const [subscribingTier, setSubscribingTier] = useState<string | null>(null);

  const {
    data: tiers,
    isLoading,
    isError,
    refetch: refetchTiers,
  } = useQuery({
    queryKey: ['subscription-tiers'],
    queryFn: () => trpcClient.platformSubscriptions.getTiers.query(),
  });

  const { data: mySub } = useQuery({
    queryKey: ['my-subscription'],
    queryFn: () => trpcClient.platformSubscriptions.getMySubscription.query(),
    enabled: isAuthenticated,
  });

  const subscribeMutation = useMutation({
    mutationFn: async (tierId: string) => {
      const tier = (tiers ?? []).find((t: any) => t.id === tierId);
      if (!tier) throw new Error('Tier not found');

      const loarTokens = billing === 'annual' ? tier.annualLoarTokens : tier.monthlyLoarTokens;
      const totalLoarForPeriod = billing === 'annual' ? loarTokens * 12 : loarTokens;

      // WEB-6: don't act on localStorage-only auth — require /auth/me OK.
      if (!sessionReady) throw new Error('Session still validating, please retry');
      if (!isAuthenticated) throw new Error('Not signed in');

      // Dynamically import viem for encoding
      const { encodeFunctionData, parseUnits: pu } = await import('viem');

      const chainId = walletChainId || Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);
      const loarAddress = getEvmAddresses(chainId)?.loarToken;
      const treasuryAddress = import.meta.env.VITE_TREASURY_ADDRESS as `0x${string}` | undefined;
      if (!loarAddress || isZeroAddress(loarAddress)) {
        throw new Error(`$LOAR token not deployed on chain ${chainId}`);
      }
      if (!treasuryAddress) {
        throw new Error('Treasury address not configured');
      }

      // Encode ERC20 transfer call
      const data = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [treasuryAddress, pu(totalLoarForPeriod.toString(), 18)],
      });

      // Send the ERC20 transfer via server-proxied Circle wallet
      const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
      const txRes = await fetch(`${SERVER_URL}/api/tx/write`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: loarAddress,
          abi: ERC20_TRANSFER_ABI,
          functionName: 'transfer',
          args: [treasuryAddress, pu(totalLoarForPeriod.toString(), 18).toString()],
          chainId,
        }),
      });

      if (!txRes.ok) {
        const errData = await txRes.json().catch(() => ({ error: 'Transaction failed' }));
        throw new Error(errData.error || 'Transaction failed');
      }

      const { txHash } = await txRes.json();

      // Verify on server + create subscription
      return trpcClient.platformSubscriptions.subscribeWithLoar.mutate({
        tierId: tierId as any,
        billing,
        txHash,
        loarAmount: pu(totalLoarForPeriod.toString(), 18).toString(),
        chainId,
      });
    },
    onSuccess: (data) => {
      toast.success(
        `Subscribed to ${data.tierName}! ${data.creditsIssued.toLocaleString()} credits added.`
      );
      queryClient.invalidateQueries({ queryKey: ['my-subscription'] });
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      setSubscribingTier(null);
    },
    onError: (err: any) => {
      toast.error(err.message ?? 'Subscription failed');
      setSubscribingTier(null);
    },
  });

  const handleSubscribe = async (tierId: string) => {
    if (!isAuthenticated) {
      navigate({ to: '/login', search: { redirect: '/pricing' } });
      return;
    }
    setSubscribingTier(tierId);
    subscribeMutation.mutate(tierId);
  };

  const currentTierId = (mySub as any)?.tierId;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-12 md:py-20">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl md:text-5xl font-bold mb-3 tracking-tight">Pick your plan</h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-xl mx-auto">
            Create AI-powered cinematic universes with monthly credits.
            <br />
            Upgrade anytime. Cancel anytime.
          </p>

          {/* Billing toggle */}
          <div className="flex items-center justify-center gap-3 mt-8">
            <button
              onClick={() => setBilling('monthly')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                billing === 'monthly'
                  ? 'bg-white text-black'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBilling('annual')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                billing === 'annual'
                  ? 'bg-white text-black'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              Annual
              <span className="text-[10px] font-semibold bg-primary/15 text-primary px-1.5 py-0.5 rounded-full">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Tier cards */}
        {isError ? (
          <ErrorState title="Couldn’t load plans" onRetry={() => refetchTiers()} />
        ) : isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-5">
            {(tiers ?? []).map((tier: any) => {
              const isPopular = tier.popular;
              const isCurrent = currentTierId === tier.id;
              const price = billing === 'annual' ? tier.annualPriceUsd : tier.monthlyPriceUsd;
              const originalPrice = billing === 'annual' ? tier.monthlyPriceUsd : null;
              const loarTokens =
                billing === 'annual' ? tier.annualLoarTokens : tier.monthlyLoarTokens;
              const totalLoar = billing === 'annual' ? loarTokens * 12 : loarTokens;
              const borderColor = tierBorder(!!isPopular);
              const isSubscribing = subscribingTier === tier.id;

              return (
                <div
                  key={tier.id}
                  className={`relative rounded-2xl border-2 ${borderColor} bg-zinc-900/80 backdrop-blur p-6 flex flex-col ${
                    isPopular ? 'lg:-mt-4 lg:mb-0 lg:pb-8 shadow-xl shadow-primary/10' : ''
                  }`}
                >
                  {/* Popular badge */}
                  {isPopular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="bg-primary text-primary-foreground text-[10px] font-semibold px-3 py-1 rounded-full flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
                        Most popular
                      </span>
                    </div>
                  )}

                  {/* Tier header */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full ${TIER_BADGE}`}
                      >
                        {TIER_ICONS[tier.id]}
                        {tier.name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-3 mb-1">
                      <span className="text-sm text-muted-foreground">
                        <Zap className="h-3.5 w-3.5 inline mr-1" />
                        {tier.monthlyCredits.toLocaleString()} credits/mo
                      </span>
                    </div>
                  </div>

                  {/* Price */}
                  <div className="mb-5">
                    <div className="flex items-baseline gap-2">
                      {originalPrice && (
                        <span className="text-lg text-muted-foreground/50 line-through">
                          ${originalPrice}
                        </span>
                      )}
                      <span className="text-4xl font-bold">${price}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">/month</span>
                    <div className="flex items-center gap-1.5 mt-2">
                      <Coins className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs text-primary font-medium">
                        {totalLoar.toLocaleString()} $LOAR
                        {billing === 'annual' ? '/yr' : '/mo'}
                      </span>
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="mb-6">
                    {isCurrent ? (
                      <div className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold bg-primary/10 text-primary border border-primary/30 text-center flex items-center justify-center gap-2">
                        <Check className="h-4 w-4" />
                        Current Plan
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSubscribe(tier.id)}
                        disabled={isSubscribing || subscribeMutation.isPending}
                        className={`w-full py-2.5 px-4 rounded-lg text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-50 ${tierButton(!!isPopular)}`}
                      >
                        {isSubscribing ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Confirming...
                          </>
                        ) : (
                          <>
                            <Coins className="h-3.5 w-3.5" />
                            Pay with $LOAR
                            <ArrowRight className="h-3.5 w-3.5" />
                          </>
                        )}
                      </button>
                    )}
                  </div>

                  {/* Divider */}
                  <div className="border-t border-border mb-4" />

                  {/* Feature list */}
                  <div className="space-y-2.5 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
                      What's included
                    </p>
                    {tier.featureList.map((feature: string, i: number) => (
                      <div key={i} className="flex items-start gap-2">
                        <Check
                          className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${
                            isPopular ? 'text-primary' : 'text-muted-foreground'
                          }`}
                        />
                        <span className="text-xs text-foreground/80">{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom section */}
        <div className="text-center mt-12 space-y-4">
          <p className="text-muted-foreground text-sm">
            Want to see your usage? Check your{' '}
            <button
              onClick={() => navigate({ to: '/credits' })}
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              credit balance
            </button>
            .
          </p>

          {mySub && mySub.status === 'active' && (
            <div className="inline-flex items-center gap-2 bg-muted/50 border border-border rounded-lg px-4 py-2 text-sm">
              <Check className="h-4 w-4 text-green-400" />
              <span className="text-foreground/80">
                You're on the <strong>{mySub.tier?.name}</strong> plan
                {mySub.cancelAtPeriodEnd && ' (cancels at period end)'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
