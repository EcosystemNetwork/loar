/**
 * /lab/zai/diagnostic — Z.AI endpoint smoke harness.
 *
 * Pings every Z.AI surface with a tiny payload and reports pass/fail +
 * truncated raw response sample so you can spot when the live response
 * shape differs from what the adapter parses.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle, MinusCircle, Loader2, Stethoscope } from 'lucide-react';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const Route = createFileRoute('/lab/zai/diagnostic')({
  component: ZaiDiagnosticPage,
});

interface DiagnosticStep {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  latencyMs: number;
  detail?: string;
  sample?: unknown;
}

interface DiagnosticResult {
  ok: boolean;
  platformConfigured: boolean;
  usingByok: boolean;
  summary?: { total: number; passes: number; fails: number };
  steps: DiagnosticStep[];
}

function ZaiDiagnosticPage() {
  const { address } = useWalletAuth();
  const run = useMutation({
    mutationFn: () => trpcClient.zai.diagnostic.mutate() as Promise<DiagnosticResult>,
  });

  if (!address) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Z.AI Diagnostic</h1>
        <p className="text-muted-foreground mt-2">Connect a wallet to run the smoke harness.</p>
      </div>
    );
  }

  const result = run.data;

  return (
    <div className="container mx-auto max-w-3xl px-4 py-10 space-y-6">
      <div className="flex items-center justify-between">
        <Link
          to="/lab/zai"
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Z.AI Lab
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Stethoscope className="h-5 w-5 text-violet-400" />
            Endpoint smoke harness
            {result && (
              <Badge
                className={
                  result.ok
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                }
              >
                {result.ok ? 'all green' : `${result.summary?.fails ?? 0} failing`}
              </Badge>
            )}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Pings every Z.AI surface with a minimal payload. Failures surface the live error message
            and a truncated response sample — match that against the parser in{' '}
            <code className="text-xs">services/zai.ts</code> if anything's red.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> Running…
              </>
            ) : result ? (
              'Re-run'
            ) : (
              'Run diagnostic'
            )}
          </Button>

          {run.error && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
              <strong className="text-rose-300">Diagnostic itself failed:</strong>{' '}
              {run.error instanceof Error ? run.error.message : String(run.error)}
            </div>
          )}

          {result && (
            <>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <Stat
                  label="Platform key"
                  value={result.platformConfigured ? 'present' : 'absent'}
                  good={result.platformConfigured}
                />
                <Stat
                  label="BYOK"
                  value={result.usingByok ? 'in use' : 'not set'}
                  good={result.usingByok}
                />
                <Stat
                  label="Pass / Total"
                  value={`${result.summary?.passes ?? 0} / ${result.summary?.total ?? 0}`}
                  good={result.ok}
                />
              </div>

              <div className="space-y-2">
                {result.steps.map((step, i) => (
                  <StepRow key={i} step={step} />
                ))}
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Raw JSON</summary>
                <pre className="mt-2 p-3 rounded bg-zinc-950/60 border border-white/10 overflow-x-auto">
                  {JSON.stringify(result, null, 2)}
                </pre>
              </details>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded border border-white/10 p-2">
      <div className="uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={good ? 'text-emerald-300' : 'text-zinc-300'}>{value}</div>
    </div>
  );
}

function StepRow({ step }: { step: DiagnosticStep }) {
  const Icon =
    step.status === 'pass' ? CheckCircle2 : step.status === 'fail' ? XCircle : MinusCircle;
  const tone =
    step.status === 'pass'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-200'
      : step.status === 'fail'
        ? 'border-rose-500/30 bg-rose-500/5 text-rose-200'
        : 'border-zinc-700/50 bg-zinc-900/40 text-zinc-300';
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <span className="font-mono text-sm">{step.name}</span>
        </div>
        <span className="text-xs opacity-70">{step.latencyMs}ms</span>
      </div>
      {step.detail && (
        <div className="mt-2 text-xs font-mono whitespace-pre-wrap break-words">{step.detail}</div>
      )}
      {step.sample !== undefined && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer opacity-70">Response sample</summary>
          <pre className="mt-1 p-2 rounded bg-black/40 overflow-x-auto">
            {typeof step.sample === 'string' ? step.sample : JSON.stringify(step.sample, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
