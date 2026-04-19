/**
 * Canon Validator Banner — shown on publish flows when the user is about to
 * commit content to a universe. Triggers vlm.canon.check and displays any
 * conflicts grouped by severity. Non-blocking by default; a `block`-severity
 * conflict surfaces a warning but the final publish gate is up to the parent.
 */
import { useEffect, useState } from 'react';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';

export interface CanonValidatorBannerProps {
  extractionId?: string;
  universeAddress?: string | null;
  targetId: string;
  autoRun?: boolean;
  onResult?: (passed: boolean, conflicts: any[]) => void;
}

const SEVERITY_STYLES = {
  info: 'bg-sky-500/15 text-sky-200 border-sky-500/30',
  warn: 'bg-amber-500/15 text-amber-200 border-amber-500/30',
  block: 'bg-rose-500/15 text-rose-200 border-rose-500/30',
} as const;

export function CanonValidatorBanner({
  extractionId,
  universeAddress,
  targetId,
  autoRun = false,
  onResult,
}: CanonValidatorBannerProps) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [conflicts, setConflicts] = useState<any[]>([]);
  const [passed, setPassed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!extractionId || !universeAddress) return;
    setState('running');
    setError(null);
    try {
      const res = await trpcClient.vlm.canon.check.mutate({
        extractionId,
        universeAddress,
        targetId,
      });
      setConflicts(res.conflicts ?? []);
      setPassed(Boolean(res.passed));
      setState('done');
      onResult?.(Boolean(res.passed), res.conflicts ?? []);
    } catch (err: any) {
      setError(err.message ?? 'Canon check failed');
      setState('error');
    }
  }

  useEffect(() => {
    if (autoRun && extractionId && universeAddress && state === 'idle') {
      void run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, extractionId, universeAddress]);

  if (!extractionId || !universeAddress) return null;

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Canon Consistency Check</h3>
          {state === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          ) : state === 'done' ? (
            passed ? (
              <Badge className="bg-emerald-500/15 text-emerald-300 border-emerald-500/40 border">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Passed
              </Badge>
            ) : (
              <Badge className="bg-rose-500/15 text-rose-300 border-rose-500/40 border">
                <AlertTriangle className="h-3 w-3 mr-1" /> Conflicts
              </Badge>
            )
          ) : null}
          <div className="flex-1" />
          <button
            type="button"
            className="text-xs text-primary hover:underline disabled:opacity-50"
            disabled={state === 'running'}
            onClick={run}
          >
            {state === 'idle' ? 'Run check' : state === 'done' ? 'Re-check' : 'Retry'}
          </button>
        </div>

        {state === 'error' && <p className="text-xs text-rose-400">{error}</p>}

        {state === 'done' && conflicts.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No continuity or rights conflicts detected.
          </p>
        )}

        {state === 'done' && conflicts.length > 0 && (
          <ul className="space-y-2">
            {conflicts.map((c: any, i: number) => (
              <li
                key={i}
                className={`text-xs p-2 rounded border ${SEVERITY_STYLES[c.severity as keyof typeof SEVERITY_STYLES] ?? ''}`}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px]">
                    {c.severity}
                  </Badge>
                  <span className="font-medium">{c.rule}</span>
                  {typeof c.sceneIndex === 'number' ? (
                    <span className="text-muted-foreground">· scene #{c.sceneIndex}</span>
                  ) : null}
                </div>
                <p className="mt-1">{c.message}</p>
                {c.evidence ? (
                  <p className="mt-1 italic text-muted-foreground">“{c.evidence}”</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
