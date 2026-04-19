/**
 * Admin Ops — feature kill switches + spend cap controls.
 *
 * Admins flip these when something is on fire (billing runaway, abuse surge,
 * post-incident cooldown). Every write is audited via `platformConfigAudit`
 * server-side, so there is no local "did I save it?" UI state; the latest
 * query result is the source of truth.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Shield, ShieldOff, Save, Flag, Check, X } from 'lucide-react';

export const Route = createFileRoute('/admin/ops')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/ops' } });
    }
  },
  component: OpsDashboard,
});

type FeatureKey =
  | 'generationEnabled'
  | 'mintingEnabled'
  | 'purchaseEnabled'
  | 'registrationEnabled';

const FEATURES: Array<{ key: FeatureKey; label: string; hint: string }> = [
  {
    key: 'generationEnabled',
    label: 'AI generation',
    hint: 'Video, image, audio, voice, 3D. Flip off to stop all new jobs.',
  },
  {
    key: 'mintingEnabled',
    label: 'Minting',
    hint: 'Universe / episode / NFT mints server-side. On-chain is separate.',
  },
  {
    key: 'purchaseEnabled',
    label: 'Credit purchase',
    hint: 'Card, ETH, $LOAR purchases of credits.',
  },
  {
    key: 'registrationEnabled',
    label: 'Registration',
    hint: 'New user profile creation / onboarding.',
  },
];

function OpsDashboard() {
  const { isAuthenticated, address } = useWalletAuth();
  const queryClient = useQueryClient();

  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());

  const { data: cfg, isLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => trpcClient.admin.getConfig.query(),
    enabled: isAuthenticated && isAdmin,
    refetchInterval: 15_000,
  });

  const updateMutation = useMutation({
    mutationFn: (patch: Record<string, unknown>) => trpcClient.admin.updateConfig.mutate(patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-config'] });
      toast.success('Platform config updated');
    },
    onError: (err: Error) => {
      toast.error(`Update failed: ${err.message}`);
    },
  });

  const [capDraft, setCapDraft] = useState<string>('');
  const [capEnabledDraft, setCapEnabledDraft] = useState<boolean | null>(null);

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto p-8">
        <p className="text-muted-foreground">Please sign in to access the admin panel.</p>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto p-8">
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <p>
              Your wallet is not in <code className="mx-1">VITE_ADMIN_ADDRESSES</code>. Access
              denied.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !cfg) {
    return (
      <div className="container mx-auto p-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const effectiveCap = capDraft === '' ? cfg.monthlySpendCapCredits : Number(capDraft);
  const effectiveCapEnabled =
    capEnabledDraft === null ? cfg.monthlySpendCapEnabled : capEnabledDraft;
  const capDirty =
    effectiveCap !== cfg.monthlySpendCapCredits ||
    effectiveCapEnabled !== cfg.monthlySpendCapEnabled;

  async function flip(key: FeatureKey) {
    if (!cfg) return;
    const nextValue = !cfg[key];
    const verb = nextValue ? 'ENABLE' : 'DISABLE';
    const confirmed = window.confirm(
      `${verb} "${key}"?\n\nThis takes effect within ~60 seconds for all users. ` +
        `A config audit row is written.`
    );
    if (!confirmed) return;
    updateMutation.mutate({ [key]: nextValue });
  }

  async function saveCap() {
    if (!cfg) return;
    if (!Number.isFinite(effectiveCap) || effectiveCap < 0) {
      toast.error('Cap must be a non-negative number');
      return;
    }
    updateMutation.mutate({
      monthlySpendCapEnabled: effectiveCapEnabled,
      monthlySpendCapCredits: Math.floor(effectiveCap),
    });
    setCapDraft('');
    setCapEnabledDraft(null);
  }

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-center gap-3">
        <Shield className="h-6 w-6" />
        <h1 className="text-2xl font-bold">Platform Ops</h1>
      </div>
      <p className="text-muted-foreground text-sm">
        Emergency controls. Every change is written to <code>platformConfigAudit</code> with your
        address and timestamp. Effect is server-wide within ~60s (the platformConfig cache TTL).
      </p>

      {/* Kill switches */}
      <Card>
        <CardHeader>
          <CardTitle>Feature kill switches</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {FEATURES.map(({ key, label, hint }) => {
            const enabled = cfg[key];
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-4 rounded-md border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{label}</span>
                    <Badge variant={enabled ? 'default' : 'destructive'}>
                      {enabled ? 'ENABLED' : 'DISABLED'}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">{hint}</p>
                </div>
                <Button
                  variant={enabled ? 'destructive' : 'default'}
                  onClick={() => flip(key)}
                  disabled={updateMutation.isPending}
                  className="shrink-0"
                >
                  {enabled ? (
                    <>
                      <ShieldOff className="mr-2 h-4 w-4" /> Disable
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 h-4 w-4" /> Enable
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Spend cap */}
      <Card>
        <CardHeader>
          <CardTitle>Per-wallet monthly spend cap</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Rolling 30-day window. Enforced server-side before every credit deduction.
          </p>
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <Label htmlFor="cap">Cap (credits)</Label>
              <Input
                id="cap"
                type="number"
                min={0}
                value={capDraft === '' ? cfg.monthlySpendCapCredits : capDraft}
                onChange={(e) => setCapDraft(e.target.value)}
              />
            </div>
            <Button
              variant={effectiveCapEnabled ? 'destructive' : 'default'}
              onClick={() => setCapEnabledDraft(!effectiveCapEnabled)}
              type="button"
            >
              {effectiveCapEnabled ? 'Cap: ON' : 'Cap: OFF'}
            </Button>
            <Button onClick={saveCap} disabled={!capDirty || updateMutation.isPending}>
              <Save className="mr-2 h-4 w-4" /> Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Abuse flags */}
      <AbuseFlagsSection />

      {/* Metadata footer */}
      {cfg.updatedAt && (
        <p className="text-muted-foreground text-xs">
          Last updated {new Date(cfg.updatedAt as unknown as string).toLocaleString()} by{' '}
          <code>{(cfg.updatedBy as string) ?? 'unknown'}</code>.
        </p>
      )}
    </div>
  );
}

type AbuseFlagRow = {
  id: string;
  subjectUid: string;
  count24h: number;
  threshold: number;
  status: 'open' | 'dismissed' | 'confirmed';
  detectedAt: string;
  lastDetectedAt: string;
  reason?: string;
  resolvedBy?: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string | null;
};

function AbuseFlagsSection() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'open' | 'dismissed' | 'confirmed' | 'all'>(
    'open'
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-abuse-flags', statusFilter],
    queryFn: () =>
      trpcClient.admin.listAbuseFlags.query({
        status: statusFilter === 'all' ? undefined : statusFilter,
        limit: 50,
      }),
    refetchInterval: 30_000,
  });

  const resolveMutation = useMutation({
    mutationFn: (input: { id: string; status: 'dismissed' | 'confirmed' }) =>
      trpcClient.admin.updateAbuseFlag.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-abuse-flags'] });
      toast.success('Flag updated');
    },
    onError: (err: Error) => toast.error(`Update failed: ${err.message}`),
  });

  const rows = (data?.items as AbuseFlagRow[] | undefined) ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Flag className="h-5 w-5" /> Abuse flags
          </CardTitle>
          <div className="flex gap-2">
            {(['open', 'confirmed', 'dismissed', 'all'] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={statusFilter === s ? 'default' : 'outline'}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-3 text-sm">
          Produced by the anomaly-detect job when a wallet exceeds
          <code className="mx-1">ABUSE_DETECT_DAILY_THRESHOLD</code>
          generations in 24h. Dismiss when expected (e.g. whitelisted partner); confirm when
          investigated abuse so the audit trail reflects it.
        </p>
        {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {error && <p className="text-destructive text-sm">Failed to load flags: {error.message}</p>}
        {!isLoading && rows.length === 0 && (
          <p className="text-muted-foreground text-sm">No flags in this bucket.</p>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="py-1 pr-4">Wallet</th>
                  <th className="py-1 pr-4">24h count</th>
                  <th className="py-1 pr-4">Threshold</th>
                  <th className="py-1 pr-4">Last seen</th>
                  <th className="py-1 pr-4">Status</th>
                  <th className="py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="py-2 pr-4 font-mono text-xs">{r.subjectUid}</td>
                    <td className="py-2 pr-4">{r.count24h}</td>
                    <td className="py-2 pr-4">{r.threshold}</td>
                    <td className="py-2 pr-4 text-xs">
                      {new Date(r.lastDetectedAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge
                        variant={
                          r.status === 'confirmed'
                            ? 'destructive'
                            : r.status === 'dismissed'
                              ? 'secondary'
                              : 'default'
                        }
                      >
                        {r.status}
                      </Badge>
                    </td>
                    <td className="py-2">
                      {r.status === 'open' ? (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              resolveMutation.mutate({ id: r.id, status: 'dismissed' })
                            }
                            disabled={resolveMutation.isPending}
                          >
                            <X className="mr-1 h-3 w-3" /> Dismiss
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() =>
                              resolveMutation.mutate({ id: r.id, status: 'confirmed' })
                            }
                            disabled={resolveMutation.isPending}
                          >
                            <Check className="mr-1 h-3 w-3" /> Confirm
                          </Button>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {r.resolvedBy ? `by ${r.resolvedBy.slice(0, 10)}…` : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
