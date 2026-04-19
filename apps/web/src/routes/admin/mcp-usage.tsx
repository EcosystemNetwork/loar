/**
 * Admin MCP Usage Dashboard — observability for the MCP agent integration.
 *
 * Surfaces data recorded by the tRPC cost-scope middleware (see
 * apps/server/src/lib/trpc.ts) tagged with keyType and endUserAddress.
 *
 * See docs/prd-mcp-integration.md §3. Wallet-gated twice: route guard +
 * adminProcedure on the server.
 */
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpcClient } from '@/utils/trpc';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Key,
  Loader2,
  RefreshCw,
  Users,
  Webhook,
} from 'lucide-react';

export const Route = createFileRoute('/admin/mcp-usage')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/mcp-usage' } });
    }
  },
  component: McpUsageDashboard,
});

const WINDOW_OPTIONS = [
  { label: '1h', hours: 1 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
];

function McpUsageDashboard() {
  const [windowHours, setWindowHours] = useState(24);
  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(null);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);

  const topKeysQuery = useQuery({
    queryKey: ['admin.mcpUsage.topKeys', windowHours],
    queryFn: () =>
      trpcClient.admin.mcpUsage.topKeys.query({
        windowHours,
        keyType: 'mcp_server',
        limit: 50,
      }),
  });

  const topEndUsersQuery = useQuery({
    queryKey: ['admin.mcpUsage.topEndUsers', windowHours],
    queryFn: () => trpcClient.admin.mcpUsage.topEndUsers.query({ windowHours, limit: 50 }),
  });

  const webhookHealthQuery = useQuery({
    queryKey: ['admin.mcpUsage.webhookHealth'],
    queryFn: () => trpcClient.admin.mcpUsage.webhookHealth.query(),
    refetchInterval: 30_000,
  });

  const recentCallsQuery = useQuery({
    queryKey: ['admin.mcpUsage.recentCalls', selectedKeyId, selectedAddress],
    queryFn: () =>
      trpcClient.admin.mcpUsage.recentCalls.query({
        limit: 100,
        apiKeyId: selectedKeyId ?? undefined,
        endUserAddress: selectedAddress ?? undefined,
      }),
    enabled: Boolean(selectedKeyId || selectedAddress),
  });

  const refreshAll = () => {
    topKeysQuery.refetch();
    topEndUsersQuery.refetch();
    webhookHealthQuery.refetch();
    if (selectedKeyId || selectedAddress) recentCallsQuery.refetch();
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MCP Usage</h1>
          <p className="text-sm text-muted-foreground">
            Agent-integration observability. Data recorded per API-key-authed tRPC call.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {WINDOW_OPTIONS.map((opt) => (
            <Button
              key={opt.hours}
              size="sm"
              variant={windowHours === opt.hours ? 'default' : 'outline'}
              onClick={() => setWindowHours(opt.hours)}
            >
              {opt.label}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={refreshAll}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <WebhookHealthCard health={webhookHealthQuery.data} loading={webhookHealthQuery.isLoading} />

      <Tabs defaultValue="keys" className="space-y-4">
        <TabsList>
          <TabsTrigger value="keys" className="gap-2">
            <Key className="h-4 w-4" />
            Top MCP keys
          </TabsTrigger>
          <TabsTrigger value="endusers" className="gap-2">
            <Users className="h-4 w-4" />
            Top end-users
          </TabsTrigger>
          <TabsTrigger value="recent" className="gap-2">
            <Activity className="h-4 w-4" />
            Recent calls
          </TabsTrigger>
        </TabsList>

        <TabsContent value="keys">
          <TopKeysTable
            data={topKeysQuery.data}
            loading={topKeysQuery.isLoading}
            onSelectKey={(id) => {
              setSelectedKeyId(id);
              setSelectedAddress(null);
              document
                .querySelector('[data-tab="recent"]')
                ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            }}
          />
        </TabsContent>

        <TabsContent value="endusers">
          <TopEndUsersTable
            data={topEndUsersQuery.data}
            loading={topEndUsersQuery.isLoading}
            onSelectAddress={(addr) => {
              setSelectedAddress(addr);
              setSelectedKeyId(null);
            }}
          />
        </TabsContent>

        <TabsContent value="recent">
          <RecentCallsTable
            data={recentCallsQuery.data}
            loading={recentCallsQuery.isLoading}
            selectedKeyId={selectedKeyId}
            selectedAddress={selectedAddress}
            onClear={() => {
              setSelectedKeyId(null);
              setSelectedAddress(null);
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Webhook health card ────────────────────────────────────────────────

function WebhookHealthCard({ health, loading }: { health: any; loading: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Webhook className="h-4 w-4" />
          Webhook delivery health
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : !health?.enabled ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            Webhooks disabled — set{' '}
            <code className="rounded bg-muted px-1">WEBHOOK_SIGNING_SECRET</code> to enable.
          </div>
        ) : health.error ? (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            Queue error: {health.error}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Metric label="Waiting" value={health.waiting} />
            <Metric label="Active" value={health.active} />
            <Metric label="Completed" value={health.completed} />
            <Metric
              label="Failed"
              value={health.failed}
              tone={health.failed > 0 ? 'warn' : undefined}
            />
            <Metric label="Delayed" value={health.delayed} />
            <div className="col-span-2 flex items-center gap-2 sm:col-span-5">
              {health.healthy ? (
                <Badge variant="outline" className="gap-1 border-green-500/50 text-green-600">
                  <CheckCircle2 className="h-3 w-3" />
                  Healthy ({((health.failed / Math.max(1, health.completed)) * 100).toFixed(2)}%
                  fail rate)
                </Badge>
              ) : (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Degraded
                </Badge>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${tone === 'warn' ? 'text-yellow-500' : ''}`}>
        {value}
      </div>
    </div>
  );
}

// ── Top MCP keys ───────────────────────────────────────────────────────

function TopKeysTable({
  data,
  loading,
  onSelectKey,
}: {
  data: any;
  loading: boolean;
  onSelectKey: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top MCP-relay keys by call volume</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : !data?.entries?.length ? (
          <div className="text-sm text-muted-foreground">No MCP activity in window.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Key name</th>
                <th className="pr-4">Prefix</th>
                <th className="pr-4">Owner</th>
                <th className="pr-4 text-right">Calls</th>
                <th className="pr-4 text-right">Credits</th>
                <th className="pr-4 text-right">End-users</th>
                <th className="pr-4">Scopes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e: any) => (
                <tr key={e.apiKeyId} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{e.name}</td>
                  <td className="pr-4 font-mono text-xs">{e.keyPrefix}…</td>
                  <td className="pr-4 font-mono text-xs">{e.ownerUid.slice(0, 10)}…</td>
                  <td className="pr-4 text-right">{e.calls.toLocaleString()}</td>
                  <td className="pr-4 text-right">{e.creditsUsed.toLocaleString()}</td>
                  <td className="pr-4 text-right">{e.uniqueEndUsers}</td>
                  <td className="pr-4">
                    <div className="flex flex-wrap gap-1">
                      {e.permissions.slice(0, 3).map((p: string) => (
                        <Badge key={p} variant="outline" className="text-xs">
                          {p}
                        </Badge>
                      ))}
                      {e.permissions.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{e.permissions.length - 3}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => onSelectKey(e.apiKeyId)}>
                      View calls →
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

// ── Top end-users ──────────────────────────────────────────────────────

function TopEndUsersTable({
  data,
  loading,
  onSelectAddress,
}: {
  data: any;
  loading: boolean;
  onSelectAddress: (addr: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Top end-users by MCP-relayed calls</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : !data?.entries?.length ? (
          <div className="text-sm text-muted-foreground">
            No end-user attribution recorded. MCP relays must send
            <code className="mx-1 rounded bg-muted px-1">X-Loar-End-User-Address</code>
            for this view to populate.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">End-user address</th>
                <th className="pr-4 text-right">Calls</th>
                <th className="pr-4 text-right">Credits</th>
                <th className="pr-4 text-right">Distinct keys</th>
                <th className="pr-4 text-right">Distinct endpoints</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e: any) => (
                <tr key={e.address} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{e.address}</td>
                  <td className="pr-4 text-right">{e.calls.toLocaleString()}</td>
                  <td className="pr-4 text-right">{e.creditsUsed.toLocaleString()}</td>
                  <td className="pr-4 text-right">{e.uniqueKeys}</td>
                  <td className="pr-4 text-right">{e.endpoints}</td>
                  <td>
                    <Button size="sm" variant="ghost" onClick={() => onSelectAddress(e.address)}>
                      View calls →
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

// ── Recent calls ───────────────────────────────────────────────────────

function RecentCallsTable({
  data,
  loading,
  selectedKeyId,
  selectedAddress,
  onClear,
}: {
  data: any;
  loading: boolean;
  selectedKeyId: string | null;
  selectedAddress: string | null;
  onClear: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          Recent calls{' '}
          {selectedKeyId && (
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
              key {selectedKeyId.slice(0, 10)}…
            </span>
          )}
          {selectedAddress && (
            <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
              user {selectedAddress.slice(0, 10)}…
            </span>
          )}
        </CardTitle>
        {(selectedKeyId || selectedAddress) && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear filter
          </Button>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {!selectedKeyId && !selectedAddress ? (
          <div className="text-sm text-muted-foreground">
            Select a key or end-user from the other tabs to drill down.
          </div>
        ) : loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : !data?.entries?.length ? (
          <div className="text-sm text-muted-foreground">No calls.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Time</th>
                <th className="pr-4">Endpoint</th>
                <th className="pr-4">Key type</th>
                <th className="pr-4">End-user</th>
                <th className="pr-4 text-right">Credits</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e: any) => (
                <tr key={e.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs">{formatTimestamp(e.timestamp)}</td>
                  <td className="pr-4 font-mono text-xs">{e.endpoint}</td>
                  <td className="pr-4">
                    <Badge
                      variant={e.keyType === 'mcp_server' ? 'default' : 'outline'}
                      className="text-xs"
                    >
                      {e.keyType}
                    </Badge>
                  </td>
                  <td className="pr-4 font-mono text-xs">
                    {e.endUserAddress ? e.endUserAddress.slice(0, 10) + '…' : '—'}
                  </td>
                  <td className="pr-4 text-right">{e.creditsUsed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function formatTimestamp(ts: any): string {
  if (!ts) return '—';
  // Firestore Timestamp object (has ._seconds) or a JS Date / epoch ms
  const ms =
    typeof ts === 'number'
      ? ts
      : ts?._seconds
        ? ts._seconds * 1000
        : ts?.seconds
          ? ts.seconds * 1000
          : new Date(ts).getTime();
  if (!Number.isFinite(ms)) return String(ts);
  return new Date(ms).toISOString().slice(11, 19);
}
