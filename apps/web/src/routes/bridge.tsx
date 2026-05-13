/**
 * /bridge — Custodial bridge transfer history + reconciliation.
 *
 * Two panels:
 *   1. Public reconciliation snapshot (ledger vs vault on each chain).
 *      Anyone can pull this — it's derivable from chain reads.
 *   2. The authenticated user's transfer history (requires SIWE session).
 *
 * Refreshes every 30s for parity with the /api/bridge/reconcile cache TTL.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, ArrowRightLeft, ShieldCheck, AlertTriangle } from 'lucide-react';

export const Route = createFileRoute('/bridge')({
  component: BridgePage,
});

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';

interface ReconRow {
  direction: 'sol_to_evm' | 'evm_to_sol';
  ledgerLockedBaseUnits: string;
  vaultBalanceBaseUnits: string;
  driftBaseUnits: string;
  driftPositive: boolean;
  intentCount: number;
}

interface HistoryItem {
  id: string;
  direction: 'sol_to_evm' | 'evm_to_sol';
  amountBaseUnits: string;
  recipient: string;
  state: 'pending_source' | 'pending_destination' | 'completed' | 'failed';
  sourceTxRef: string | null;
  destinationTxRef: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

const ERC20_DECIMALS = 18;
const SPL_DECIMALS = 9;

function formatBaseUnits(
  amount: string,
  direction: ReconRow['direction'],
  leg: 'source' | 'vault'
): string {
  // sol_to_evm vault = SPL (9), ledger source = SPL.
  // evm_to_sol vault = ERC20 (18), ledger source = ERC20.
  const decimals = direction === 'sol_to_evm' ? SPL_DECIMALS : ERC20_DECIMALS;
  const big = BigInt(amount);
  const denom = BigInt(10) ** BigInt(decimals);
  const whole = big / denom;
  const frac = big % denom;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(decimals, '0').replace(/0+$/, '')}`;
}

function stateBadge(state: HistoryItem['state']) {
  const colors: Record<HistoryItem['state'], string> = {
    pending_source: 'bg-yellow-500/15 text-yellow-700',
    pending_destination: 'bg-blue-500/15 text-blue-700',
    completed: 'bg-emerald-500/15 text-emerald-700',
    failed: 'bg-red-500/15 text-red-700',
  };
  return <Badge className={colors[state]}>{state.replace('_', ' ')}</Badge>;
}

function shortHash(s: string | null): string {
  if (!s) return '—';
  return s.length > 16 ? `${s.slice(0, 8)}…${s.slice(-6)}` : s;
}

function explorerSolTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}
function explorerEvmTx(hash: string): string {
  return `https://sepolia.etherscan.io/tx/${hash}`;
}

function BridgePage() {
  const [recon, setRecon] = useState<ReconRow[] | null>(null);
  const [reconError, setReconError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Reconciliation — public; renders even without a session.
      try {
        const r = await fetch(`${SERVER_URL}/api/bridge/reconcile`);
        if (r.ok) {
          const j = await r.json();
          if (!cancelled) {
            setRecon(j.results as ReconRow[]);
            setReconError(null);
          }
        } else if (r.status === 503) {
          if (!cancelled) setReconError('Bridge not configured on this server.');
        } else {
          if (!cancelled) setReconError(`reconcile failed: HTTP ${r.status}`);
        }
      } catch (err) {
        if (!cancelled) setReconError(err instanceof Error ? err.message : 'reconcile failed');
      }

      // History — requires auth. Fails silently for anonymous visitors.
      try {
        const h = await fetch(`${SERVER_URL}/api/bridge/history`, { credentials: 'include' });
        if (h.ok) {
          const j = await h.json();
          if (!cancelled) {
            setHistory((j.items as HistoryItem[]) ?? []);
            setHistoryError(null);
          }
        } else if (h.status === 401) {
          if (!cancelled) setHistoryError('Sign in to see your transfer history.');
        } else {
          if (!cancelled) setHistoryError(`history failed: HTTP ${h.status}`);
        }
      } catch (err) {
        if (!cancelled) setHistoryError(err instanceof Error ? err.message : 'history failed');
      }
    }
    void load();
    const t = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  return (
    <div className="container mx-auto max-w-5xl space-y-6 py-8">
      <div className="flex items-center gap-3">
        <ArrowRightLeft className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-semibold">$LOAR cross-chain bridge</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Custodial lock-and-mint between Solana and Sepolia. Wormhole NTT path is the v2 target.
      </p>

      {/* Reconciliation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Vault reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent>
          {reconError ? (
            <p className="text-sm text-muted-foreground">{reconError}</p>
          ) : !recon ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4">Direction</th>
                    <th className="py-1 pr-4">Ledger locked</th>
                    <th className="py-1 pr-4">Vault balance</th>
                    <th className="py-1 pr-4">Drift</th>
                    <th className="py-1 pr-4">Intents</th>
                  </tr>
                </thead>
                <tbody>
                  {recon.map((r) => (
                    <tr key={r.direction} className="border-t">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {r.direction.replace('_', ' → ')}
                      </td>
                      <td className="py-2 pr-4">
                        {formatBaseUnits(r.ledgerLockedBaseUnits, r.direction, 'source')} LOAR
                      </td>
                      <td className="py-2 pr-4">
                        {formatBaseUnits(r.vaultBalanceBaseUnits, r.direction, 'vault')} LOAR
                      </td>
                      <td className="py-2 pr-4">
                        {BigInt(r.driftBaseUnits) === 0n ? (
                          <span className="text-emerald-700">parity ✓</span>
                        ) : r.driftPositive ? (
                          <span className="text-yellow-700">
                            +
                            {formatBaseUnits(
                              r.driftBaseUnits.replace(/^-/, ''),
                              r.direction,
                              'vault'
                            )}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red-700">
                            <AlertTriangle className="h-3 w-3" />
                            {formatBaseUnits(
                              r.driftBaseUnits.replace(/^-/, ''),
                              r.direction,
                              'vault'
                            )}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4">{r.intentCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your transfers</CardTitle>
        </CardHeader>
        <CardContent>
          {historyError ? (
            <p className="text-sm text-muted-foreground">{historyError}</p>
          ) : history === null ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bridge transfers yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-4">When</th>
                    <th className="py-1 pr-4">Direction</th>
                    <th className="py-1 pr-4">Amount</th>
                    <th className="py-1 pr-4">State</th>
                    <th className="py-1 pr-4">Source tx</th>
                    <th className="py-1 pr-4">Dest tx</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => {
                    const sourceIsSol = h.direction === 'sol_to_evm';
                    return (
                      <tr key={h.id} className="border-t">
                        <td className="py-2 pr-4 text-xs text-muted-foreground">
                          {new Date(h.createdAt).toLocaleString()}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {h.direction.replace('_', ' → ')}
                        </td>
                        <td className="py-2 pr-4">
                          {formatBaseUnits(h.amountBaseUnits, h.direction, 'source')} LOAR
                        </td>
                        <td className="py-2 pr-4">{stateBadge(h.state)}</td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {h.sourceTxRef ? (
                            <a
                              className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                              target="_blank"
                              rel="noopener noreferrer"
                              href={
                                sourceIsSol
                                  ? explorerSolTx(h.sourceTxRef)
                                  : explorerEvmTx(h.sourceTxRef)
                              }
                            >
                              {shortHash(h.sourceTxRef)}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">
                          {h.destinationTxRef ? (
                            <a
                              className="inline-flex items-center gap-1 text-blue-700 hover:underline"
                              target="_blank"
                              rel="noopener noreferrer"
                              href={
                                sourceIsSol
                                  ? explorerEvmTx(h.destinationTxRef)
                                  : explorerSolTx(h.destinationTxRef)
                              }
                            >
                              {shortHash(h.destinationTxRef)}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
