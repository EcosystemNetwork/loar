/**
 * SubscribeDialog — Subscribe to a universe with tier selection.
 *
 * Shows available tiers, benefits, and handles on-chain + off-chain subscription.
 */
import { useState } from 'react';
import { useWaitForTransactionReceipt } from 'wagmi';
import { useSendTransaction } from '@/hooks/useCircleWrite';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { parseEther } from 'viem';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Crown,
  Star,
  Sparkles,
  Loader2,
  X,
  CheckCircle2,
  Clock,
  Zap,
  Eye,
  Vote,
  Gift,
  Film,
} from 'lucide-react';

interface SubscribeDialogProps {
  universeId: string;
  universeName?: string;
  onClose: () => void;
}

const TIER_CONFIG: Record<string, { icon: typeof Star; color: string; gradient: string }> = {
  BASIC: { icon: Star, color: 'text-blue-500', gradient: 'from-blue-500/10 to-blue-600/5' },
  PREMIUM: {
    icon: Crown,
    color: 'text-purple-500',
    gradient: 'from-purple-500/10 to-purple-600/5',
  },
  VIP: { icon: Sparkles, color: 'text-amber-500', gradient: 'from-amber-500/10 to-amber-600/5' },
};

const BENEFIT_ICONS: Record<string, typeof Eye> = {
  earlyAccess: Eye,
  votingBoost: Vote,
  premiumContent: Film,
  behindTheScenes: Zap,
  creditBonus: Gift,
};

export function SubscribeDialog({ universeId, universeName, onClose }: SubscribeDialogProps) {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [months, setMonths] = useState(1);
  const { sendTransactionAsync, data: txHash } = useSendTransaction();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });
  const [isSubscribing, setIsSubscribing] = useState(false);

  const { data: tiers, isLoading } = useQuery({
    queryKey: ['subscription-tiers', universeId],
    queryFn: () => trpcClient.subscriptions.getTiers.query({ universeId }),
  });

  const { data: currentSub } = useQuery({
    queryKey: ['my-sub', universeId],
    queryFn: () =>
      trpcClient.subscriptions.hasAccess.query({
        universeId,
        uid: address ?? '',
        minTier: 'BASIC',
      }),
    enabled: !!address,
  });

  const subscribeMutation = useMutation({
    mutationFn: (data: {
      universeId: string;
      tier: string;
      months: number;
      txHash: string;
      amount: string;
    }) => trpcClient.subscriptions.subscribe.mutate(data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-sub', universeId] });
      toast.success('Subscribed successfully!');
    },
  });

  const handleSubscribe = async () => {
    if (!selectedTier || !address) return;

    const tier = (tiers as any[])?.find((t: any) => t.tier === selectedTier);
    if (!tier) return;

    setIsSubscribing(true);
    try {
      const totalPrice = (tier.pricePerMonth || 0) * months;

      let txHashResult = 'free';
      let amountWei = '0';
      if (totalPrice > 0) {
        amountWei = parseEther(String(totalPrice)).toString();
        const hash = await sendTransactionAsync({
          to: (tier.treasuryAddress ||
            '0x0000000000000000000000000000000000000000') as `0x${string}`,
          value: parseEther(String(totalPrice)),
        });
        txHashResult = hash;
      }

      await subscribeMutation.mutateAsync({
        universeId,
        tier: selectedTier,
        months,
        txHash: txHashResult,
        amount: amountWei,
      });

      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? 'Subscription failed');
    } finally {
      setIsSubscribing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 w-full max-w-lg p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Subscribe</h2>
            {universeName && <p className="text-sm text-zinc-400">{universeName}</p>}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        ) : !tiers || (tiers as any[]).length === 0 ? (
          <p className="text-center text-zinc-500 py-8">
            No subscription tiers configured for this universe yet.
          </p>
        ) : (
          <div className="space-y-3">
            {(tiers as any[]).map((tier: any) => {
              const config = TIER_CONFIG[tier.tier] || TIER_CONFIG.BASIC;
              const Icon = config.icon;
              const isSelected = selectedTier === tier.tier;
              const benefits = [
                'earlyAccess',
                'votingBoost',
                'premiumContent',
                'behindTheScenes',
                'creditBonus',
              ].filter((b) => tier[b]);

              return (
                <button
                  key={tier.tier}
                  onClick={() => setSelectedTier(tier.tier)}
                  className={`w-full p-4 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-zinc-800 hover:border-zinc-700 bg-gradient-to-r ' + config.gradient
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Icon className={`w-5 h-5 ${config.color}`} />
                      <span className="font-bold text-white">{tier.tier}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {tier.pricePerMonth > 0 ? `${tier.pricePerMonth} ETH/mo` : 'Free'}
                    </Badge>
                  </div>
                  {benefits.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {benefits.map((b) => {
                        const BIcon = BENEFIT_ICONS[b] || CheckCircle2;
                        return (
                          <Badge key={b} variant="secondary" className="text-[10px]">
                            <BIcon className="w-2.5 h-2.5 mr-1" />
                            {b.replace(/([A-Z])/g, ' $1').trim()}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </button>
              );
            })}

            {selectedTier && (
              <div className="pt-3 border-t border-zinc-800 space-y-3">
                <div className="flex items-center gap-3">
                  <Label className="text-zinc-400 text-sm">Duration</Label>
                  <div className="flex gap-2">
                    {[1, 3, 6, 12].map((m) => (
                      <Button
                        key={m}
                        size="sm"
                        variant={months === m ? 'default' : 'outline'}
                        onClick={() => setMonths(m)}
                        className="h-8 text-xs"
                      >
                        {m}mo
                      </Button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={handleSubscribe}
                  disabled={isSubscribing}
                  className="w-full h-11 font-bold"
                >
                  {isSubscribing ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                  )}
                  {isSubscribing ? 'Subscribing...' : 'Subscribe'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
