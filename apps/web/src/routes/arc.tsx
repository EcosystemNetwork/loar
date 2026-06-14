/**
 * /arc — Arc USDC settlement console (Continuity Track frontend).
 *
 * A working frontend over the Arc backend (lib/arc.ts + lib/x402.ts):
 *   • status   (arc.status)    — chain + USDC asset + config
 *   • balance  (arc.balance)   — USDC balance of any address on Arc
 *   • pay      (arc.pay)       — agent-to-agent USDC transfer, real on-chain tx
 *   • history  (arc.history)   — the caller's Arc payment ledger
 *   • x402     (arc.x402Quote) — the HTTP-402 payment requirements an agent gets
 *
 * Everything here is wired to live tRPC procedures — no mocks. Sending USDC is
 * gated on a wallet session (Circle DCW, server-signed). Reads are public.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Loader2,
  Wallet,
  Send,
  History,
  Receipt,
  ExternalLink,
  CircleDollarSign,
} from 'lucide-react';

export const Route = createFileRoute('/arc')({
  component: ArcConsole,
});

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
const AMT_RE = /^\d+(\.\d{1,6})?$/;

function short(s: string, head = 10, tail = 6) {
  return s.length > head + tail ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}
function txUrl(hash: string) {
  return `https://testnet.arcscan.app/tx/${hash}`;
}

function ArcConsole() {
  const { address, isAuthenticated } = useWalletAuth();

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CircleDollarSign className="h-6 w-6" /> Arc USDC Settlement
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Agent-to-agent USDC payments + x402 pay-per-call, settled on Circle&apos;s Arc L1.
        </p>
      </div>

      <StatusCard />
      <BalanceCard defaultAddress={address} />
      <PayCard isAuthenticated={isAuthenticated} fromAddress={address} />
      <HistoryCard isAuthenticated={isAuthenticated} />
      <X402QuoteCard />
    </div>
  );
}

function StatusCard() {
  const status = useQuery({
    queryKey: ['arc-status'],
    queryFn: () => trpcClient.arc.status.query(),
    staleTime: 60_000,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Wallet className="h-4 w-4" /> Network
          {status.data && (
            <Badge
              variant={status.data.configured ? 'default' : 'secondary'}
              className="ml-auto text-[10px]"
            >
              {status.data.configured ? 'signer ready' : 'read-only'}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {status.isFetching ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !status.data ? (
          <p className="text-xs text-destructive">Failed to reach Arc status.</p>
        ) : (
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Network</dt>
            <dd className="font-mono">{status.data.network}</dd>
            <dt className="text-muted-foreground">Chain ID</dt>
            <dd className="font-mono">{status.data.chainId}</dd>
            <dt className="text-muted-foreground">USDC asset</dt>
            <dd className="font-mono">{short(status.data.usdc, 14, 6)}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function BalanceCard({ defaultAddress }: { defaultAddress?: string }) {
  const [addr, setAddr] = useState(defaultAddress ?? '');
  const [submitted, setSubmitted] = useState<string | null>(defaultAddress ?? null);
  const valid = ADDR_RE.test(submitted ?? '');

  const balance = useQuery({
    queryKey: ['arc-balance', submitted],
    queryFn: () => trpcClient.arc.balance.query({ address: submitted! }),
    enabled: valid,
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <CircleDollarSign className="h-4 w-4" /> USDC balance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="0x address…"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSubmitted(addr.trim())}
            className="font-mono text-sm"
          />
          <Button onClick={() => setSubmitted(addr.trim())} disabled={!ADDR_RE.test(addr.trim())}>
            Check
          </Button>
        </div>
        {submitted && !valid && (
          <p className="text-xs text-destructive">Enter a valid 0x address.</p>
        )}
        {valid && balance.isFetching && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {valid && balance.data && (
          <p className="text-2xl font-semibold">
            {balance.data.usdc} <span className="text-sm text-muted-foreground">USDC</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PayCard({
  isAuthenticated,
  fromAddress,
}: {
  isAuthenticated: boolean;
  fromAddress?: string;
}) {
  const qc = useQueryClient();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  const pay = useMutation({
    mutationFn: () =>
      trpcClient.arc.pay.mutate({ to, amountUsdc: amount, memo: memo || undefined }),
    onSuccess: (res) => {
      toast.success(`Sent ${res.amountUsdc} USDC`, {
        action: { label: 'View tx', onClick: () => window.open(res.explorerUrl, '_blank') },
      });
      setTo('');
      setAmount('');
      setMemo('');
      qc.invalidateQueries({ queryKey: ['arc-history'] });
      if (fromAddress) qc.invalidateQueries({ queryKey: ['arc-balance', fromAddress] });
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Payment failed'),
  });

  const canPay = ADDR_RE.test(to.trim()) && AMT_RE.test(amount.trim()) && Number(amount) > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Send className="h-4 w-4" /> Send USDC
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isAuthenticated ? (
          <p className="text-xs text-muted-foreground">Sign in to send USDC on Arc.</p>
        ) : (
          <>
            <div className="space-y-1">
              <Label htmlFor="arc-to" className="text-xs">
                Recipient
              </Label>
              <Input
                id="arc-to"
                placeholder="0x address…"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="arc-amt" className="text-xs">
                Amount (USDC)
              </Label>
              <Input
                id="arc-amt"
                inputMode="decimal"
                placeholder="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="arc-memo" className="text-xs">
                Memo (optional)
              </Label>
              <Input
                id="arc-memo"
                placeholder="e.g. render job #42"
                value={memo}
                maxLength={280}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
            <Button
              onClick={() => pay.mutate()}
              disabled={!canPay || pay.isPending}
              className="w-full"
            >
              {pay.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Settling on Arc…
                </>
              ) : (
                'Send USDC'
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryCard({ isAuthenticated }: { isAuthenticated: boolean }) {
  const history = useQuery({
    queryKey: ['arc-history'],
    queryFn: () => trpcClient.arc.history.query({ limit: 25 }),
    enabled: isAuthenticated,
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <History className="h-4 w-4" /> Payment history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!isAuthenticated ? (
          <p className="text-xs text-muted-foreground">Sign in to see your Arc payments.</p>
        ) : history.isFetching ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !history.data?.length ? (
          <p className="text-xs text-muted-foreground">No payments yet.</p>
        ) : (
          <div className="space-y-1">
            {(
              history.data as Array<{
                txHash: string;
                to: string;
                amountUsdc: string;
                memo?: string | null;
              }>
            ).map((p) => (
              <div
                key={p.txHash}
                className="flex items-center gap-2 text-sm py-1.5 border-b border-border/40 last:border-0"
              >
                <span className="font-semibold tabular-nums">{p.amountUsdc}</span>
                <span className="text-xs text-muted-foreground">USDC →</span>
                <span className="font-mono text-xs flex-1">{short(p.to)}</span>
                {p.memo && (
                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                    {p.memo}
                  </span>
                )}
                <a
                  href={txUrl(p.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-primary"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function X402QuoteCard() {
  const [resource, setResource] = useState('/api/x402/echo');
  const [amount, setAmount] = useState('0.01');
  const [payTo, setPayTo] = useState('');
  const [quote, setQuote] = useState<unknown | null>(null);

  const fetchQuote = useMutation({
    mutationFn: () => trpcClient.arc.x402Quote.query({ resource, amountUsdc: amount, payTo }),
    onSuccess: (data) => setQuote(data),
    onError: (err: unknown) =>
      toast.error(err instanceof Error ? err.message : 'Failed to build quote'),
  });

  const canQuote =
    ADDR_RE.test(payTo.trim()) && AMT_RE.test(amount.trim()) && resource.trim().length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Receipt className="h-4 w-4" /> x402 payment quote
          <Badge variant="secondary" className="ml-auto text-[10px]">
            HTTP 402 · EIP-3009
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          The exact <span className="font-mono">402</span> body an agent receives when it hits a
          paid resource — price, recipient, asset, and the USDC EIP-712 domain it signs over.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1 col-span-2">
            <Label htmlFor="x402-res" className="text-xs">
              Resource
            </Label>
            <Input
              id="x402-res"
              value={resource}
              onChange={(e) => setResource(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="x402-amt" className="text-xs">
              Price (USDC)
            </Label>
            <Input
              id="x402-amt"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="x402-to" className="text-xs">
              Pay to
            </Label>
            <Input
              id="x402-to"
              placeholder="0x…"
              value={payTo}
              onChange={(e) => setPayTo(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => fetchQuote.mutate()}
          disabled={!canQuote || fetchQuote.isPending}
          className="w-full"
        >
          {fetchQuote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Build 402 quote'}
        </Button>
        {quote != null && (
          <pre className="text-[11px] bg-muted/50 rounded-md p-3 overflow-x-auto font-mono">
            {JSON.stringify(quote, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
