/**
 * CreditStore — Purchase generation credits with card, ETH, or $LOAR.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useChainId, useReadContract, usePublicClient } from 'wagmi';
import { useWriteContract, useSendTransaction } from '@/hooks/useThirdwebWrite';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { parseEther, parseUnits, formatUnits, type Address } from 'viem';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';
import { getEvmAddresses, isZeroAddress } from '@/configs/addresses';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

// Platform treasury address (EOA — chain-independent, safe to keep as env)
const TREASURY_ADDRESS = (import.meta.env.VITE_TREASURY_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address;

// Minimal ERC20 ABI for approve + transfer + error decoding
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'transfer',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'balanceOf',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  // OpenZeppelin ERC20 custom errors for proper error decoding
  {
    name: 'ERC20InsufficientBalance',
    type: 'error' as const,
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'balance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
  {
    name: 'ERC20InvalidSender',
    type: 'error' as const,
    inputs: [{ name: 'sender', type: 'address' }],
  },
  {
    name: 'ERC20InvalidReceiver',
    type: 'error' as const,
    inputs: [{ name: 'receiver', type: 'address' }],
  },
  {
    name: 'ERC20InsufficientAllowance',
    type: 'error' as const,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'allowance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
] as const;

// Minimal faucet ABI
const FAUCET_ABI = [
  {
    name: 'claim',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [],
    outputs: [],
  },
  {
    name: 'canClaim',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'ok', type: 'bool' },
      { name: 'availableAt', type: 'uint256' },
    ],
  },
  {
    name: 'claimAmount',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'faucetBalance',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

type PaymentTab = 'loar' | 'card' | 'crypto';

interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  fiatPriceUsd: number;
  loarPriceUsd: number;
  loarTokenAmount: number;
  loarBonusCredits: number;
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

      const amountCents = Math.round(pkg.fiatPriceUsd * 100);
      const result = await trpcClient.stripe.createPaymentIntent.mutate({
        packageId: pkg.id,
        amountCents,
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
  const [paymentTab, setPaymentTab] = useState<PaymentTab>('loar');
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const queryClient = useQueryClient();
  const { isConnected, address } = useAccount();
  const chainId = useChainId();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const addrs = getEvmAddresses(chainId);
  const ZERO = '0x0000000000000000000000000000000000000000' as const;
  const LOAR_TOKEN_ADDRESS: `0x${string}` = addrs?.loarToken ?? ZERO;
  const LOAR_FAUCET_ADDRESS: `0x${string}` = addrs?.loarFaucet ?? ZERO;

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

  const purchaseLoarMutation = useMutation({
    mutationFn: (params: {
      packageId: string;
      txHash: string;
      loarAmount: string;
      chainId?: number;
    }) => trpcClient.credits.purchaseWithLoar.mutate(params),
    onSuccess: (data) => {
      toast.success(data.savings);
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
      setIsPaying(false);
      setSelectedPkg(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Purchase failed');
      setIsPaying(false);
    },
  });

  // On-chain $LOAR token balance
  const { data: onChainLoarRaw } = useReadContract({
    address: LOAR_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !isZeroAddress(LOAR_TOKEN_ADDRESS),
      refetchInterval: 15000,
    },
  });
  const onChainLoar =
    onChainLoarRaw != null ? Number(formatUnits(onChainLoarRaw as bigint, 18)) : 0;

  const pkgs = (packages || []) as CreditPackage[];

  // ── Faucet state ───────────────────────────────────────────────────
  const hasFaucet = !isZeroAddress(LOAR_FAUCET_ADDRESS);
  const [isClaiming, setIsClaiming] = useState(false);

  const { data: canClaimData, refetch: refetchCanClaim } = useReadContract({
    address: LOAR_FAUCET_ADDRESS,
    abi: FAUCET_ABI,
    functionName: 'canClaim',
    args: address ? [address] : undefined,
    query: { enabled: hasFaucet && !!address },
  });

  const { data: claimAmountData } = useReadContract({
    address: LOAR_FAUCET_ADDRESS,
    abi: FAUCET_ABI,
    functionName: 'claimAmount',
    query: { enabled: hasFaucet },
  });

  const canClaimResult = canClaimData as [boolean, bigint] | undefined;
  const canClaimNow = canClaimResult?.[0] ?? false;
  const nextClaimAt = canClaimResult?.[1] ? Number(canClaimResult[1]) : 0;
  const faucetAmount = claimAmountData ? Number(formatUnits(claimAmountData as bigint, 18)) : 1000;

  const handleFaucetClaim = async () => {
    if (!hasFaucet) return;
    setIsClaiming(true);
    try {
      toast.info('Confirm faucet claim in your wallet...');
      await writeContractAsync({
        address: LOAR_FAUCET_ADDRESS,
        abi: FAUCET_ABI,
        functionName: 'claim',
      });
      toast.success(`Claimed ${faucetAmount.toLocaleString()} $LOAR!`);
      refetchCanClaim();
    } catch (err) {
      if (err instanceof Error && !err.message.includes('rejected')) {
        toast.error('Faucet claim failed: ' + err.message);
      }
    } finally {
      setIsClaiming(false);
    }
  };

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
          <div className="flex items-center gap-3 text-xs text-zinc-400 mt-0.5">
            <span>
              <span className="text-emerald-400 font-bold">{onChainLoar.toLocaleString()}</span>{' '}
              $LOAR
            </span>
            <span className="text-zinc-600">|</span>
            <span>
              <span className="text-amber-400 font-bold">{balance?.balance || 0}</span> credits
            </span>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} className="text-zinc-400 hover:text-white text-sm">
            Close
          </button>
        )}
      </div>

      {/* Faucet Banner (testnet only) */}
      {hasFaucet && isConnected && (
        <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-3 flex items-center justify-between gap-3">
          <div className="text-xs">
            <div className="text-emerald-400 font-medium">Testnet $LOAR Faucet</div>
            <p className="text-zinc-400 mt-0.5">
              Claim {faucetAmount.toLocaleString()} free $LOAR to try credit purchases
            </p>
            {!canClaimNow && nextClaimAt > 0 && (
              <p className="text-zinc-500 mt-0.5">
                Next claim available {new Date(nextClaimAt * 1000).toLocaleString()}
              </p>
            )}
          </div>
          <button
            disabled={isClaiming || !canClaimNow}
            onClick={handleFaucetClaim}
            className="shrink-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors"
          >
            {isClaiming ? 'Claiming...' : canClaimNow ? 'Claim $LOAR' : 'Cooldown'}
          </button>
        </div>
      )}

      {/* Payment Method Tabs */}
      <div className="flex rounded-lg bg-zinc-900 p-1 gap-1">
        <button
          onClick={() => setPaymentTab('loar')}
          className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all ${
            paymentTab === 'loar' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <span>$LOAR Token</span>
            <span className="text-[9px] bg-green-600 text-white px-1 rounded">BEST VALUE</span>
          </div>
          <div className="text-[10px] mt-0.5 opacity-80">Lower price + bonus credits</div>
        </button>
        <button
          onClick={() => setPaymentTab('card')}
          className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all ${
            paymentTab === 'card' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Credit Card
          <div className="text-[10px] mt-0.5 opacity-80">Standard price</div>
        </button>
        <button
          onClick={() => setPaymentTab('crypto')}
          className={`flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all ${
            paymentTab === 'crypto' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          ETH / Crypto
          <div className="text-[10px] mt-0.5 opacity-80">Standard price</div>
        </button>
      </div>

      {/* Savings Banner for $LOAR */}
      {paymentTab === 'loar' && (
        <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg p-3 text-xs">
          <div className="text-amber-400 font-medium">Pay with $LOAR and save</div>
          <ul className="mt-1 text-zinc-300 space-y-0.5">
            <li>Lower price than card or crypto</li>
            <li>+10% bonus credits on every purchase</li>
            <li>Support the LOAR ecosystem</li>
          </ul>
        </div>
      )}

      {/* Package Grid */}
      {isLoading ? (
        <div className="text-center text-zinc-500 py-8">Loading packages...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pkgs.map((pkg) => {
            const isLoar = paymentTab === 'loar';
            const price = isLoar ? pkg.loarPriceUsd : pkg.fiatPriceUsd;
            const bonus = isLoar ? pkg.bonusCredits + pkg.loarBonusCredits : pkg.bonusCredits;
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
                  <div className="text-xs text-green-400 mt-0.5">
                    +{bonus} bonus credits
                    {isLoar && pkg.loarBonusCredits > 0 && ' (incl. $LOAR bonus)'}
                  </div>
                )}

                <div className="mt-3 pt-2 border-t border-zinc-700/50">
                  {isLoar ? (
                    <div>
                      <span className="text-lg font-bold text-amber-400">
                        {pkg.loarTokenAmount.toLocaleString()} $LOAR
                      </span>
                      <div className="text-[10px] text-zinc-500">
                        ~${price.toFixed(2)} USD ({perCredit.toFixed(3)}/credit)
                      </div>
                      {pkg.fiatPriceUsd > price && (
                        <div className="text-[10px] text-green-400 mt-0.5">
                          Save ${(pkg.fiatPriceUsd - price).toFixed(2)} vs card
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <span className="text-lg font-bold text-white">${price.toFixed(2)}</span>
                      <div className="text-[10px] text-zinc-500">{perCredit.toFixed(3)}/credit</div>
                    </div>
                  )}
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
          ) : paymentTab === 'loar' ? (
            <div className="space-y-2">
              {/* Pay with on-chain $LOAR tokens */}
              <button
                disabled={isPaying}
                onClick={async () => {
                  const pkg = pkgs.find((p) => p.id === selectedPkg);
                  if (!pkg) return;
                  setIsPaying(true);
                  try {
                    const loarAmount = parseUnits(pkg.loarTokenAmount.toString(), 18);

                    // Pre-check: verify user has enough on-chain $LOAR
                    if (address && publicClient) {
                      const onChainBalance = (await publicClient.readContract({
                        address: LOAR_TOKEN_ADDRESS,
                        abi: ERC20_ABI,
                        functionName: 'balanceOf',
                        args: [address],
                      })) as bigint;
                      if (onChainBalance < loarAmount) {
                        const have = formatUnits(onChainBalance, 18);
                        const need = pkg.loarTokenAmount.toLocaleString();
                        toast.error(
                          `Insufficient on-chain $LOAR. You have ${Number(have).toLocaleString()} tokens but need ${need}. Use the faucet or pay with your LOAR balance above.`
                        );
                        setIsPaying(false);
                        return;
                      }
                    }

                    toast.info('Confirm $LOAR transfer in your wallet...');
                    const txHash = await writeContractAsync({
                      address: LOAR_TOKEN_ADDRESS,
                      abi: ERC20_ABI,
                      functionName: 'transfer',
                      args: [TREASURY_ADDRESS, loarAmount],
                    });
                    toast.info('$LOAR sent! Confirming credits...');
                    await purchaseLoarMutation.mutateAsync({
                      packageId: pkg.id,
                      txHash,
                      loarAmount: loarAmount.toString(),
                      chainId,
                    });
                  } catch (err) {
                    if (err instanceof Error && !err.message.includes('rejected')) {
                      const msg = err.message;
                      if (msg.includes('ERC20InsufficientBalance') || msg.includes('e450d38c')) {
                        toast.error(
                          'Insufficient on-chain $LOAR. Use the faucet or pay with your LOAR balance.'
                        );
                      } else {
                        toast.error('$LOAR payment failed: ' + msg);
                      }
                    }
                    setIsPaying(false);
                  }
                }}
                className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
              >
                {isPaying
                  ? 'Processing...'
                  : `Pay with $LOAR (${onChainLoar.toLocaleString()} available)`}
              </button>
            </div>
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

          <p className="text-center text-[10px] text-zinc-500 mt-2">
            {paymentTab === 'loar'
              ? 'Best deal! Lower price + bonus credits when you pay with $LOAR'
              : 'Switch to $LOAR for a lower price and bonus credits'}
          </p>
        </div>
      )}
    </div>
  );
}
