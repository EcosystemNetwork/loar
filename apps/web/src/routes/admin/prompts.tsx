/**
 * /admin/prompts — the platform prompt corpus.
 *
 * Every user-submitted generation prompt, captured server-side by
 * `capturePrompt()` (apps/server/src/services/prompt-log) at the
 * `sanitizePrompt()` choke point that all generation routes pass through.
 *
 * Browse + filter + substring search + headline stats + NDJSON export.
 * Wallet-gated twice: route guard here + `adminProcedure` on every call.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useQuery, useMutation, keepPreviousData } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Database, Download, Loader2, RefreshCw, Search, Shield, X } from 'lucide-react';

export const Route = createFileRoute('/admin/prompts')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/prompts' } });
    }
  },
  component: AdminPromptsPage,
});

const KINDS = ['video', 'image', 'audio', 'threed', 'text', 'edit', 'other'] as const;
type Kind = (typeof KINDS)[number];

function useIsAdmin() {
  const { isAuthenticated, isAuthenticating, address } = useWalletAuth();
  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());
  return { isAuthenticated, isAuthenticating, isAdmin };
}

function fmtTs(ts: unknown): string {
  if (!ts) return '—';
  const d = new Date(ts as string);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toISOString().replace('T', ' ').slice(0, 19);
}

function AdminPromptsPage() {
  const { isAuthenticating, isAuthenticated, isAdmin } = useIsAdmin();
  const gated = isAuthenticated && isAdmin;

  const [kind, setKind] = useState<Kind | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [userId, setUserId] = useState('');
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);

  const cursor = cursorStack[cursorStack.length - 1];

  const statsQuery = useQuery({
    queryKey: ['admin.prompts.stats'],
    queryFn: () => trpcClient.admin.prompts.stats.query({ days: 30 }),
    enabled: gated,
    staleTime: 60_000,
  });

  const listQuery = useQuery({
    queryKey: ['admin.prompts.list', kind, search, userId, cursor],
    queryFn: () =>
      trpcClient.admin.prompts.list.query({
        limit: 50,
        kind: kind ?? undefined,
        search: search.trim() || undefined,
        userId: userId.trim() || undefined,
        cursor: cursor ?? undefined,
      }),
    enabled: gated,
    placeholderData: keepPreviousData,
  });

  const exportMut = useMutation({
    mutationFn: () =>
      trpcClient.admin.prompts.export.mutate({
        kind: kind ?? undefined,
        limit: 50_000,
      }),
    onSuccess: (res) => {
      const blob = new Blob([res.ndjson], { type: 'application/x-ndjson' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loar-prompts-${kind ?? 'all'}-${new Date().toISOString().slice(0, 10)}.ndjson`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  const items = (listQuery.data?.items ?? []) as Record<string, unknown>[];
  const nextCursor = listQuery.data?.nextCursor as string | undefined;
  const searching = !!search.trim() || !!userId.trim();

  const resetPaging = () => setCursorStack([]);

  const applySearch = () => {
    setSearch(searchInput);
    resetPaging();
  };

  const byKind = useMemo(() => {
    const m = new Map<string, number>();
    (statsQuery.data?.byKind ?? []).forEach((r) => m.set(r.kind, r.count));
    return m;
  }, [statsQuery.data]);

  if (isAuthenticating) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!isAuthenticated) return null;
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="space-y-2 text-center">
          <Shield className="mx-auto h-12 w-12 text-red-400" />
          <h2 className="text-xl font-bold">Unauthorized</h2>
          <p className="text-sm text-muted-foreground">
            Your wallet address does not have admin access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Database className="h-6 w-6" /> Prompt Corpus
          </h1>
          <p className="text-sm text-muted-foreground">
            Every user-submitted generation prompt on the platform. Captured at the sanitize step,
            so all generation routes are covered.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => exportMut.mutate()}
            disabled={exportMut.isPending}
          >
            {exportMut.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Export NDJSON
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              listQuery.refetch();
              statsQuery.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* ── Stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total prompts"
          value={statsQuery.data?.total}
          loading={statsQuery.isLoading}
        />
        <StatCard
          label="Last 30d"
          value={statsQuery.data?.windowTotal}
          loading={statsQuery.isLoading}
        />
        <StatCard
          label="Unique users (30d)"
          value={statsQuery.data?.uniqueUsers}
          loading={statsQuery.isLoading}
        />
        <StatCard
          label="Peak day (30d)"
          value={
            statsQuery.data ? Math.max(0, ...statsQuery.data.byDay.map((d) => d.count)) : undefined
          }
          loading={statsQuery.isLoading}
        />
      </div>

      {/* ── Filters ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant={kind === null ? 'default' : 'outline'}
              onClick={() => {
                setKind(null);
                resetPaging();
              }}
            >
              All
            </Button>
            {KINDS.map((k) => (
              <Button
                key={k}
                size="sm"
                variant={kind === k ? 'default' : 'outline'}
                onClick={() => {
                  setKind(k);
                  resetPaging();
                }}
              >
                {k}
                {byKind.has(k) && (
                  <span className="ml-1.5 text-xs opacity-60">
                    {byKind.get(k)!.toLocaleString()}
                  </span>
                )}
              </Button>
            ))}
          </div>
          <div className="flex flex-1 items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted-foreground">Search prompt text</label>
              <div className="flex gap-2">
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applySearch()}
                  placeholder="substring match…"
                  className="h-9"
                />
                <Button size="sm" variant="secondary" onClick={applySearch}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="w-64">
              <label className="mb-1 block text-xs text-muted-foreground">
                User (wallet address)
              </label>
              <Input
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  resetPaging();
                }}
                placeholder="0x…"
                className="h-9 font-mono text-xs"
              />
            </div>
            {(search || userId) && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setSearch('');
                  setSearchInput('');
                  setUserId('');
                  resetPaging();
                }}
              >
                <X className="mr-1 h-4 w-4" /> Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ── Table ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3">
          <CardTitle className="text-base">
            {listQuery.isFetching
              ? 'Loading…'
              : `${items.length} row${items.length === 1 ? '' : 's'}`}
            {searching && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                (search results are not paginated)
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {listQuery.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : !items.length ? (
            <div className="py-8 text-center text-sm text-muted-foreground">No prompts found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-2 pr-4">Time</th>
                  <th className="pr-4">Kind</th>
                  <th className="pr-4">User</th>
                  <th className="pr-4">Prompt</th>
                  <th className="pr-4 text-right">Chars</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr
                    key={String(row.id)}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                    onClick={() => setSelected(row)}
                  >
                    <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs">
                      {fmtTs(row.createdAt)}
                    </td>
                    <td className="pr-4">
                      <Badge variant="outline" className="text-xs">
                        {String(row.kind ?? 'other')}
                      </Badge>
                      {typeof row.field === 'string' && row.field !== 'prompt' && (
                        <span className="ml-1 text-xs text-muted-foreground">{row.field}</span>
                      )}
                    </td>
                    <td className="pr-4 font-mono text-xs">
                      {String(row.userId ?? '—').slice(0, 12)}…
                    </td>
                    <td className="max-w-md truncate pr-4">{String(row.prompt ?? '')}</td>
                    <td className="pr-4 text-right text-xs text-muted-foreground">
                      {Number(row.promptChars ?? 0).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!searching && (
            <div className="mt-4 flex items-center justify-between">
              <Button
                size="sm"
                variant="outline"
                disabled={cursorStack.length === 0 || listQuery.isFetching}
                onClick={() => setCursorStack((s) => s.slice(0, -1))}
              >
                ← Prev
              </Button>
              <span className="text-xs text-muted-foreground">Page {cursorStack.length + 1}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={!nextCursor || listQuery.isFetching}
                onClick={() => nextCursor && setCursorStack((s) => [...s, nextCursor])}
              >
                Next →
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {selected && <PromptDetail row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StatCard({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-semibold">
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : value == null ? (
            '—'
          ) : (
            value.toLocaleString()
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PromptDetail({ row, onClose }: { row: Record<string, unknown>; onClose: () => void }) {
  const fields: [string, unknown][] = [
    ['id', row.id],
    ['createdAt', row.createdAt],
    ['userId', row.userId],
    ['kind', row.kind],
    ['field', row.field],
    ['route', row.route],
    ['model', row.model],
    ['provider', row.provider],
    ['universeAddress', row.universeAddress],
    ['entityId', row.entityId],
    ['apiKeyId', row.apiKeyId],
    ['promptChars', row.promptChars],
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <Card
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Prompt detail</CardTitle>
          <Button size="sm" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm">
            {String(row.prompt ?? '')}
          </pre>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {fields
              .filter(([, v]) => v != null && v !== '')
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate font-mono">{String(v)}</dd>
                </div>
              ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
