/**
 * LoarBalance — Compact credit balance widget for the header/navbar.
 * Shows on-chain $LOAR token balance and off-chain credit balance.
 */
import { useState, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { getEvmAddresses } from '@/configs/addresses';
import { SUPPORTED_EVM_CHAIN_IDS } from '@/configs/chains';
import { loarTokenAbi } from '@loar/abis/generated';
import { CreditStore } from './CreditStore';

function useLoarTokenBalance() {
  const { address, chainId } = useWalletAccount();
  const activeChainId = chainId ?? SUPPORTED_EVM_CHAIN_IDS[0];
  const addresses = getEvmAddresses(activeChainId);

  const { data: rawBalance } = useReadContract({
    address: addresses?.loarToken,
    abi: loarTokenAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address && !!addresses?.loarToken,
      refetchInterval: 15000,
    },
  });

  if (rawBalance == null) return null;
  const formatted = Number(formatUnits(rawBalance as bigint, 18));
  if (formatted >= 1_000_000) return `${(formatted / 1_000_000).toFixed(1)}M`;
  if (formatted >= 1_000) return `${(formatted / 1_000).toFixed(1)}K`;
  return formatted.toFixed(formatted < 1 ? 4 : 2);
}

export function LoarBalance() {
  const [showStore, setShowStore] = useState(false);
  const { isAuthenticated } = useWalletAuth();
  const tokenBalance = useLoarTokenBalance();

  const { data: balance } = useQuery({
    queryKey: ['credit-balance'],
    queryFn: () => trpcClient.credits.getBalance.query(),
    refetchInterval: 30000,
    enabled: isAuthenticated,
  });

  const credits = balance?.balance ?? 0;
  const isLow = credits < 10;

  // Close modal on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showStore) {
        setShowStore(false);
      }
    },
    [showStore]
  );

  useEffect(() => {
    if (showStore) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [showStore, handleKeyDown]);

  if (!isAuthenticated) return null;

  return (
    <>
      <button
        onClick={() => setShowStore(true)}
        aria-label={`${tokenBalance ?? '—'} $LOAR tokens, ${credits} credits. Click to buy more.`}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
          isLow
            ? 'bg-red-900/30 border border-red-700/50 text-red-400 hover:bg-red-900/50'
            : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'
        }`}
      >
        <span className="text-emerald-400 font-bold">{tokenBalance ?? '0'}</span>
        <span className="text-zinc-500">$LOAR</span>
        <span className="text-zinc-600 mx-0.5">|</span>
        <span className="text-amber-400 font-bold">{credits}</span>
        <span className="text-zinc-500">credits</span>
        {isLow && <span className="text-[9px] text-red-400">LOW</span>}
      </button>

      {/* Credit Store Modal */}
      {showStore && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Credit Store"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowStore(false);
          }}
        >
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-y-auto p-6 mx-4">
            <CreditStore onClose={() => setShowStore(false)} />
          </div>
        </div>
      )}
    </>
  );
}
