/**
 * Admin controls panel — kill-switches per provider, daily cost caps at
 * every scope, alert config. Writes through admin.cost.controls.update.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { Pause, Play, Save, Bell, BellOff } from 'lucide-react';

const KNOWN_PROVIDERS = ['gemini', 'openai', 'fal', 'bytedance', 'elevenlabs', 'meshy'];

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === '' || t === '—' || t === 'unlimited') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function fmtCap(v: number | null): string {
  return v === null || v === undefined ? '' : String(v);
}

export function CostControlsPanel() {
  const qc = useQueryClient();
  const { data: controls, isLoading } = useQuery({
    queryKey: ['admin-cost-controls'],
    queryFn: () => trpcClient.admin.cost.controls.get.query(),
    refetchInterval: 30_000,
  });

  const [draft, setDraft] = useState<{
    platformDailyUsd: string;
    userDailyUsd: string;
    apiKeyDailyUsd: string;
    universeDailyUsd: string;
    marginThreshold: string;
    cooldownMinutes: string;
    alertEnabled: boolean;
  }>({
    platformDailyUsd: '',
    userDailyUsd: '',
    apiKeyDailyUsd: '',
    universeDailyUsd: '',
    marginThreshold: '',
    cooldownMinutes: '30',
    alertEnabled: false,
  });

  useEffect(() => {
    if (!controls) return;
    const c = controls as any;
    setDraft({
      platformDailyUsd: fmtCap(c.caps?.platformDailyUsd ?? null),
      userDailyUsd: fmtCap(c.caps?.userDailyUsd ?? null),
      apiKeyDailyUsd: fmtCap(c.caps?.apiKeyDailyUsd ?? null),
      universeDailyUsd: fmtCap(c.caps?.universeDailyUsd ?? null),
      marginThreshold: c.alert?.marginThreshold != null ? String(c.alert.marginThreshold) : '',
      cooldownMinutes: String(c.alert?.cooldownMinutes ?? 30),
      alertEnabled: Boolean(c.alert?.enabled),
    });
  }, [controls]);

  const update = useMutation({
    mutationFn: (patch: any) => trpcClient.admin.cost.controls.update.mutate(patch),
    onSuccess: () => {
      toast.success('Controls saved');
      qc.invalidateQueries({ queryKey: ['admin-cost-controls'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Save failed'),
  });

  const pauseProvider = useMutation({
    mutationFn: (provider: string) =>
      trpcClient.admin.cost.controls.pauseProvider.mutate({ provider }),
    onSuccess: () => {
      toast.success('Provider paused');
      qc.invalidateQueries({ queryKey: ['admin-cost-controls'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Pause failed'),
  });

  const resumeProvider = useMutation({
    mutationFn: (provider: string) =>
      trpcClient.admin.cost.controls.resumeProvider.mutate({ provider }),
    onSuccess: () => {
      toast.success('Provider resumed');
      qc.invalidateQueries({ queryKey: ['admin-cost-controls'] });
    },
    onError: (e: any) => toast.error(e.message ?? 'Resume failed'),
  });

  const paused = new Set(((controls as any)?.pausedProviders ?? []) as string[]);

  function saveAll() {
    update.mutate({
      caps: {
        platformDailyUsd: parseNum(draft.platformDailyUsd),
        userDailyUsd: parseNum(draft.userDailyUsd),
        apiKeyDailyUsd: parseNum(draft.apiKeyDailyUsd),
        universeDailyUsd: parseNum(draft.universeDailyUsd),
      },
      alert: {
        enabled: draft.alertEnabled,
        marginThreshold: parseNum(draft.marginThreshold),
        cooldownMinutes: Math.max(5, parseInt(draft.cooldownMinutes, 10) || 30),
      },
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {/* Provider kill switches */}
        <div>
          <div className="text-muted-foreground mb-2">Provider kill-switches</div>
          <div className="flex flex-wrap gap-2">
            {KNOWN_PROVIDERS.map((p) => {
              const isPaused = paused.has(p);
              return (
                <Button
                  key={p}
                  size="sm"
                  variant={isPaused ? 'destructive' : 'outline'}
                  className="h-7"
                  disabled={isLoading || pauseProvider.isPending || resumeProvider.isPending}
                  onClick={() => (isPaused ? resumeProvider.mutate(p) : pauseProvider.mutate(p))}
                >
                  {isPaused ? (
                    <Play className="h-3 w-3 mr-1" />
                  ) : (
                    <Pause className="h-3 w-3 mr-1" />
                  )}
                  {p}
                </Button>
              );
            })}
          </div>
          {paused.size > 0 ? (
            <p className="text-[10px] text-rose-400 mt-2">
              {paused.size} provider(s) paused — new paid calls will fail fast.
            </p>
          ) : null}
        </div>

        {/* Caps */}
        <div>
          <div className="text-muted-foreground mb-2">
            Daily cost caps (USD — blank = unlimited)
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Platform</span>
              <Input
                value={draft.platformDailyUsd}
                onChange={(e) => setDraft((d) => ({ ...d, platformDailyUsd: e.target.value }))}
                placeholder="unlimited"
                inputMode="decimal"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Per User</span>
              <Input
                value={draft.userDailyUsd}
                onChange={(e) => setDraft((d) => ({ ...d, userDailyUsd: e.target.value }))}
                placeholder="unlimited"
                inputMode="decimal"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Per API Key</span>
              <Input
                value={draft.apiKeyDailyUsd}
                onChange={(e) => setDraft((d) => ({ ...d, apiKeyDailyUsd: e.target.value }))}
                placeholder="unlimited"
                inputMode="decimal"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Per Universe</span>
              <Input
                value={draft.universeDailyUsd}
                onChange={(e) => setDraft((d) => ({ ...d, universeDailyUsd: e.target.value }))}
                placeholder="unlimited"
                inputMode="decimal"
              />
            </label>
          </div>
        </div>

        {/* Alerts */}
        <div>
          <div className="text-muted-foreground mb-2 flex items-center gap-2">
            Margin & cap alerts
            <Badge variant={draft.alertEnabled ? 'default' : 'outline'} className="text-[9px]">
              {draft.alertEnabled ? 'enabled' : 'disabled'}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button
              size="sm"
              variant={draft.alertEnabled ? 'default' : 'outline'}
              className="h-8"
              onClick={() => setDraft((d) => ({ ...d, alertEnabled: !d.alertEnabled }))}
            >
              {draft.alertEnabled ? (
                <>
                  <Bell className="h-3 w-3 mr-1" /> enabled
                </>
              ) : (
                <>
                  <BellOff className="h-3 w-3 mr-1" /> disabled
                </>
              )}
            </Button>
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Threshold (0–1)</span>
              <Input
                value={draft.marginThreshold}
                onChange={(e) => setDraft((d) => ({ ...d, marginThreshold: e.target.value }))}
                placeholder="target"
                inputMode="decimal"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] text-muted-foreground">Cooldown (min)</span>
              <Input
                value={draft.cooldownMinutes}
                onChange={(e) => setDraft((d) => ({ ...d, cooldownMinutes: e.target.value }))}
                inputMode="numeric"
              />
            </label>
          </div>
        </div>

        <Button size="sm" onClick={saveAll} disabled={update.isPending} className="w-full">
          <Save className="h-3 w-3 mr-1" /> Save caps & alert config
        </Button>
      </CardContent>
    </Card>
  );
}
