/**
 * /settings/wallets — Show the user's LOAR wallets across chains.
 *
 * Every authenticated user has a Circle DCW EVM wallet (their primary session
 * identity) and an auto-provisioned Circle DCW Solana wallet keyed by the
 * same uid. No external wallet adapter or sign-link flow is required.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink } from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useCircleSolanaAddress } from '@/hooks/useCircleSolanaAddress';

export const Route = createFileRoute('/settings/wallets')({
  component: WalletSettingsPage,
});

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' | undefined) ?? 'devnet';

interface SessionInfo {
  authenticated: boolean;
  address?: string;
  chainNamespace?: 'eip155' | 'solana';
}

function explorerSol(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER}`;
}
function explorerEvm(addr: string): string {
  return `https://sepolia.etherscan.io/address/${addr}`;
}
function truncate(s: string): string {
  return s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function WalletSettingsPage() {
  const { isAuthenticated } = useWalletAuth();
  const { address: solanaAddress, isLoading: solanaLoading } =
    useCircleSolanaAddress(isAuthenticated);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(`${SERVER_URL}/auth/me`, { credentials: 'include' });
        const data = (await resp.json()) as SessionInfo;
        if (!cancelled) setSession(data);
      } catch {
        if (!cancelled) setSession(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isAuthed = !!session?.authenticated;
  const evmAddress = session?.chainNamespace === 'eip155' ? session.address : undefined;

  if (loading) {
    return (
      <div className="container mx-auto max-w-2xl py-8">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="container mx-auto max-w-2xl py-8">
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Sign in to view your wallets.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Wallets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One LOAR identity, multiple chains. Both wallets are provisioned automatically and signed
          server-side via Circle's KMS — no browser extension required.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">EVM</CardTitle>
          <Badge variant="outline">Primary</Badge>
        </CardHeader>
        <CardContent>
          {evmAddress ? (
            <a
              href={explorerEvm(evmAddress)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-sm hover:text-purple-400"
            >
              {truncate(evmAddress)} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">No EVM wallet on this session.</span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <span>◎ Solana</span>
            <Badge variant="outline" className="text-xs">
              {CLUSTER}
            </Badge>
          </CardTitle>
          <Badge variant="outline">{solanaAddress ? 'Auto-linked' : '—'}</Badge>
        </CardHeader>
        <CardContent>
          {solanaLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : solanaAddress ? (
            <a
              href={explorerSol(solanaAddress)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-sm hover:text-purple-400"
            >
              {truncate(solanaAddress)} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">
              Solana wallet not yet provisioned. It will be created automatically the first time you
              act on Solana.
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
