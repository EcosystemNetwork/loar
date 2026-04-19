/**
 * Public status page.
 *
 * Reads the server's `/health` JSON and renders a human-readable board. No
 * auth — designed to be linkable from the footer ("Status") so users during
 * an incident can see which dependency is red without pinging support.
 *
 * Auto-refreshes every 30s. When the server itself is unreachable the page
 * degrades to a clear "api unreachable" banner rather than a broken spinner.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, AlertTriangle, CheckCircle2, CircleDot, Loader2, XCircle } from 'lucide-react';

export const Route = createFileRoute('/status')({
  component: StatusPage,
});

type CheckStatus = 'ok' | 'degraded' | 'not_configured' | 'not_initialized' | string;

interface HealthPayload {
  status: 'healthy' | 'degraded';
  service: string;
  version: string;
  timestamp: string;
  uptime: number;
  env: string;
  checks: Record<string, CheckStatus>;
  queue?: {
    healthy: boolean;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  circuitBreakers?: Record<string, { state: 'closed' | 'half_open' | 'open'; failures: number }>;
  pricing?: unknown;
}

function StatusPage() {
  const serverUrl = (import.meta.env.VITE_SERVER_URL as string | undefined) || '';
  const healthUrl = `${serverUrl}/health`;

  const { data, error, isFetching, isLoading } = useQuery<HealthPayload>({
    queryKey: ['public-health', healthUrl],
    queryFn: async () => {
      const res = await fetch(healthUrl, {
        headers: { accept: 'application/json' },
        credentials: 'omit',
      });
      if (!res.ok) throw new Error(`health returned ${res.status}`);
      return (await res.json()) as HealthPayload;
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  const overall = deriveOverall(data, Boolean(error));

  return (
    <div className="container mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-center gap-3">
        <Activity className="h-6 w-6" />
        <h1 className="text-2xl font-bold">LOAR Status</h1>
      </div>

      {/* Hero banner */}
      <Card>
        <CardContent className="flex items-start gap-4 p-6">
          <OverallIcon overall={overall} />
          <div className="flex-1">
            <p className="text-xl font-semibold">{overallHeadline(overall)}</p>
            <p className="text-muted-foreground mt-1 text-sm">{overallSub(overall)}</p>
            {data && (
              <p className="text-muted-foreground mt-2 text-xs">
                Server v{data.version} · env <code>{data.env}</code> · uptime{' '}
                {formatUptime(data.uptime)} · last checked{' '}
                {new Date(data.timestamp).toLocaleTimeString()}
              </p>
            )}
            {isFetching && !isLoading && (
              <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" /> Refreshing…
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Dependencies */}
      {data && (
        <Card>
          <CardHeader>
            <CardTitle>Dependencies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(data.checks).map(([name, value]) => (
              <DependencyRow key={name} name={name} status={value} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Circuit breakers */}
      {data?.circuitBreakers && Object.keys(data.circuitBreakers).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>External providers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-muted-foreground mb-2 text-sm">
              When a provider fails repeatedly, its circuit opens and we fail fast or fall back. An
              open circuit here means some features may be temporarily unavailable.
            </p>
            {Object.entries(data.circuitBreakers).map(([name, cb]) => (
              <BreakerRow key={name} name={name} state={cb.state} failures={cb.failures} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Queue */}
      {data?.queue && (
        <Card>
          <CardHeader>
            <CardTitle>Generation queue</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <QueueStat label="Active" value={data.queue.active} />
              <QueueStat label="Waiting" value={data.queue.waiting} />
              <QueueStat label="Delayed" value={data.queue.delayed} />
              <QueueStat label="Completed" value={data.queue.completed} />
              <QueueStat
                label="Failed"
                value={data.queue.failed}
                highlight={data.queue.failed > 0}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {error && !data && (
        <Card>
          <CardContent className="flex items-center gap-3 p-6">
            <XCircle className="text-destructive h-5 w-5" />
            <p className="text-sm">
              Could not reach the API at <code>{healthUrl}</code>. The site may be in the middle of
              a deploy, or there is a platform incident.
            </p>
          </CardContent>
        </Card>
      )}

      <p className="text-muted-foreground text-xs">
        This page auto-refreshes every 30 seconds. For deeper operational detail, admins can visit{' '}
        <a href="/admin/ops" className="underline">
          /admin/ops
        </a>
        .
      </p>
    </div>
  );
}

type Overall = 'operational' | 'degraded' | 'major-outage' | 'loading';

function deriveOverall(data: HealthPayload | undefined, apiUnreachable: boolean): Overall {
  if (apiUnreachable) return 'major-outage';
  if (!data) return 'loading';
  if (data.status === 'healthy') return 'operational';
  return 'degraded';
}

function overallHeadline(overall: Overall): string {
  switch (overall) {
    case 'operational':
      return 'All systems operational';
    case 'degraded':
      return 'Some systems degraded';
    case 'major-outage':
      return 'API unreachable';
    case 'loading':
      return 'Checking systems…';
  }
}

function overallSub(overall: Overall): string {
  switch (overall) {
    case 'operational':
      return 'Generation, storage, auth, and on-chain reads are healthy.';
    case 'degraded':
      return 'One or more dependencies are degraded. Some features may be slower or unavailable.';
    case 'major-outage':
      return 'The server health check is not responding. This is likely a platform incident or a deploy in progress.';
    case 'loading':
      return '';
  }
}

function OverallIcon({ overall }: { overall: Overall }) {
  switch (overall) {
    case 'operational':
      return <CheckCircle2 className="mt-1 h-6 w-6 text-green-500" />;
    case 'degraded':
      return <AlertTriangle className="mt-1 h-6 w-6 text-yellow-500" />;
    case 'major-outage':
      return <XCircle className="text-destructive mt-1 h-6 w-6" />;
    case 'loading':
      return <Loader2 className="mt-1 h-6 w-6 animate-spin" />;
  }
}

function DependencyRow({ name, status }: { name: string; status: CheckStatus }) {
  const label = prettyName(name);
  const variant = status === 'ok' ? 'default' : status === 'degraded' ? 'destructive' : 'secondary';
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <span className="font-medium capitalize">{label}</span>
      <Badge variant={variant}>{status}</Badge>
    </div>
  );
}

function BreakerRow({
  name,
  state,
  failures,
}: {
  name: string;
  state: 'closed' | 'half_open' | 'open';
  failures: number;
}) {
  const variant =
    state === 'closed' ? 'default' : state === 'half_open' ? 'secondary' : 'destructive';
  const humanState =
    state === 'closed' ? 'healthy' : state === 'half_open' ? 'probing' : 'unavailable';
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="flex items-center gap-2">
        <CircleDot className="h-4 w-4" />
        <span className="font-medium">{prettyName(name)}</span>
      </div>
      <div className="flex items-center gap-3">
        {failures > 0 && (
          <span className="text-muted-foreground text-xs">
            {failures} recent failure{failures === 1 ? '' : 's'}
          </span>
        )}
        <Badge variant={variant}>{humanState}</Badge>
      </div>
    </div>
  );
}

function QueueStat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-md border p-3 text-center ${highlight ? 'border-destructive' : ''}`}>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value < 0 ? '—' : value}</p>
    </div>
  );
}

function prettyName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}
