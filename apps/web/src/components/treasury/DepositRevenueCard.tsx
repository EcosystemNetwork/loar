import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Banknote, ArrowRight } from 'lucide-react';
import { useDepositRevenue } from '@/hooks/useTreasury';

const REVENUE_SOURCES = [
  'nft_sales',
  'marketplace',
  'subscriptions',
  'licensing',
  'merch',
  'ads',
  'collabs',
  'canon_royalties',
  'remix_fees',
  'other',
] as const;

interface DepositRevenueCardProps {
  universeId: string;
  creditSharePct?: number;
}

export function DepositRevenueCard({ universeId, creditSharePct = 70 }: DepositRevenueCardProps) {
  const [amountEth, setAmountEth] = useState('');
  const [txHash, setTxHash] = useState('');
  const [source, setSource] = useState<(typeof REVENUE_SOURCES)[number]>('nft_sales');
  const deposit = useDepositRevenue();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amountEth || !txHash.trim()) return;

    await deposit.mutateAsync({
      universeId,
      amountEth,
      txHash: txHash.trim(),
      source,
      creditSharePct,
    });
    setAmountEth('');
    setTxHash('');
  };

  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
          <Banknote className="h-4 w-4 text-amber-400" />
          Deposit On-Chain Revenue
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-zinc-500 mb-4">
          Bridge on-chain ETH revenue into universe credits. The split is {creditSharePct}% credits
          / {100 - creditSharePct}% staker rewards.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label className="text-zinc-400">ETH Amount</Label>
            <Input
              type="text"
              value={amountEth}
              onChange={(e) => setAmountEth(e.target.value)}
              placeholder="0.1"
              className="bg-zinc-900 border-zinc-700 text-white"
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-400">Transaction Hash</Label>
            <Input
              value={txHash}
              onChange={(e) => setTxHash(e.target.value)}
              placeholder="0x..."
              className="bg-zinc-900 border-zinc-700 text-white"
              required
            />
          </div>

          <div className="space-y-2">
            <Label className="text-zinc-400">Revenue Source</Label>
            <div className="flex flex-wrap gap-2">
              {REVENUE_SOURCES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    source === s
                      ? 'bg-amber-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {s.replace(/_/g, ' ')}
                </button>
              ))}
            </div>
          </div>

          {amountEth && (
            <div className="bg-zinc-800/50 rounded-lg p-3 flex items-center justify-between text-xs">
              <div className="text-zinc-400">
                <div>
                  Credits: ~
                  {Math.floor(
                    parseFloat(amountEth || '0') * 100000 * (creditSharePct / 100)
                  ).toLocaleString()}
                </div>
                <div>
                  Staker rewards: ~
                  {Math.floor(
                    parseFloat(amountEth || '0') * 100000 * ((100 - creditSharePct) / 100)
                  ).toLocaleString()}
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-zinc-500" />
              <Badge variant="outline" className="border-emerald-700 text-emerald-400">
                {amountEth} ETH
              </Badge>
            </div>
          )}

          <Button
            type="submit"
            disabled={deposit.isPending || !amountEth || !txHash.trim()}
            className="w-full bg-amber-600 hover:bg-amber-700"
          >
            {deposit.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Depositing...
              </>
            ) : (
              'Deposit Revenue'
            )}
          </Button>

          {deposit.isError && (
            <p className="text-sm text-red-400">{(deposit.error as Error).message}</p>
          )}
          {deposit.isSuccess && (
            <p className="text-sm text-emerald-400">
              Revenue deposited! {(deposit.data as any)?.creditsPortion?.toLocaleString()} credits
              added to pool.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
