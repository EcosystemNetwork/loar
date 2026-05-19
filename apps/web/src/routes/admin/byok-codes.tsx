/**
 * /admin/byok-codes — Mint and manage one-time BYOK fee-waiver unlock codes.
 *
 * Admin-only. Gated by VITE_ADMIN_ADDRESSES (wallet allowlist; same pattern
 * as /admin/moderation). Codes redeem at /settings/api-keys via the
 * UnlockFeesCard "Code" tab.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Copy, KeyRound, Loader2, Shield, Sparkles, Trash2 } from 'lucide-react';

export const Route = createFileRoute('/admin/byok-codes')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/byok-codes' } });
    }
  },
  component: ByokCodesPage,
});

function ByokCodesPage() {
  const { isAuthenticated, isAuthenticating, address } = useWalletAuth();
  const queryClient = useQueryClient();

  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());

  const { data: codes, isLoading } = useQuery({
    queryKey: ['admin', 'byokCodes'],
    queryFn: () => trpcClient.entitlements.admin.listCodes.query({ limit: 200 }),
    enabled: isAdmin,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'byokCodes'] });

  if (isAuthenticating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAuthenticated) return null;
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <Shield className="h-12 w-12 mx-auto text-red-400" />
          <h2 className="text-xl font-bold">Unauthorized</h2>
          <p className="text-muted-foreground text-sm">
            Your wallet is not in the admin allowlist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <KeyRound className="h-7 w-7 text-violet-400" />
          BYOK Unlock Codes
        </h1>
        <p className="text-muted-foreground text-sm mt-2">
          Mint codes that grant the one-time BYOK fee waiver. Hand them out for partnerships,
          giveaways, support comps, or affiliate payouts. Codes are case-insensitive and account-
          bound on redemption.
        </p>
      </div>

      <MintCodeCard onMinted={invalidate} />
      <GrantDirectCard />

      <Card className="bg-zinc-900/40 border-white/10">
        <CardHeader>
          <CardTitle className="text-base">Issued codes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : !codes || codes.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No codes minted yet.</div>
          ) : (
            <div className="space-y-2">
              {codes.map((c) => (
                <CodeRow key={c.code} code={c} onRevoked={invalidate} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Mint ───────────────────────────────────────────────────────────────

function MintCodeCard({ onMinted }: { onMinted: () => void }) {
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [maxRedemptions, setMaxRedemptions] = useState<number>(1);
  const [expiresAt, setExpiresAt] = useState('');
  const [lastMinted, setLastMinted] = useState<string | null>(null);

  const mint = useMutation({
    mutationFn: () =>
      trpcClient.entitlements.admin.mintCode.mutate({
        code: code.trim() || undefined,
        note: note.trim() || undefined,
        maxRedemptions,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      }),
    onSuccess: (res) => {
      toast.success(`Minted ${res.code}`);
      setLastMinted(res.code);
      setCode('');
      setNote('');
      setMaxRedemptions(1);
      setExpiresAt('');
      onMinted();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Mint failed'),
  });

  return (
    <Card className="bg-gradient-to-br from-violet-950/30 to-zinc-900/40 border-violet-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-violet-400" />
          Mint a new code
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Code (optional)
            </Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="LAUNCH-2026 — blank to auto-generate"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Max redemptions
            </Label>
            <Input
              type="number"
              min={1}
              max={10000}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(Math.max(1, Number(e.target.value) || 1))}
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Note (internal — not shown to redeemer)
            </Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Colosseum hackathon, podcast guest, support comp"
            />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Expires at (optional)
            </Label>
            <Input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
        </div>
        <Button
          onClick={() => mint.mutate()}
          disabled={mint.isPending}
          className="bg-violet-600 hover:bg-violet-500"
        >
          {mint.isPending ? 'Minting…' : 'Mint code'}
        </Button>

        {lastMinted && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm flex items-center justify-between gap-3">
            <span>
              New code:{' '}
              <span className="font-mono font-semibold text-emerald-300">{lastMinted}</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(lastMinted);
                toast.success('Copied');
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              Copy
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Direct grant (no code, no payment) ─────────────────────────────────

function GrantDirectCard() {
  const [uid, setUid] = useState('');
  const [note, setNote] = useState('');

  const grant = useMutation({
    mutationFn: () =>
      trpcClient.entitlements.admin.grant.mutate({
        uid: uid.trim(),
        note: note.trim() || undefined,
      }),
    onSuccess: (res) => {
      toast.success(res.alreadyActive ? 'User was already unlocked' : `Granted to ${uid}`);
      setUid('');
      setNote('');
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Grant failed'),
  });

  return (
    <Card className="bg-zinc-900/40 border-white/10">
      <CardHeader>
        <CardTitle className="text-base">Grant directly (no code, no payment)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          For support / comp / VIP cases when you don't want to expose a code. Records the grant
          source as <span className="font-mono">admin:{'<your-uid>'}</span> in the entitlement audit
          field.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Target user ID (wallet address)
            </Label>
            <Input
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              placeholder="0x… (lowercased)"
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Note (internal)
            </Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="reason / ticket ref"
            />
          </div>
        </div>
        <Button
          onClick={() => grant.mutate()}
          disabled={!uid.trim() || grant.isPending}
          variant="outline"
        >
          {grant.isPending ? 'Granting…' : 'Grant fee waiver'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── List row ───────────────────────────────────────────────────────────

type CodeListEntry = NonNullable<
  Awaited<ReturnType<typeof trpcClient.entitlements.admin.listCodes.query>>
>[number];

function CodeRow({ code, onRevoked }: { code: CodeListEntry; onRevoked: () => void }) {
  const redeemed = code.redeemedBy.length;
  const max = code.maxRedemptions;
  const expired = useMemo(() => {
    if (!code.expiresAt) return false;
    return new Date(code.expiresAt).getTime() < Date.now();
  }, [code.expiresAt]);
  const exhausted = redeemed >= max;
  const status = !code.active
    ? { label: 'Revoked', tone: 'bg-red-500/20 text-red-300 border-red-500/30' }
    : expired
      ? { label: 'Expired', tone: 'bg-amber-500/20 text-amber-300 border-amber-500/30' }
      : exhausted
        ? { label: 'Used up', tone: 'bg-zinc-500/20 text-zinc-300 border-zinc-500/30' }
        : { label: 'Active', tone: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };

  const revoke = useMutation({
    mutationFn: () => trpcClient.entitlements.admin.revokeCode.mutate({ code: code.code }),
    onSuccess: () => {
      toast.success(`Revoked ${code.code}`);
      onRevoked();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Revoke failed'),
  });

  return (
    <div className="rounded-md border border-white/5 bg-zinc-950/30 p-3 flex items-center gap-3 flex-wrap">
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-violet-200">{code.code}</span>
          <Badge variant="outline" className={status.tone}>
            {status.label}
          </Badge>
          {code.note && (
            <span className="text-xs text-muted-foreground italic truncate">— {code.note}</span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {redeemed}/{max} redeemed
          {code.expiresAt && (
            <>
              {' • expires '}
              {new Date(code.expiresAt).toLocaleString()}
            </>
          )}
          {' • created '}
          {new Date(code.createdAt).toLocaleDateString()}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            navigator.clipboard.writeText(code.code);
            toast.success('Copied');
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        {code.active && (
          <Button
            size="sm"
            variant="ghost"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate()}
            className="text-red-400 hover:text-red-300"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
