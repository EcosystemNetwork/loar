/**
 * LoarBalance — Compact balance widget for the header/navbar. Shows the
 * credit balance (and, in web3 mode, the on-chain $LOAR token balance);
 * clicking it opens /credits. Vocabulary: Credits = usage balance,
 * Points = leaderboard activity score, $LOAR = token. Generation is BYOK, so
 * credits are not purchasable — the CreditStore modal is kept only for the QA/admin
 * `OPEN_CREDIT_STORE` event, never the user-facing click.
 */
import { lazy, Suspense, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useReadContract } from 'wagmi';
import { formatUnits } from 'viem';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import { useWeb3Mode } from '@/lib/web3-mode';
import { getEvmAddresses } from '@/configs/addresses';
import { SUPPORTED_EVM_CHAIN_IDS } from '@/configs/chains';
import { QA_EVENTS } from '@/lib/qa-events';

// Stripe + the store UI only matter once the modal opens — keep them out of the
// entry chunk (the header renders this component on every page).
const CreditStore = lazy(() => import('./CreditStore').then((m) => ({ default: m.CreditStore })));

// Only balanceOf is needed here. Importing the full generated ABI module would
// pull every contract ABI (~185KB) into the entry chunk via the header.
const loarTokenAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

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
  const navigate = useNavigate();
  const { isAuthenticated } = useWalletAuth();
  const { web3Mode } = useWeb3Mode();
  const tokenBalance = useLoarTokenBalance();

  const { data: balance } = useQuery({
    queryKey: ['credit-balance'],
    queryFn: () => trpcClient.credits.getBalance.query(),
    refetchInterval: 30000,
    enabled: isAuthenticated,
  });

  const credits = balance?.balance ?? 0;

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

  useEffect(() => {
    const open = () => setShowStore(true);
    window.addEventListener(QA_EVENTS.OPEN_CREDIT_STORE, open);
    return () => window.removeEventListener(QA_EVENTS.OPEN_CREDIT_STORE, open);
  }, []);

  if (!isAuthenticated) return null;

  return (
    <>
      <button
        onClick={() => navigate({ to: '/credits' })}
        aria-label={
          web3Mode
            ? `${tokenBalance ?? '—'} $LOAR, ${credits} credits. View credit history.`
            : `${credits} credits. View credit history.`
        }
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-full text-xs font-medium border border-border/60 bg-muted/40 text-foreground/80 hover:bg-muted transition-colors"
      >
        {web3Mode && (
          <>
            <span className="font-semibold tabular-nums text-foreground">
              {tokenBalance ?? '0'}
            </span>
            <span className="text-muted-foreground">$LOAR</span>
            <span className="text-border mx-0.5">|</span>
          </>
        )}
        <span className="font-semibold tabular-nums text-primary">{credits.toLocaleString()}</span>
        <span className="text-muted-foreground">credits</span>
      </button>

      {showStore &&
        createPortal(
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Credits"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowStore(false);
            }}
          >
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] overflow-y-auto p-6 mx-4">
              <Suspense fallback={null}>
                <CreditStore onClose={() => setShowStore(false)} />
              </Suspense>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
