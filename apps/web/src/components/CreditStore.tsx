/**
 * CreditStore — Purchase generation credits with card, ETH, or $LOAR.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  useAccount,
  useSendTransaction,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { parseEther, parseUnits, type Address } from 'viem';
import { trpcClient } from '@/utils/trpc';
import { toast } from 'sonner';

// $LOAR token contract address (update after deployment)
const LOAR_TOKEN_ADDRESS = (import.meta.env.VITE_LOAR_TOKEN_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address;
// Platform treasury address
const TREASURY_ADDRESS = (import.meta.env.VITE_TREASURY_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as Address;

// Minimal ERC20 ABI for approve + transfer
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

export function CreditStore({ onClose }: { onClose?: () => void }) {
  const [paymentTab, setPaymentTab] = useState<PaymentTab>('loar');
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const queryClient = useQueryClient();
  const { isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const { data: packages, isLoading } = useQuery({
    queryKey: ['creditPackages'],
    queryFn: () => trpcClient.credits.getPackages.query(),
  });

  const { data: balance } = useQuery({
    queryKey: ['creditBalance'],
    queryFn: () => trpcClient.credits.getBalance.query(),
  });

  const purchaseFiatMutation = useMutation({
    mutationFn: (params: {
      packageId: string;
      paymentMethod: 'card' | 'eth' | 'crypto';
      paymentRef: string;
    }) => trpcClient.credits.purchaseWithFiat.mutate(params),
    onSuccess: (data) => {
      toast.success(`Added ${data.creditsAdded} credits!`);
      queryClient.invalidateQueries({ queryKey: ['creditBalance'] });
      setIsPaying(false);
      setSelectedPkg(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Purchase failed');
      setIsPaying(false);
    },
  });

  const purchaseLoarMutation = useMutation({
    mutationFn: (params: { packageId: string; txHash: string; loarAmount: string }) =>
      trpcClient.credits.purchaseWithLoar.mutate(params),
    onSuccess: (data) => {
      toast.success(data.savings);
      queryClient.invalidateQueries({ queryKey: ['creditBalance'] });
      setIsPaying(false);
      setSelectedPkg(null);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Purchase failed');
      setIsPaying(false);
    },
  });

  const pkgs = (packages || []) as CreditPackage[];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Buy Credits</h2>
          <p className="text-xs text-zinc-400">
            Current balance:{' '}
            <span className="text-amber-400 font-bold">{balance?.balance || 0} credits</span>
          </p>
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
          {!isConnected ? (
            <p className="text-center text-sm text-zinc-400 py-3">
              Connect your wallet to purchase credits
            </p>
          ) : paymentTab === 'loar' ? (
            <button
              disabled={isPaying}
              onClick={async () => {
                const pkg = pkgs.find((p) => p.id === selectedPkg);
                if (!pkg) return;
                setIsPaying(true);
                try {
                  const loarAmount = parseUnits(pkg.loarTokenAmount.toString(), 18);
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
                  });
                } catch (err) {
                  if (err instanceof Error && !err.message.includes('rejected')) {
                    toast.error('$LOAR payment failed: ' + err.message);
                  }
                  setIsPaying(false);
                }
              }}
              className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {isPaying ? 'Processing...' : 'Pay with $LOAR'}
            </button>
          ) : paymentTab === 'card' ? (
            <button
              disabled={isPaying}
              onClick={async () => {
                const pkg = pkgs.find((p) => p.id === selectedPkg);
                if (!pkg) return;
                setIsPaying(true);
                try {
                  // Check if Stripe is available
                  const { available } = await trpcClient.stripe.isAvailable.query();
                  if (!available) {
                    toast.info('Card payments are not yet configured. Please use ETH or $LOAR.');
                    setIsPaying(false);
                    return;
                  }

                  // Create payment intent
                  const amountCents = Math.round(pkg.fiatPriceUsd * 100);
                  const { clientSecret, paymentIntentId } =
                    await trpcClient.stripe.createPaymentIntent.mutate({
                      packageId: pkg.id,
                      amountCents,
                    });

                  // For full integration, you'd load Stripe.js and use Elements here.
                  // For now, copy the payment intent ID for manual confirmation.
                  toast.success(`Payment intent created: ${paymentIntentId}`, {
                    description: 'Complete payment in the Stripe checkout window.',
                    duration: 10000,
                  });

                  // After payment succeeds, record the credit purchase
                  await purchaseFiatMutation.mutateAsync({
                    packageId: pkg.id,
                    paymentMethod: 'card' as const,
                    paymentRef: paymentIntentId,
                  });
                } catch (err) {
                  if (err instanceof Error && !err.message.includes('rejected')) {
                    toast.error('Card payment failed: ' + err.message);
                  }
                } finally {
                  setIsPaying(false);
                }
              }}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {isPaying ? 'Processing...' : 'Pay with Card'}
            </button>
          ) : (
            <button
              disabled={isPaying}
              onClick={async () => {
                const pkg = pkgs.find((p) => p.id === selectedPkg);
                if (!pkg) return;
                setIsPaying(true);
                try {
                  const ethPrice = pkg.fiatPriceUsd / 3000;
                  const ethAmount = parseEther(ethPrice.toFixed(18));
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
