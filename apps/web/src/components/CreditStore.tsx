/**
 * CreditStore — Purchase generation credits with card or ETH.
 *
 * $LOAR token payments are disabled for the alpha launch.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useChainId, usePublicClient } from 'wagmi';
import { useSendTransaction } from '@/hooks/useThirdwebWrite';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { parseEther, formatUnits, type Address } from 'viem';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

// Platform treasury address (EOA — chain-independent, safe to keep as env)
const TREASURY_ADDRESS = (import.meta.env.VITE_TREASURY_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address;

type PaymentTab = 'card' | 'crypto';

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  fiatPriceUsd: number;
  popular: boolean;
}

/* ------------------------------------------------------------------ */
/*  Stripe checkout form — rendered inside <Elements> provider        */
/* ------------------------------------------------------------------ */
function StripeCheckoutForm({
  packageId,
  paymentIntentId,
  onSuccess,
  onCancel,
}: {
  packageId: string;
  paymentIntentId: string;
  onSuccess: (paymentIntentId: string) => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href,
      },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMsg(error.message ?? 'Payment failed');
      setIsSubmitting(false);
    } else {
      onSuccess(paymentIntentId);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: 'tabs',
        }}
      />
      {errorMsg && <p className="text-xs text-red-400">{errorMsg}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={!stripe || isSubmitting}
          className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          {isSubmitting ? 'Processing...' : 'Pay'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-4 py-3 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Card payment section — handles intent creation + Elements mount   */
/* ------------------------------------------------------------------ */
function CardPaymentSection({
  pkg,
  onSuccess,
}: {
  pkg: CreditPackage;
  onSuccess: (paymentIntentId: string) => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const startCardPayment = async () => {
    setIsCreating(true);
    try {
      const { available } = await trpcClient.stripe.isAvailable.query();
      if (!available) {
        toast.info('Card payments are not yet configured. Please use ETH or $LOAR.');
        setIsCreating(false);
        return;
      }

      if (!stripePromise) {
        toast.error(
          'Stripe is not configured. Add VITE_STRIPE_PUBLISHABLE_KEY to your environment.'
        );
        setIsCreating(false);
        return;
      }

      const result = await trpcClient.stripe.createPaymentIntent.mutate({
        packageId: pkg.id,
      });

      setClientSecret(result.clientSecret);
      setPaymentIntentId(result.paymentIntentId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start card payment');
    } finally {
      setIsCreating(false);
    }
  };

  // If we have a clientSecret, show the Stripe Elements form
  if (clientSecret && paymentIntentId && stripePromise) {
    return (
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret,
          appearance: {
            theme: 'night',
            variables: {
              colorPrimary: '#3b82f6',
              colorBackground: '#18181b',
              colorText: '#e4e4e7',
              colorDanger: '#ef4444',
              borderRadius: '8px',
            },
          },
        }}
      >
        <StripeCheckoutForm
          packageId={pkg.id}
          paymentIntentId={paymentIntentId}
          onSuccess={onSuccess}
          onCancel={() => {
            setClientSecret(null);
            setPaymentIntentId(null);
          }}
        />
      </Elements>
    );
  }

  // Otherwise show the "Pay with Card" button
  return (
    <button
      disabled={isCreating}
      onClick={startCardPayment}
      className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
    >
      {isCreating ? 'Setting up...' : 'Pay with Card'}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Main CreditStore component                                        */
/* ------------------------------------------------------------------ */
export function CreditStore({ onClose }: { onClose?: () => void }) {
  const [paymentTab, setPaymentTab] = useState<PaymentTab>('card');
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const queryClient = useQueryClient();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { sendTransactionAsync } = useSendTransaction();
  const publicClient = usePublicClient();

  const { data: ethPriceData } = useQuery({
    queryKey: ['ethPrice'],
    queryFn: () => trpcClient.credits.getEthPrice.query(),
    staleTime: 5 * 60 * 1000,
  });
  const ethPriceUsd = ethPriceData?.ethPriceUsd ?? 3000;

  const { data: packages, isLoading } = useQuery({
    queryKey: ['creditPackages'],
    queryFn: () => trpcClient.credits.getPackages.query(),
  });

  const { data: balance } = useQuery({
    queryKey: ['credit-balance'],
    queryFn: () => trpcClient.credits.getBalance.query(),
  });

  const purchaseFiatMutation = useMutation({
    mutationFn: (params: {
      packageId: string;
      paymentMethod: 'card' | 'eth' | 'crypto';
      paymentRef: string;
      chainId?: number;
    }) => trpcClient.credits.purchaseWithFiat.mutate(params),
    onSuccess: (data) => {
      toast.success(`Added ${data.creditsAdded} credits!`);
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      setIsPaying(false);
      setSelectedPkg(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Purchase failed');
      setIsPaying(false);
    },
  });

  const pkgs = (packages || []) as CreditPackage[];

  const handleCardSuccess = async (paymentIntentId: string) => {
    const pkg = pkgs.find((p) => p.id === selectedPkg);
    if (!pkg) return;
    toast.info('Payment confirmed! Issuing credits...');
    await purchaseFiatMutation.mutateAsync({
      packageId: pkg.id,
      paymentMethod: 'card' as const,
      paymentRef: paymentIntentId,
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Buy Credits</h2>
          <div className="text-xs text-zinc-400 mt-0.5">
            <span className="text-amber-400 font-bold">{balance?.balance || 0}</span> credits
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-sm">
            Close
          </button>
        )}
      </div>

      {/* Payment Method Tabs */}
      <div className="flex rounded-lg bg-zinc-900 p-1 gap-1">
        <button
          onClick={() => setPaymentTab('card')}
          className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all ${
            paymentTab === 'card' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Credit Card
        </button>
        <button
          onClick={() => setPaymentTab('crypto')}
          className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all ${
            paymentTab === 'crypto' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          ETH / Crypto
        </button>
      </div>

      {/* Package Grid */}
      {isLoading ? (
        <div className="text-center text-zinc-500 py-8">Loading packages...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pkgs.map((pkg) => {
            const price = pkg.fiatPriceUsd;
            const bonus = pkg.bonusCredits;
            const total = pkg.credits + bonus;
            const perCredit = Math.round((price / total) * 1000) / 1000;
            const isSelected = selectedPkg === pkg.id;

            return (
              <button
                key={pkg.id}
                onClick={() => setSelectedPkg(pkg.id)}
                className={`text-left p-4 rounded-lg border transition-all relative ${
                  isSelected
                    ? 'border-amber-500 bg-amber-500/10 ring-1 ring-amber-500/30'
                    : 'border-zinc-700 bg-zinc-800/50 hover:border-zinc-500'
                }`}
              >
                {pkg.popular && (
                  <span className="absolute -top-2 right-3 text-[9px] bg-amber-600 text-white px-2 py-0.5 rounded-full font-bold">
                    POPULAR
                  </span>
                )}

                <div className="text-sm font-bold text-white">{pkg.name}</div>
                <div className="text-2xl font-bold text-white mt-1">
                  {pkg.credits.toLocaleString()}
                  <span className="text-xs font-normal text-zinc-400 ml-1">credits</span>
                </div>

                {bonus > 0 && (
                  <div className="text-xs text-green-400 mt-0.5">+{bonus} bonus credits</div>
                )}

                <div className="mt-3 pt-2 border-t border-zinc-700/50">
                  <span className="text-lg font-bold text-white">${price.toFixed(2)}</span>
                  <div className="text-[10px] text-zinc-500">{perCredit.toFixed(3)}/credit</div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Purchase Button */}
      {selectedPkg && (
        <div className="pt-2">
          {!isConnected && paymentTab !== 'card' ? (
            <p className="text-center text-sm text-zinc-400 py-3">
              Connect your wallet to purchase credits
            </p>
          ) : paymentTab === 'card' ? (
            (() => {
              const pkg = pkgs.find((p) => p.id === selectedPkg);
              if (!pkg) return null;
              return <CardPaymentSection key={pkg.id} pkg={pkg} onSuccess={handleCardSuccess} />;
            })()
          ) : (
            <button
              disabled={isPaying}
              onClick={async () => {
                const pkg = pkgs.find((p) => p.id === selectedPkg);
                if (!pkg) return;
                setIsPaying(true);
                try {
                  const ethPrice = pkg.fiatPriceUsd / ethPriceUsd;
                  const ethAmount = parseEther(ethPrice.toFixed(18));

                  // Pre-check: verify user has enough ETH
                  if (address && publicClient) {
                    const ethBalance = await publicClient.getBalance({ address });
                    if (ethBalance < ethAmount) {
                      const have = formatUnits(ethBalance, 18);
                      const need = ethPrice.toFixed(6);
                      toast.error(
                        `Insufficient ETH balance. You have ${Number(have).toFixed(6)} ETH but need ~${need} ETH.`
                      );
                      setIsPaying(false);
                      return;
                    }
                  }

                  toast.info('Confirm ETH transfer in your wallet...');
                  const txHash = await sendTransactionAsync({
                    to: TREASURY_ADDRESS,
                    value: ethAmount,
                  });
                  toast.info('ETH sent! Confirming credits...');
                  await purchaseFiatMutation.mutateAsync({
                    packageId: pkg.id,
                    paymentMethod: 'eth',
                    paymentRef: txHash,
                    chainId,
                  });
                } catch (err) {
                  if (err instanceof Error && !err.message.includes('rejected')) {
                    toast.error('ETH payment failed: ' + err.message);
                  }
                  setIsPaying(false);
                }
              }}
              className="w-full py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {isPaying ? 'Processing...' : 'Pay with ETH'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
