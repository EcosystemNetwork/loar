/**
 * LoarBalance — Compact credit balance widget for the header/navbar.
 * Shows current credit balance with a link to buy more.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { CreditStore } from './CreditStore';

export function LoarBalance() {
  const [showStore, setShowStore] = useState(false);
  const { isAuthenticated } = useWalletAuth();

  const { data: balance } = useQuery({
    queryKey: ['creditBalance'],
    queryFn: () => trpcClient.credits.getBalance.query(),
    refetchInterval: 30000,
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) return null;

  const credits = balance?.balance ?? 0;
  const isLow = credits < 10;

  return (
    <>
      <button
        onClick={() => setShowStore(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
          isLow
            ? 'bg-red-900/30 border border-red-700/50 text-red-400 hover:bg-red-900/50'
            : 'bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700'
        }`}
        title={`${credits} credits available. Click to buy more.`}
      >
        <span className="text-amber-400 font-bold">{credits}</span>
        <span className="text-zinc-500">credits</span>
        {isLow && <span className="text-[9px] text-red-400">LOW</span>}
      </button>

      {/* Credit Store Modal */}
      {showStore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-y-auto p-6 mx-4">
            <CreditStore onClose={() => setShowStore(false)} />
          </div>
        </div>
      )}
    </>
  );
}
