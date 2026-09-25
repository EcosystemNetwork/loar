/**
 * ProviderKeysPanel — the BYOK half of /settings/api-keys.
 *
 * One glanceable list of every provider LOAR can route through, grouped by
 * what it powers (video/image, LLM, voice, 3D, transcription). Each row shows
 * status, the masked key, last-verified / last-used and 30-day call volume;
 * expanding a row reveals the add/replace form and the full details. A
 * summary strip up top plus a "needs attention" banner surface rejected or
 * disabled keys without scrolling.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Lock,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import {
  PROVIDER_CATEGORIES,
  PROVIDER_META,
  formatRelativeTime,
  keyStatus,
  matchesKeyFilter,
  summarizeKeys,
  type KeyFilter,
  type KeyStatus,
  type Provider,
} from '@/lib/providerMeta';
import { cn } from '@/lib/utils';

const KEYS_QUERY = ['providers', 'listKeys'] as const;
const USAGE_QUERY = ['providers', 'usage'] as const;

type StoredKey = Awaited<ReturnType<typeof trpcClient.providers.listKeys.query>>[number];
type UsageRow = { provider: string; calls: number; byokCalls: number; totalCredits: number };

const STATUS_STYLE: Record<
  KeyStatus | 'locked',
  { label: string; dot: string; text: string; icon: typeof CheckCircle2 }
> = {
  active: { label: 'Active', dot: 'bg-emerald-400', text: 'text-emerald-300', icon: CheckCircle2 },
  disabled: { label: 'Disabled', dot: 'bg-amber-400', text: 'text-amber-300', icon: PauseCircle },
  rejected: { label: 'Rejected', dot: 'bg-red-400', text: 'text-red-300', icon: AlertTriangle },
  locked: { label: 'No key', dot: 'bg-zinc-600', text: 'text-zinc-400', icon: Lock },
};

const FILTERS: { id: KeyFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'locked', label: 'No key' },
];

export function ProviderKeysPanel({ onAgentKeysClick }: { onAgentKeysClick?: () => void }) {
  const { data: keys, isLoading } = useQuery({
    queryKey: KEYS_QUERY,
    queryFn: () => trpcClient.providers.listKeys.query(),
    refetchOnWindowFocus: false,
  });
  const { data: usage } = useQuery({
    queryKey: USAGE_QUERY,
    queryFn: () => trpcClient.providers.usage.query(),
    refetchOnWindowFocus: false,
  });

  const [filter, setFilter] = useState<KeyFilter>('all');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<Provider | null>(null);

  const byProvider = useMemo(() => new Map((keys ?? []).map((k) => [k.provider, k])), [keys]);
  const usageByProvider = useMemo(
    () => new Map<string, UsageRow>((usage?.byProvider ?? []).map((u) => [u.provider, u])),
    [usage]
  );
  const summary = useMemo(() => summarizeKeys(keys), [keys]);
  const needsAttention = summary.rejected + summary.disabled;

  const query = search.trim().toLowerCase();
  const groups = useMemo(
    () =>
      PROVIDER_CATEGORIES.map((cat) => ({
        ...cat,
        providers: (Object.keys(PROVIDER_META) as Provider[]).filter((id) => {
          const meta = PROVIDER_META[id];
          if (meta.category !== cat.id) return false;
          if (!matchesKeyFilter(byProvider.get(id), filter)) return false;
          if (!query) return true;
          return `${meta.label} ${id} ${meta.blurb}`.toLowerCase().includes(query);
        }),
      })).filter((g) => g.providers.length > 0),
    [byProvider, filter, query]
  );
  const visibleCount = groups.reduce((n, g) => n + g.providers.length, 0);

  const filterCount = (f: KeyFilter) =>
    f === 'all'
      ? summary.total
      : f === 'active'
        ? summary.active
        : f === 'attention'
          ? needsAttention
          : summary.locked;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile
          label="Connected"
          value={summary.active}
          sub={`of ${summary.total} providers`}
          tone="emerald"
        />
        <StatTile
          label="Needs attention"
          value={needsAttention}
          sub={
            needsAttention
              ? `${summary.rejected} rejected · ${summary.disabled} disabled`
              : 'all keys healthy'
          }
          tone={needsAttention ? 'red' : 'zinc'}
        />
        <StatTile label="No key yet" value={summary.locked} sub="models stay locked" tone="zinc" />
        <StatTile
          label="Calls · 30d"
          value={(usage?.byProvider ?? []).reduce((n, u) => n + u.byokCalls, 0)}
          sub="through your keys"
          tone="violet"
        />
      </div>

      {needsAttention > 0 && (
        <button
          type="button"
          onClick={() => setFilter('attention')}
          className="w-full text-left rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm flex items-center gap-3 hover:bg-red-500/10 transition-colors"
        >
          <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
          <span className="flex-1 text-red-200">
            {needsAttention} key{needsAttention === 1 ? '' : 's'} need
            {needsAttention === 1 ? 's' : ''} attention — models on those providers are locked.
          </span>
          <span className="text-xs text-red-300 underline underline-offset-2">Show</span>
        </button>
      )}

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search providers…"
            aria-label="Search providers"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter providers">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                filter === f.id
                  ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
                  : 'border-white/10 text-muted-foreground hover:text-foreground hover:border-white/20'
              )}
            >
              {f.label} <span className="opacity-60">{filterCount(f.id)}</span>
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading your keys…</p>
      ) : visibleCount === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground bg-zinc-900/40 border-white/10">
          No providers match.{' '}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => {
              setFilter('all');
              setSearch('');
            }}
          >
            Clear filters
          </button>
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.id} className="space-y-2">
            <div className="flex items-baseline gap-2 px-1">
              <h3 className="text-sm font-semibold">{g.label}</h3>
              <span className="text-xs text-muted-foreground">{g.blurb}</span>
            </div>
            <Card className="bg-zinc-900/40 border-white/10 divide-y divide-white/5 overflow-hidden">
              {g.providers.map((id) => (
                <ProviderRow
                  key={id}
                  provider={id}
                  stored={byProvider.get(id) ?? null}
                  usage={usageByProvider.get(id)}
                  open={openId === id}
                  onToggle={() => setOpenId(openId === id ? null : id)}
                />
              ))}
            </Card>
          </section>
        ))
      )}

      {onAgentKeysClick && (
        <p className="text-xs text-muted-foreground px-1">
          Looking for a key to hand to an agent or script?{' '}
          <button
            type="button"
            onClick={onAgentKeysClick}
            className="text-amber-300 hover:text-amber-200 underline underline-offset-2"
          >
            Agent API keys
          </button>
        </p>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub: string;
  tone: 'emerald' | 'red' | 'violet' | 'zinc';
}) {
  const color = {
    emerald: 'text-emerald-300',
    red: 'text-red-300',
    violet: 'text-violet-300',
    zinc: 'text-zinc-200',
  }[tone];
  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/40 px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('text-2xl font-semibold tabular-nums mt-0.5', color)}>
        {value.toLocaleString()}
      </p>
      <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>
    </div>
  );
}

function ProviderRow({
  provider,
  stored,
  usage,
  open,
  onToggle,
}: {
  provider: Provider;
  stored: StoredKey | null;
  usage: UsageRow | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  const meta = PROVIDER_META[provider];
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');

  const status: KeyStatus | 'locked' = stored ? keyStatus(stored) : 'locked';
  const style = STATUS_STYLE[status];
  const StatusIcon = style.icon;

  const refresh = (models = false) => {
    queryClient.invalidateQueries({ queryKey: KEYS_QUERY });
    if (models) queryClient.invalidateQueries({ queryKey: ['providers', 'listModels'] });
  };
  const fail = (fallback: string) => (err: unknown) =>
    toast.error(err instanceof Error ? err.message : fallback);

  const setKey = useMutation({
    mutationFn: (v: string) => trpcClient.providers.upsertKey.mutate({ provider, apiKey: v }),
    onSuccess: () => {
      toast.success(`${meta.label} key saved`);
      setValue('');
      refresh(true);
    },
    onError: fail('Save failed'),
  });
  const clearKey = useMutation({
    mutationFn: () => trpcClient.providers.deleteKey.mutate({ provider }),
    onSuccess: () => {
      toast.success(`${meta.label} key removed`);
      refresh(true);
    },
    onError: fail('Remove failed'),
  });
  const testKey = useMutation({
    mutationFn: () => trpcClient.providers.testKey.mutate({ provider }),
    onSuccess: (res) => {
      if (res.lastCheckStatus === 'invalid') {
        toast.error(`${meta.label} rejected this key — it may have been revoked. Paste a new one.`);
      } else {
        toast.success(`${meta.label} key is working`);
      }
      refresh();
    },
    onError: fail('Test failed'),
  });
  const toggleEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      trpcClient.providers.setKeyEnabled.mutate({ provider, enabled }),
    onSuccess: (_res, enabled) => {
      toast.success(`${meta.label} key ${enabled ? 'enabled' : 'disabled'}`);
      refresh(true);
    },
    onError: fail('Update failed'),
  });

  const handleSave = () => {
    const trimmed = value.trim();
    // Server tests the key against the provider before persisting.
    if (trimmed) setKey.mutate(trimmed);
  };

  const summaryLine = stored
    ? [
        `saved ${new Date(stored.createdAt).toLocaleDateString()}`,
        stored.testedAt ? `verified ${formatRelativeTime(stored.testedAt)}` : null,
        stored.lastUsedAt ? `used ${formatRelativeTime(stored.lastUsedAt)}` : 'not used yet',
      ]
        .filter(Boolean)
        .join(' · ')
    : meta.lockedNote;

  return (
    <div className={cn(status === 'rejected' && 'bg-red-500/[0.04]')}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${provider}-panel`}
          className="flex flex-1 min-w-0 items-center gap-3 text-left"
        >
          <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', style.dot)} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-sm">{meta.label}</span>
              <span className={cn('inline-flex items-center gap-1 text-xs', style.text)}>
                <StatusIcon className="h-3 w-3" />
                {style.label}
              </span>
              {stored && (
                <span className="font-mono text-xs text-muted-foreground">
                  •••• {stored.last4 || stored.fingerprint.slice(-4)}
                </span>
              )}
            </span>
            <span className="block text-xs text-muted-foreground truncate">{summaryLine}</span>
          </span>
          {usage && usage.calls > 0 && (
            <span className="hidden sm:block text-right text-xs text-muted-foreground flex-shrink-0">
              <span className="block tabular-nums text-foreground">
                {usage.byokCalls.toLocaleString()}
              </span>
              calls · 30d
            </span>
          )}
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform',
              open && 'rotate-180'
            )}
          />
        </button>
        {!stored && !open && (
          <Button size="sm" variant="outline" className="gap-1 flex-shrink-0" onClick={onToggle}>
            <Plus className="h-3.5 w-3.5" />
            Add key
          </Button>
        )}
      </div>

      {open && (
        <div id={`${provider}-panel`} className="px-4 pb-4 pl-[2.25rem] sm:pl-[2.75rem] space-y-4">
          <p className="text-xs text-muted-foreground">{meta.blurb}</p>

          {status === 'rejected' && (
            <p className="text-xs text-red-300">
              {meta.label} rejected this key on the last check — it was probably revoked or rotated.
              Paste a new one below to unlock these models again.
            </p>
          )}
          {status === 'disabled' && (
            <p className="text-xs text-amber-300">
              Disabled — models on this provider stay locked until you enable it again.
            </p>
          )}

          {stored && (
            <div className="flex items-center gap-1 flex-wrap -ml-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={testKey.isPending}
                onClick={() => testKey.mutate()}
                className="gap-1"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', testKey.isPending && 'animate-spin')} />
                {testKey.isPending ? 'Testing…' : 'Test'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={toggleEnabled.isPending}
                onClick={() => toggleEnabled.mutate(!stored.enabled)}
              >
                {stored.enabled ? 'Disable' : 'Enable'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={clearKey.isPending}
                onClick={() => clearKey.mutate()}
                className="text-red-400 hover:text-red-300 gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor={`${provider}-key`}
              className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"
            >
              <KeyRound className="h-3 w-3" />
              {stored ? 'Replace with new key' : 'Add a key'}
            </label>
            <div className="flex gap-2">
              <Input
                id={`${provider}-key`}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={meta.placeholder}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                className="flex-1 font-mono text-sm"
              />
              <Button onClick={handleSave} disabled={!value.trim() || setKey.isPending}>
                {setKey.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground flex items-center justify-between gap-2 flex-wrap">
              <span>Encrypted before storage. Tested once on save to confirm auth.</span>
              <a
                href={meta.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground inline-flex items-center gap-1"
              >
                Get a key <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
