import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Coins } from 'lucide-react';
import { useFundPool } from '@/hooks/useTreasury';
import { useChainId } from 'wagmi';

const PACKAGES = [
  { id: 'starter', name: 'Starter', credits: 500, price: '$4.00' },
  { id: 'pro', name: 'Pro', credits: 2000, price: '$12.00' },
  { id: 'studio', name: 'Studio', credits: 10000, price: '$48.00' },
  { id: 'enterprise', name: 'Enterprise', credits: 50000, price: '$200.00' },
];

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
  const [selectedPkg, setSelectedPkg] = useState(PACKAGES[1].id);
  const [paymentMethod, setPaymentMethod] = useState<'card' | 'eth' | 'crypto' | 'loar'>('card');
  const [paymentRef, setPaymentRef] = useState('');
  const [loarAmount, setLoarAmount] = useState('');
  const fundPool = useFundPool();
  const chainId = useChainId();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paymentRef.trim()) return;

    await fundPool.mutateAsync({
      universeId,
      packageId: selectedPkg,
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
            <div className="grid grid-cols-2 gap-2">
              {PACKAGES.map((pkg) => (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setSelectedPkg(pkg.id)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    selectedPkg === pkg.id
                      ? 'border-emerald-500 bg-emerald-950/30'
                      : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                  }`}
                >
                  <div className="text-sm font-semibold">{pkg.name}</div>
                  <div className="text-xs text-zinc-400">
                    {pkg.credits.toLocaleString()} credits
                  </div>
                  <div className="text-xs text-emerald-400 mt-1">{pkg.price}</div>
                </button>
              ))}
            </div>
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
            disabled={fundPool.isPending || !paymentRef.trim()}
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
                <Badge variant="secondary" className="ml-2 text-xs">
                  {PACKAGES.find((p) => p.id === selectedPkg)?.credits.toLocaleString()} credits
                </Badge>
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
