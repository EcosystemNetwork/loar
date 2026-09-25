/**
 * Creator earnings — unclaimed LP fees held in the LoarFeeLocker for a creator,
 * across every token they launched. Fees accrue in two assets per token: the
 * token itself and the paired quote token (WETH), so we read `availableFees` for
 * each unique asset and offer a claim per non-zero one. Anyone can *see* a
 * creator's balance; only the recipient wallet gets Claim buttons.
 */
import { useMemo } from 'react';
import { useChainId, useReadContracts } from 'wagmi';
import { formatEther, type Address } from 'viem';
import { Coins, Loader2 } from 'lucide-react';
import { loarFeeLockerAbi } from '@loar/abis/generated';
import { LoarFeeLocker } from '@loar/abis/addresses';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useClaimFees } from '@/hooks/useLPYield';
import { useWalletAccount } from '@/hooks/useWalletAccount';
import type { EnrichedToken } from '@/hooks/useTokens';
import { feeAssets } from '@/lib/fee-assets';

export function CreatorEarnings({
  creatorAddress,
  tokens,
}: {
  creatorAddress: string;
  tokens: EnrichedToken[];
}) {
  const chainId = useChainId();
  const { address: me } = useWalletAccount();
  const { claimFees, isPending } = useClaimFees();
  const locker = LoarFeeLocker[String(chainId) as keyof typeof LoarFeeLocker] as
    | Address
    | undefined;
  const isOwner = !!me && me.toLowerCase() === creatorAddress.toLowerCase();

  const rows = useMemo(() => feeAssets(tokens), [tokens]);
  const { data, isLoading, refetch } = useReadContracts({
    contracts: rows.map((r) => ({
      address: locker,
      abi: loarFeeLockerAbi,
      functionName: 'availableFees' as const,
      args: [creatorAddress as Address, r.asset] as const,
      chainId,
    })),
    query: { enabled: !!locker && rows.length > 0, refetchInterval: 30_000 },
  });

  if (!locker || rows.length === 0) return null;

  const balances = rows
    .map((r, i) => ({ ...r, amount: (data?.[i]?.result as bigint | undefined) ?? 0n }))
    .filter((r) => r.amount > 0n);
  const claim = async (asset: Address) => {
    try {
      await claimFees(asset);
      refetch();
    } catch {
      /* surfaced by the wallet / hook error state */
    }
  };

  return (
    <Card className="mb-4">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center gap-2">
          <Coins className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Creator earnings</h3>
          <span className="text-[10px] text-muted-foreground">unclaimed trading fees</span>
        </div>
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : balances.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing to claim yet.</p>
        ) : (
          <ul className="divide-y">
            {balances.map((b) => (
              <li key={b.asset} className="flex items-center justify-between py-2">
                <span className="text-xs text-muted-foreground">{b.label}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-sm tabular-nums">
                    {Number(formatEther(b.amount)).toFixed(6)}
                  </span>
                  {isOwner && (
                    <Button size="sm" disabled={isPending} onClick={() => claim(b.asset)}>
                      Claim
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
