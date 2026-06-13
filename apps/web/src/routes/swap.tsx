/**
 * /swap — Uniswap-powered token swap, settled via Circle DCW.
 *
 * Quotes come from the Uniswap Trading API (uniswap.quote); execution is
 * server-signed through the user's Circle wallet (uniswap.swap). Includes a
 * one-tap "buy $LOAR" on-ramp (uniswap.swapToLoar) — the credit currency.
 *
 * Demo chain: Ethereum Sepolia (11155111), the testnet the Trading API routes.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { parseUnits, formatUnits } from 'viem';
import { toast } from 'sonner';
import { ArrowDown, Loader2, ExternalLink, Zap } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const Route = createFileRoute('/swap')({
  component: SwapPage,
});

// ── Curated token list (Ethereum Sepolia) ──────────────────────────────────
const NATIVE = '0x0000000000000000000000000000000000000000';
const CHAIN_ID = 11155111;

interface Token {
  symbol: string;
  address: string;
  decimals: number;
}

const TOKENS: Token[] = [
  { symbol: 'ETH', address: NATIVE, decimals: 18 },
  { symbol: 'WETH', address: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9', decimals: 18 },
  { symbol: 'UNI', address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', decimals: 18 },
  { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
  { symbol: 'LOAR', address: '0xAEC35cAAE68de337711E3bc06b51aaAa5551b63F', decimals: 18 },
];

const byAddress = (a: string) => TOKENS.find((t) => t.address.toLowerCase() === a.toLowerCase());
const EXPLORER_TX = (hash: string) => `https://sepolia.etherscan.io/tx/${hash}`;

function SwapPage() {
  const { isAuthenticated, sessionReady } = useWalletAuth();

  const [tokenIn, setTokenIn] = useState<Token>(TOKENS[0]); // ETH
  const [tokenOut, setTokenOut] = useState<Token>(TOKENS[4]); // LOAR
  const [amount, setAmount] = useState('');
  const [debounced, setDebounced] = useState('');
  const [lastTx, setLastTx] = useState<string | null>(null);

  // Debounce the amount so we don't quote on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(amount), 400);
    return () => clearTimeout(id);
  }, [amount]);

  const amountWei = useMemo(() => {
    if (!debounced || Number(debounced) <= 0) return null;
    try {
      return parseUnits(debounced, tokenIn.decimals).toString();
    } catch {
      return null;
    }
  }, [debounced, tokenIn.decimals]);

  // Availability — env-gated server side.
  const status = useQuery({
    queryKey: ['uniswap-status'],
    queryFn: () => trpcClient.uniswap.status.query(),
    enabled: isAuthenticated && sessionReady,
    staleTime: 60_000,
  });

  // Live quote.
  const quote = useQuery({
    queryKey: ['uniswap-quote', tokenIn.address, tokenOut.address, amountWei],
    queryFn: () =>
      trpcClient.uniswap.quote.query({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amount: amountWei!,
        chainId: CHAIN_ID,
      }),
    enabled: !!amountWei && tokenIn.address !== tokenOut.address && isAuthenticated && sessionReady,
    retry: false,
  });

  const swap = useMutation({
    mutationFn: () =>
      trpcClient.uniswap.swap.mutate({
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        amount: amountWei!,
        chainId: CHAIN_ID,
      }),
    onSuccess: (r) => {
      setLastTx(r.txHash ?? null);
      toast.success(r.txHash ? 'Swap submitted on-chain' : `Swap ${r.state}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Swap failed'),
  });

  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmount('');
  };

  const sameToken = tokenIn.address === tokenOut.address;
  const outDisplay =
    quote.data?.amountOut && quote.data.amountOut !== '0'
      ? formatUnits(BigInt(quote.data.amountOut), tokenOut.decimals)
      : '—';

  if (!sessionReady) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-md mx-auto py-24 text-center text-muted-foreground">
        Sign in to swap tokens.
      </div>
    );
  }

  const notConfigured = status.data && !status.data.configured;

  return (
    <div className="max-w-md mx-auto py-10 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Swap</h1>
        <Badge variant="secondary" className="gap-1">
          <Zap className="h-3 w-3" /> Uniswap · Sepolia
        </Badge>
      </div>

      {notConfigured && (
        <Card className="border-amber-500/40">
          <CardContent className="py-4 text-sm text-amber-500">
            Swaps are not configured on this server (UNISWAP_API_KEY missing).
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">You pay</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input
              inputMode="decimal"
              placeholder="0.0"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              className="text-lg"
            />
            <TokenSelect value={tokenIn} onChange={setTokenIn} />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center -my-2">
        <Button variant="outline" size="icon" className="rounded-full" onClick={flip}>
          <ArrowDown className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">You receive</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2 items-center">
            <div className="flex-1 text-lg font-medium px-3 py-2 min-h-[2.5rem] flex items-center">
              {quote.isFetching ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <span className={outDisplay === '—' ? 'text-muted-foreground' : ''}>
                  {outDisplay}
                </span>
              )}
            </div>
            <TokenSelect value={tokenOut} onChange={setTokenOut} />
          </div>
        </CardContent>
      </Card>

      {/* Quote meta */}
      {quote.data && quote.data.amountOut !== '0' && (
        <div className="text-xs text-muted-foreground space-y-1 px-1">
          <div className="flex justify-between">
            <span>Route</span>
            <span>{quote.data.routing}</span>
          </div>
          {quote.data.gasFeeUSD && (
            <div className="flex justify-between">
              <span>Network fee</span>
              <span>${Number(quote.data.gasFeeUSD).toFixed(2)}</span>
            </div>
          )}
          {quote.data.needsApproval && (
            <div className="flex justify-between text-amber-500">
              <span>Approval</span>
              <span>Permit2 (auto)</span>
            </div>
          )}
        </div>
      )}

      {quote.isError && amountWei && (
        <p className="text-xs text-destructive px-1">
          No route for this pair/size on Sepolia. Try ETH → UNI / USDC / LOAR.
        </p>
      )}

      <Button
        className="w-full"
        size="lg"
        disabled={
          sameToken ||
          !amountWei ||
          !quote.data ||
          quote.data.amountOut === '0' ||
          swap.isPending ||
          notConfigured
        }
        onClick={() => swap.mutate()}
      >
        {swap.isPending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Swapping…
          </>
        ) : sameToken ? (
          'Select different tokens'
        ) : (
          `Swap ${tokenIn.symbol} → ${tokenOut.symbol}`
        )}
      </Button>

      {lastTx && (
        <a
          href={EXPLORER_TX(lastTx)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-1 text-sm text-primary hover:underline"
        >
          View transaction <ExternalLink className="h-3 w-3" />
        </a>
      )}

      <p className="text-center text-xs text-muted-foreground pt-2">
        Swaps settle from your Circle wallet — no gas or key management needed.
      </p>
    </div>
  );
}

function TokenSelect({ value, onChange }: { value: Token; onChange: (t: Token) => void }) {
  return (
    <Select
      value={value.address}
      onValueChange={(addr) => {
        const t = byAddress(addr);
        if (t) onChange(t);
      }}
    >
      <SelectTrigger className="w-28">
        <SelectValue>{value.symbol}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {TOKENS.map((t) => (
          <SelectItem key={t.address} value={t.address}>
            {t.symbol}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
