/**
 * UnlockFeesCard — One-time $25 unlock that waives platform credit charges
 * on any generation made with a user-supplied (BYOK) provider key.
 *
 * Four payment paths exposed:
 *   - Card (Stripe Elements; Stripe Checkout auto-enables Apple Pay /
 *     Google Pay / Link / bank debits via dashboard PMs)
 *   - Crypto (native ETH on Sepolia or Base Sepolia via Circle DCW)
 *   - Solana Pay (USDC-SPL; QR + deep-link URL)
 *   - Redeem code
 *
 * Surface lives at the top of /settings/api-keys.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { parseEther, type Address } from 'viem';
import { trpcClient } from '@/utils/trpc';
import { useSendTransaction } from '@/hooks/useCircleWrite';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckCircle2, CreditCard, Coins, KeyRound, Sparkles } from 'lucide-react';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = STRIPE_PK ? loadStripe(STRIPE_PK) : null;

export function UnlockFeesCard() {
  const queryClient = useQueryClient();

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['entitlements', 'status'],
    queryFn: () => trpcClient.entitlements.status.query(),
    refetchOnWindowFocus: false,
  });

  const { data: config } = useQuery({
    queryKey: ['entitlements', 'config'],
    queryFn: () => trpcClient.entitlements.config.query(),
    staleTime: 60 * 1000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['entitlements', 'status'] });
  };

  if (statusLoading) {
    return (
      <Card className="bg-zinc-900/40 border-white/10">
        <CardContent className="py-8 text-sm text-muted-foreground">Loading…</CardContent>
      </Card>
    );
  }

  if (status?.byokFeeWaived) {
    return (
      <Card className="bg-gradient-to-br from-emerald-950/40 to-zinc-900/40 border-emerald-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            Platform fees waived
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 ml-1">
              Active
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>
            Every generation that uses one of your own provider keys above runs at zero credit cost
            on the platform side. The provider still bills your account directly.
          </p>
          {status.unlockedAt && (
            <p className="text-xs">
              Unlocked {new Date(status.unlockedAt).toLocaleDateString()} via{' '}
              <span className="font-medium">{status.unlockedVia ?? 'unknown'}</span>
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const price = config?.priceUsd ?? 25;

  return (
    <Card className="bg-gradient-to-br from-violet-950/30 to-zinc-900/40 border-violet-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-400" />
          Skip Platform Fees — ${price.toFixed(2)} one-time
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Pay once and every generation made with one of your own provider keys below runs at zero
          platform credit cost forever. Your provider still bills you for what the model costs.
        </p>

        <Tabs defaultValue="card" className="w-full">
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="card" disabled={!config?.paymentMethods.stripe}>
              <CreditCard className="h-3.5 w-3.5 mr-1.5" />
              Card
            </TabsTrigger>
            <TabsTrigger value="eth" disabled={!config?.paymentMethods.eth}>
              <Coins className="h-3.5 w-3.5 mr-1.5" />
              ETH
            </TabsTrigger>
            <TabsTrigger value="usdc" disabled={!config?.paymentMethods.solana}>
              <Coins className="h-3.5 w-3.5 mr-1.5" />
              Solana
            </TabsTrigger>
            <TabsTrigger value="code">
              <KeyRound className="h-3.5 w-3.5 mr-1.5" />
              Code
            </TabsTrigger>
          </TabsList>

          <TabsContent value="card" className="pt-4">
            <CardTab priceUsd={price} onSuccess={invalidate} />
          </TabsContent>
          <TabsContent value="eth" className="pt-4">
            <EthTab
              priceUsd={price}
              ethPriceUsd={config?.ethPriceUsd ?? 3000}
              treasuryAddress={config?.treasuryAddress ?? null}
              acceptedChainIds={config?.acceptedChainIds ?? []}
              onSuccess={invalidate}
            />
          </TabsContent>
          <TabsContent value="usdc" className="pt-4">
            <SolanaTab onSuccess={invalidate} />
          </TabsContent>
          <TabsContent value="code" className="pt-4">
            <CodeTab onSuccess={invalidate} />
          </TabsContent>
        </Tabs>

        <p className="text-[11px] text-muted-foreground border-t border-white/5 pt-3">
          One-time, account-bound, non-transferable, non-refundable. Applies only to generations
          made with your own provider key.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Card tab (Stripe Elements) ─────────────────────────────────────────

function CardTab({ priceUsd, onSuccess }: { priceUsd: number; onSuccess: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const startCheckout = async () => {
    setConfirmOpen(false);
    if (!stripePromise) {
      toast.error('Card payments are not configured. Try crypto or a code.');
      return;
    }
    setStarting(true);
    try {
      const result = await trpcClient.entitlements.createStripeIntent.mutate();
      setClientSecret(result.clientSecret as string);
      setPaymentIntentId(result.paymentIntentId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start checkout');
    } finally {
      setStarting(false);
    }
  };

  if (clientSecret && paymentIntentId && stripePromise) {
    return (
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret,
          appearance: {
            theme: 'night',
            variables: {
              colorPrimary: '#a78bfa',
              colorBackground: '#18181b',
              colorText: '#e4e4e7',
              colorDanger: '#ef4444',
              borderRadius: '8px',
            },
          },
        }}
      >
        <StripePaymentForm
          paymentIntentId={paymentIntentId}
          onSuccess={() => {
            setClientSecret(null);
            setPaymentIntentId(null);
            onSuccess();
          }}
          onCancel={() => {
            setClientSecret(null);
            setPaymentIntentId(null);
          }}
        />
      </Elements>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Pay with credit / debit card. Apple Pay, Google Pay, Link, and bank debits available where
        supported (Stripe).
      </p>
      <Button
        onClick={() => setConfirmOpen(true)}
        disabled={starting}
        className="bg-violet-600 hover:bg-violet-500 w-full sm:w-auto"
      >
        {starting ? 'Starting…' : `Pay $${priceUsd.toFixed(2)} with card`}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        priceLabel={`$${priceUsd.toFixed(2)}`}
        method="card"
        onConfirm={startCheckout}
      />
    </div>
  );
}

function StripePaymentForm({
  paymentIntentId,
  onSuccess,
  onCancel,
}: {
  paymentIntentId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErr(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });
    if (error) {
      setErr(error.message ?? 'Payment failed');
      setSubmitting(false);
      return;
    }
    try {
      await trpcClient.entitlements.unlockWithStripe.mutate({ paymentIntentId });
      toast.success('Platform fees waived. Welcome to BYOK pricing.');
      onSuccess();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Unlock failed after payment');
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <PaymentElement options={{ layout: 'tabs' }} />
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!stripe || submitting} className="flex-1">
          {submitting ? 'Processing…' : 'Pay'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ── ETH tab ────────────────────────────────────────────────────────────

function EthTab({
  priceUsd,
  ethPriceUsd,
  treasuryAddress,
  acceptedChainIds,
  onSuccess,
}: {
  priceUsd: number;
  ethPriceUsd: number;
  treasuryAddress: string | null;
  acceptedChainIds: number[];
  onSuccess: () => void;
}) {
  const [chainId, setChainId] = useState<number>(acceptedChainIds[0] ?? 11155111);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { sendTransactionAsync, isPending } = useSendTransaction();

  const expectedEth = useMemo(
    () => (ethPriceUsd > 0 ? priceUsd / ethPriceUsd : 0),
    [priceUsd, ethPriceUsd]
  );
  // Pad 1% to avoid floor-rounding the user below the server's minWei.
  const sendEth = expectedEth * 1.01;

  const verify = useMutation({
    mutationFn: (txHash: string) =>
      trpcClient.entitlements.unlockWithEthTx.mutate({ txHash, chainId }),
    onSuccess: () => {
      toast.success('Platform fees waived. Welcome to BYOK pricing.');
      onSuccess();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Verification failed — contact support'),
  });

  const pay = async () => {
    setConfirmOpen(false);
    if (!treasuryAddress) {
      toast.error('Treasury address is not configured on the server.');
      return;
    }
    try {
      const txHash = await sendTransactionAsync({
        to: treasuryAddress as Address,
        value: parseEther(sendEth.toFixed(8)),
        chainId,
      } as any);
      toast.info('Payment sent. Verifying on-chain…');
      await verify.mutateAsync(txHash);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Payment failed');
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-white/10 bg-zinc-950/40 p-3 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Amount</span>
          <span className="font-mono">~{sendEth.toFixed(6)} ETH</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Rate</span>
          <span className="font-mono">${ethPriceUsd}/ETH</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Recipient</span>
          <span className="font-mono truncate ml-2 max-w-[180px]">{treasuryAddress ?? '—'}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Chain:</span>
        {acceptedChainIds.map((id) => (
          <Button
            key={id}
            variant={chainId === id ? 'default' : 'outline'}
            size="sm"
            onClick={() => setChainId(id)}
          >
            {id === 11155111 ? 'Sepolia' : id === 84532 ? 'Base Sepolia' : `Chain ${id}`}
          </Button>
        ))}
      </div>

      <Button
        onClick={() => setConfirmOpen(true)}
        disabled={isPending || verify.isPending || !treasuryAddress}
        className="bg-violet-600 hover:bg-violet-500 w-full sm:w-auto"
      >
        {isPending || verify.isPending ? 'Processing…' : `Pay ~${sendEth.toFixed(4)} ETH`}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        priceLabel={`~${sendEth.toFixed(6)} ETH`}
        method="ETH"
        onConfirm={pay}
      />
    </div>
  );
}

// ── Solana Pay tab ─────────────────────────────────────────────────────

function SolanaTab({ onSuccess }: { onSuccess: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [intent, setIntent] = useState<{ reference: string; url: string; amount: string } | null>(
    null
  );
  const [polling, setPolling] = useState(false);

  const start = async () => {
    setConfirmOpen(false);
    try {
      const i = await trpcClient.entitlements.createSolanaPayIntent.mutate();
      setIntent({ reference: i.reference, url: i.url, amount: i.amount });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create payment intent');
    }
  };

  useEffect(() => {
    if (!intent) return;
    let cancelled = false;
    setPolling(true);
    const interval = setInterval(async () => {
      if (cancelled) return;
      try {
        const res = await trpcClient.entitlements.unlockWithSolanaPay.mutate({
          reference: intent.reference,
        });
        if (res.ok && res.status === 'paid') {
          clearInterval(interval);
          setPolling(false);
          setIntent(null);
          toast.success('Platform fees waived. Welcome to BYOK pricing.');
          onSuccess();
        }
        if (!res.ok && res.status === 'expired') {
          clearInterval(interval);
          setPolling(false);
          toast.error('Payment intent expired. Please try again.');
          setIntent(null);
        }
      } catch {
        // network blip — keep polling
      }
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [intent, onSuccess]);

  if (intent) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Open the URL below in Phantom / Solflare / any Solana Pay wallet, or scan as a QR. Waiting
          for on-chain settlement…
        </p>
        <a
          href={intent.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all rounded-md border border-violet-500/30 bg-zinc-950/40 p-2 text-xs font-mono text-violet-300 hover:bg-zinc-900/40"
        >
          {intent.url}
        </a>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">
            {polling ? 'Polling for payment…' : 'Waiting…'}
          </span>
          <Button variant="ghost" size="sm" onClick={() => setIntent(null)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Pay with USDC on Solana via Solana Pay. Works with any Solana wallet (Phantom, Solflare,
        Backpack…).
      </p>
      <Button
        onClick={() => setConfirmOpen(true)}
        className="bg-violet-600 hover:bg-violet-500 w-full sm:w-auto"
      >
        Generate Solana Pay link
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        priceLabel="$25 USDC"
        method="Solana USDC"
        onConfirm={start}
      />
    </div>
  );
}

// ── Code tab ───────────────────────────────────────────────────────────

function CodeTab({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('');

  const redeem = useMutation({
    mutationFn: (c: string) => trpcClient.entitlements.redeemCode.mutate({ code: c }),
    onSuccess: () => {
      toast.success('Code redeemed. Platform fees waived.');
      setCode('');
      onSuccess();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Redemption failed'),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Got a code from us? Paste it here. Codes are single-use unless we say otherwise.
      </p>
      <div className="flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="UNLOCK-XXXXXXXX"
          className="font-mono uppercase"
        />
        <Button
          onClick={() => redeem.mutate(code.trim())}
          disabled={!code.trim() || redeem.isPending}
          className="bg-violet-600 hover:bg-violet-500"
        >
          {redeem.isPending ? 'Redeeming…' : 'Redeem'}
        </Button>
      </div>
    </div>
  );
}

// ── Shared confirm dialog ──────────────────────────────────────────────

function ConfirmDialog({
  open,
  onOpenChange,
  priceLabel,
  method,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  priceLabel: string;
  method: string;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm one-time unlock</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground space-y-1 pt-2">
            <span className="block">
              You will pay <span className="font-medium">{priceLabel}</span> via {method} to
              permanently waive platform credit charges on generations that use your own provider
              keys.
            </span>
            <span className="block text-amber-300/80">
              Non-refundable, non-transferable, account-bound. This is testnet payment
              infrastructure — payments are final once on-chain or settled by Stripe.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="bg-violet-600 hover:bg-violet-500" onClick={() => void onConfirm()}>
            I understand, continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
