/**
 * OAuth SIWE bridge — authorizes an MCP gateway session with the user's wallet.
 *
 * Flow:
 *   1. Agent client (OpenClaw / Hermes / etc) redirects the user to
 *      mcp.loar.fun/authorize?client_id=...&redirect_uri=...&...
 *   2. The gateway persists the PKCE challenge and redirects to THIS page:
 *      loar.fun/oauth/siwe?authz=<code>&return_to=<gateway-callback>
 *   3. This page signs a SIWE message with the user's wallet and redirects to
 *      ${return_to}?authz=<code>&address=0x...&signature=...&message=...
 *   4. The gateway verifies the signature upstream and issues an OAuth authz
 *      code back to the agent's redirect_uri.
 *
 * This page is distinct from /login because:
 *   - It does NOT set a LOAR session cookie (no persistent login side-effect)
 *     — the signed payload is handed to a THIRD-PARTY endpoint.
 *   - It shows the requesting origin so the user can verify they're
 *     authorizing mcp.loar.fun (not a phishing redirect).
 *
 * See docs/mcp-hosted-sse-deploy.md Phase 1.1.
 */
import { createFileRoute, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { useActiveAccount } from 'thirdweb/react';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { z } from 'zod';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';

const searchSchema = z.object({
  authz: z.string().min(1),
  return_to: z.string().url(),
});

export const Route = createFileRoute('/oauth/siwe')({
  validateSearch: (s) => searchSchema.parse(s),
  component: OAuthSiwePage,
});

function OAuthSiwePage() {
  const { authz, return_to } = useSearch({ from: '/oauth/siwe' });
  const { address: wagmiAddress, chain } = useAccount();
  const thirdwebAccount = useActiveAccount();
  const address = (wagmiAddress ?? thirdwebAccount?.address) as `0x${string}` | undefined;

  const [state, setState] = useState<'idle' | 'signing' | 'redirecting' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Parse the gateway origin out of return_to so we can display it prominently.
  const gatewayOrigin = useMemo(() => {
    try {
      return new URL(return_to).origin;
    } catch {
      return null;
    }
  }, [return_to]);

  // Defense-in-depth: reject return_to URLs that aren't https://mcp.loar.fun
  // or a known dev host. Prevents open-redirect to a phishing site.
  const ALLOWED_RETURN_HOSTS = useMemo(() => {
    const prod = ['https://mcp.loar.fun'];
    if (import.meta.env.DEV) {
      prod.push('http://localhost:3334', 'http://127.0.0.1:3334');
    }
    return new Set(prod);
  }, []);
  const returnAllowed = gatewayOrigin ? ALLOWED_RETURN_HOSTS.has(gatewayOrigin) : false;

  const authorize = async () => {
    if (!address || !thirdwebAccount) return;
    setState('signing');
    setError(null);
    try {
      const nonceRes = await fetch(`${SERVER_URL}/auth/nonce`);
      if (!nonceRes.ok) throw new Error('Failed to fetch nonce');
      const { nonce } = (await nonceRes.json()) as { nonce: string };

      const now = new Date();
      const expires = new Date(now.getTime() + 2 * 60 * 1000);
      const chainId = chain?.id ?? 8453;
      const host = gatewayOrigin ?? 'mcp.loar.fun';
      const message = [
        `${host} wants you to sign in with your Ethereum account:`,
        address,
        '',
        `Authorize MCP agent session (authz=${authz.slice(0, 8)}…).`,
        '',
        `URI: ${host}`,
        `Version: 1`,
        `Chain ID: ${chainId}`,
        `Nonce: ${nonce}`,
        `Issued At: ${now.toISOString()}`,
        `Expiration Time: ${expires.toISOString()}`,
      ].join('\n');

      const signature = await thirdwebAccount.signMessage({ message });

      setState('redirecting');

      // Redirect back to the gateway with the signed payload.
      const target = new URL(return_to);
      target.searchParams.set('authz', authz);
      target.searchParams.set('address', address);
      target.searchParams.set('signature', signature);
      target.searchParams.set('message', message);
      window.location.replace(target.toString());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      setError(msg);
      setState('error');
    }
  };

  if (!returnAllowed) {
    return (
      <CenteredCard>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-destructive">
            <AlertCircle className="h-5 w-5" />
            Untrusted redirect
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            This authorization request wants to redirect you to{' '}
            <code>{gatewayOrigin ?? '(unparseable URL)'}</code>, which is not a recognized LOAR
            gateway.
          </p>
          <p className="text-muted-foreground">
            Close this tab — you were probably sent here by a malicious link.
          </p>
        </CardContent>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5 text-primary" />
          Authorize agent session
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 text-sm">
        <p>
          An agent client is asking to connect to <strong>{gatewayOrigin}</strong> on your behalf.
          After you sign, the agent can call LOAR tools scoped to your wallet.
        </p>

        <div className="rounded-lg border bg-muted/50 p-3 text-xs">
          <div className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
            What gets signed
          </div>
          <div>A SIWE message including a fresh nonce from api.loar.fun.</div>
          <div className="mt-1 text-muted-foreground">
            No transaction is broadcast. No fees are paid. The signature only proves you control the
            wallet.
          </div>
        </div>

        {!address ? (
          <div className="space-y-3">
            <div className="text-muted-foreground">Connect your wallet to continue.</div>
            <WalletConnectButton />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-md border px-3 py-2 font-mono text-xs">
              {address.slice(0, 6)}…{address.slice(-4)}
            </div>
            <Button
              onClick={authorize}
              disabled={state === 'signing' || state === 'redirecting'}
              className="w-full"
            >
              {state === 'signing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {state === 'redirecting' && <CheckCircle2 className="mr-2 h-4 w-4" />}
              {state === 'signing'
                ? 'Waiting for wallet signature…'
                : state === 'redirecting'
                  ? 'Redirecting back to the agent…'
                  : 'Sign and authorize'}
            </Button>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-1 pt-2 text-xs text-muted-foreground">
          <ExternalLink className="h-3 w-3" />
          After signing you'll be returned to <code>{gatewayOrigin}</code>.
        </div>
      </CardContent>
    </CenteredCard>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">{children}</Card>
    </div>
  );
}
