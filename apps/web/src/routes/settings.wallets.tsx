/**
 * /settings/wallets — Manage linked wallets across chains.
 *
 * Shows the user's primary EVM wallet (current session) and any linked
 * Solana wallet. Lets EVM-signed-in users attach a Solana wallet via SIWS,
 * so the same LOAR identity owns assets on both chains.
 *
 * Backend: POST /auth/solana/link — verifies a SIWS signature over a
 * server-issued nonce, then reissues the JWT with a `sol` claim. The
 * existing session stays alive; AuthUser now carries both addresses.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle, Loader2, ExternalLink, Link2, Link2Off } from 'lucide-react';
import { useWalletAuth } from '@/lib/wallet-auth';
import { useSolanaAuth } from '@/lib/solana-auth';

export const Route = createFileRoute('/settings/wallets')({
  component: WalletSettingsPage,
});

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' | undefined) ?? 'devnet';

interface SessionInfo {
  authenticated: boolean;
  /** Primary identity from the JWT (EVM 0x… or Solana base58). */
  address?: string;
  /** Linked EVM address (when sub is Solana). */
  evm?: string;
  /** Linked Solana address (when sub is EVM). */
  sol?: string;
  /** Chain namespace of the primary identity. */
  chainNamespace?: 'eip155' | 'solana';
  expiresAt?: number;
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
  const walletAuth = useWalletAuth();
  const solana = useSolanaAuth();
  const { setVisible: openSolanaModal } = useWalletModal();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Pull the canonical session shape from /auth/me — server side knows the
  // full JWT claims including `evm` / `sol` linkage.
  async function refetchSession() {
    try {
      const resp = await fetch(`${SERVER_URL}/auth/me`, { credentials: 'include' });
      const data = (await resp.json()) as SessionInfo;
      setSession(data);
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refetchSession();
  }, []);

  const isAuthed = !!session?.authenticated;
  const ns = session?.chainNamespace ?? 'eip155';
  const primaryEvm = ns === 'eip155' ? session?.address : session?.evm;
  const linkedSol = ns === 'eip155' ? session?.sol : session?.address;

  async function handleLink() {
    if (!solana.wallet.connected) {
      openSolanaModal(true);
      return;
    }
    const result = await solana.linkToEvmSession();
    if (result) {
      // Server reissued the JWT with the new `sol` claim — refetch to pick it up.
      await refetchSession();
    }
  }

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
            Sign in to manage linked wallets.
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
          One LOAR identity, multiple chains. Link a Solana wallet to mint cNFTs and pay with Solana
          Pay while keeping your EVM ownership.
        </p>
      </div>

      {/* ── EVM wallet ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">EVM</CardTitle>
          <Badge variant="outline">
            {ns === 'eip155' ? 'Primary' : primaryEvm ? 'Linked' : 'Not linked'}
          </Badge>
        </CardHeader>
        <CardContent>
          {primaryEvm ? (
            <a
              href={explorerEvm(primaryEvm)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-sm hover:text-purple-400"
            >
              {truncate(primaryEvm)} <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="text-sm text-muted-foreground">No EVM wallet on this session.</span>
          )}
        </CardContent>
      </Card>

      {/* ── Solana wallet ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <span>◎ Solana</span>
            <Badge variant="outline" className="text-xs">
              {CLUSTER}
            </Badge>
          </CardTitle>
          <Badge variant="outline">
            {ns === 'solana' ? 'Primary' : linkedSol ? 'Linked' : 'Not linked'}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          {linkedSol ? (
            <div className="flex items-center justify-between gap-3">
              <a
                href={explorerSol(linkedSol)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-mono text-sm hover:text-purple-400"
              >
                {truncate(linkedSol)} <ExternalLink className="h-3 w-3" />
              </a>
              {ns === 'eip155' && (
                <div className="flex items-center gap-2 text-xs text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Linked
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Connect Phantom / Solflare and sign a message to link your Solana wallet to this
                account.
              </p>
              {solana.error && (
                <div className="rounded-md border border-red-700 bg-red-950/30 p-2 text-xs text-red-300">
                  <AlertCircle className="mb-0.5 inline h-3 w-3" /> {solana.error}
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void handleLink()}
                  disabled={solana.isSigningIn}
                  className="bg-purple-600 hover:bg-purple-500"
                >
                  {solana.isSigningIn ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="mr-2 h-4 w-4" />
                  )}
                  {solana.wallet.connected ? 'Sign + Link' : 'Connect Solana wallet'}
                </Button>
                {solana.wallet.connected && (
                  <Button variant="ghost" size="sm" onClick={() => void solana.wallet.disconnect()}>
                    <Link2Off className="mr-1 h-3 w-3" /> Cancel
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Linking only adds the Solana address to your existing session's JWT — it doesn't transfer
        control of either wallet. You can unlink in v2 by re-signing in.
      </p>
    </div>
  );
}
