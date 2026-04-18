import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Coins } from 'lucide-react';
import { useFundPool } from '@/hooks/useTreasury';
import { useChainId } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';

const PAYMENT_METHODS = [
  { value: 'card' as const, label: 'Card' },
  { value: 'eth' as const, label: 'ETH' },
  { value: 'loar' as const, label: '$LOAR' },
] as const;

interface FundPoolDialogProps {
  universeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FundPoolDialog({ universeId, open, onOpenChange }: FundPoolDialogProps) {
  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'eth' | 'crypto' | 'loar'>('card');
  const [paymentRef, setPaymentRef] = useState('');
  const [loarAmount, setLoarAmount] = useState('');
  const fundPool = useFundPool();
  const chainId = useChainId();

  const { data: packages, isLoading: packagesLoading } = useQuery({
    queryKey: ['pool-packages'],
    queryFn: () => trpcClient.universeTreasury.getPoolPackages.query(),
    enabled: open,
  });

  const pkgs = packages ?? [];
  const activePkg = selectedPkg ?? pkgs[1]?.id ?? pkgs[0]?.id;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentRef.trim() || !activePkg) return;

    await fundPool.mutateAsync({
      universeId,
      packageId: activePkg,
      paymentMethod,
      paymentRef: paymentRef.trim(),
      ...(paymentMethod === 'loar' ? { loarAmount } : {}),
      ...(paymentMethod !== 'card' ? { chainId } : {}),
    });
    onOpenChange(false);
    setPaymentRef('');
    setLoarAmount('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-emerald-400" />
            Fund Universe Pool
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Package Selection */}
          <div className="space-y-2">
            <Label className="text-zinc-300">Credit Package</Label>
            {packagesLoading ? (
              <div className="grid grid-cols-2 gap-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-20 bg-zinc-900 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {pkgs.map((pkg) => {
                  const isLoar = paymentMethod === 'loar';
                  const price = isLoar ? pkg.loarPriceUsd : pkg.fiatPriceUsd;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => setSelectedPkg(pkg.id)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        activePkg === pkg.id
                          ? 'border-emerald-500 bg-emerald-950/30'
                          : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                      }`}
                    >
                      <div className="text-sm font-semibold">{pkg.name}</div>
                      <div className="text-xs text-zinc-400">
                        {pkg.credits.toLocaleString()} credits
                      </div>
                      <div className="text-xs text-emerald-400 mt-1">
                        {isLoar
                          ? `${pkg.loarTokenAmount.toLocaleString()} $LOAR`
                          : `$${price.toFixed(2)}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Payment Method */}
          <div className="space-y-2">
            <Label className="text-zinc-300">Payment Method</Label>
            <div className="flex gap-2">
              {PAYMENT_METHODS.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setPaymentMethod(m.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    paymentMethod === m.value
                      ? 'bg-violet-600 text-white'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Payment Reference */}
          <div className="space-y-2">
            <Label className="text-zinc-300">
              {paymentMethod === 'card' ? 'Payment Intent ID' : 'Transaction Hash'}
            </Label>
            <Input
              value={paymentRef}
              onChange={(e) => setPaymentRef(e.target.value)}
              placeholder={paymentMethod === 'card' ? 'pi_...' : '0x...'}
              className="bg-zinc-900 border-zinc-700 text-white"
              required
            />
          </div>

          {/* LOAR Amount (conditional) */}
          {paymentMethod === 'loar' && (
            <div className="space-y-2">
              <Label className="text-zinc-300">$LOAR Amount (wei)</Label>
              <Input
                value={loarAmount}
                onChange={(e) => setLoarAmount(e.target.value)}
                placeholder="1000000000000000000"
                className="bg-zinc-900 border-zinc-700 text-white"
              />
            </div>
          )}

          {/* Submit */}
          <Button
            type="submit"
            disabled={fundPool.isPending || !paymentRef.trim() || packagesLoading}
            className="w-full bg-emerald-600 hover:bg-emerald-700"
          >
            {fundPool.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Funding...
              </>
            ) : (
              <>
                Fund Pool
                {activePkg && pkgs.length > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {pkgs.find((p) => p.id === activePkg)?.credits.toLocaleString()} credits
                  </Badge>
                )}
              </>
            )}
          </Button>

          {fundPool.isError && (
            <p className="text-sm text-red-400">{(fundPool.error as Error).message}</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
