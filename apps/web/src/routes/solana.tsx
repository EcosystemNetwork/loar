/**
 * /solana — Public Solana activity dashboard.
 *
 * Single-page snapshot of the on-chain state of LOAR's Solana stack:
 *   - Total universes / episodes / canon / cNFT mints
 *   - Recent activity feeds with direct Solana Explorer links
 *   - Treasury balance (live RPC read)
 *   - Demo program IDs + Bubblegum tree
 *
 * Data source: /api/solana/activity (Firestore mirrors written by the
 * apps/solana-indexer via Helius webhook + a live treasury balance read).
 * Refreshes every 10s so judges + visitors see continuous motion.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, Activity, Database, Sparkles, Wallet } from 'lucide-react';

export const Route = createFileRoute('/solana')({
  component: SolanaDashboard,
});

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000';
const CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as 'devnet' | 'mainnet-beta' | undefined) ?? 'devnet';

const PROGRAM_IDS = {
  universe: import.meta.env.VITE_UNIVERSE_PROGRAM_ID as string | undefined,
  episode: import.meta.env.VITE_EPISODE_PROGRAM_ID as string | undefined,
  payment: import.meta.env.VITE_PAYMENT_PROGRAM_ID as string | undefined,
};
const TREE_ADDR = import.meta.env.VITE_BUBBLEGUM_TREE_DEVNET as string | undefined;
const LOAR_MINT = import.meta.env.VITE_LOAR_MINT_DEVNET as string | undefined;

interface Activity {
  cluster: string;
  totals: {
    universes: number;
    episodes: number;
    canonEpisodes: number;
    cnftMints: number;
  };
  recent: {
    universes: Array<{
      universe: string;
      creator: string;
      visibility: string;
      createdSig: string;
    }>;
    episodes: Array<{
      episode: string;
      universe: string;
      title: string;
      creator: string;
      isCanon: boolean;
      mintedSig: string;
    }>;
    cnftMints: Array<{
      signature: string;
      assetId: string | null;
      leafOwner: string | null;
    }>;
  };
  treasury: { address: string | null; solBalance: number | null };
}

function explorerAddr(a: string): string {
  return `https://explorer.solana.com/address/${a}?cluster=${CLUSTER}`;
}
function explorerTx(s: string): string {
  return `https://explorer.solana.com/tx/${s}?cluster=${CLUSTER}`;
}
function trunc(s: string, lead = 4, tail = 4): string {
  return s && s.length > lead + tail + 1 ? `${s.slice(0, lead)}…${s.slice(-tail)}` : s;
}

function SolanaDashboard() {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const resp = await fetch(`${SERVER_URL}/api/solana/activity`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as Activity;
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'load failed');
      }
    }
    void load();
    const t = window.setInterval(load, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  if (!data && !error) {
    return (
      <div className="container mx-auto max-w-5xl py-16">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-6xl space-y-8 py-8">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-semibold">
            <span>◎ LOAR on Solana</span>
            <Badge variant="outline" className="text-xs uppercase tracking-wide">
              {CLUSTER}
            </Badge>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compressed-NFT episode mints, Token-2022 $LOAR, on-chain canon. Auto-refreshes every 10s
            from the indexer.
          </p>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Activity className="h-3 w-3 animate-pulse text-green-400" /> live
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-700 bg-red-950/30 p-3 text-sm text-red-300">
          Activity feed unavailable: {error}
        </div>
      )}

      {/* ── KPI tiles ────────────────────────────────────────────────────── */}
      {data && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Tile
            icon={<Database className="h-4 w-4" />}
            label="Universes"
            value={data.totals.universes}
          />
          <Tile
            icon={<Sparkles className="h-4 w-4" />}
            label="Episodes"
            value={data.totals.episodes}
          />
          <Tile
            icon={<Sparkles className="h-4 w-4 text-amber-400" />}
            label="Canon"
            value={data.totals.canonEpisodes}
          />
          <Tile
            icon={<Sparkles className="h-4 w-4 text-purple-400" />}
            label="cNFT mints"
            value={data.totals.cnftMints}
          />
        </div>
      )}

      {/* ── Programs ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deployed programs</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <ProgramRow label="universe" address={PROGRAM_IDS.universe} />
          <ProgramRow label="episode" address={PROGRAM_IDS.episode} />
          <ProgramRow label="payment" address={PROGRAM_IDS.payment} />
          <ProgramRow label="$LOAR mint (Token-2022)" address={LOAR_MINT} />
          <ProgramRow label="Bubblegum tree" address={TREE_ADDR} />
          {data?.treasury.address && (
            <ProgramRow
              label="treasury"
              address={data.treasury.address}
              extra={
                data.treasury.solBalance !== null
                  ? `${data.treasury.solBalance.toFixed(3)} SOL`
                  : undefined
              }
            />
          )}
        </CardContent>
      </Card>

      {/* ── Recent universes ─────────────────────────────────────────────── */}
      <ActivityList
        title="Recent Universes"
        rows={data?.recent.universes ?? []}
        empty="No universes yet. Be the first."
        render={(u) => (
          <li
            key={u.universe}
            className="flex items-center justify-between border-b border-border/40 py-2 last:border-0"
          >
            <div className="flex items-center gap-3">
              <Badge
                variant={u.visibility === 'Public' ? 'default' : 'outline'}
                className="text-xs"
              >
                {u.visibility}
              </Badge>
              <a
                href={explorerAddr(u.universe)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-sm hover:text-purple-400"
              >
                {trunc(u.universe)} <ExternalLink className="inline h-3 w-3" />
              </a>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              by {trunc(u.creator, 3, 3)}
            </span>
          </li>
        )}
      />

      {/* ── Recent episodes ──────────────────────────────────────────────── */}
      <ActivityList
        title="Recent Episodes"
        rows={data?.recent.episodes ?? []}
        empty="No episodes minted yet."
        render={(e) => (
          <li
            key={e.episode}
            className="flex items-center justify-between border-b border-border/40 py-2 last:border-0"
          >
            <div className="min-w-0 flex-1 truncate">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{e.title || trunc(e.episode)}</span>
                {e.isCanon && (
                  <Badge
                    className="border-amber-500/40 bg-amber-500/10 text-xs text-amber-400"
                    variant="outline"
                  >
                    canon
                  </Badge>
                )}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                under{' '}
                <a
                  href={explorerAddr(e.universe)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-purple-400"
                >
                  {trunc(e.universe)}
                </a>
              </div>
            </div>
            <a
              href={explorerTx(e.mintedSig)}
              target="_blank"
              rel="noreferrer"
              className="ml-3 font-mono text-xs text-muted-foreground hover:text-purple-400"
            >
              {trunc(e.mintedSig)} <ExternalLink className="inline h-3 w-3" />
            </a>
          </li>
        )}
      />

      {/* ── Recent cNFT mints ────────────────────────────────────────────── */}
      <ActivityList
        title="Recent cNFT Mints (Bubblegum)"
        rows={data?.recent.cnftMints ?? []}
        empty="No cNFT mints yet — Helius webhook may not be connected."
        render={(m) => (
          <li
            key={m.signature}
            className="flex items-center justify-between border-b border-border/40 py-2 last:border-0"
          >
            <a
              href={m.assetId ? explorerAddr(m.assetId) : explorerTx(m.signature)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-sm hover:text-purple-400"
            >
              {m.assetId ? trunc(m.assetId) : trunc(m.signature)}{' '}
              <ExternalLink className="inline h-3 w-3" />
            </a>
            <span className="font-mono text-xs text-muted-foreground">
              {m.leafOwner ? `→ ${trunc(m.leafOwner, 3, 3)}` : ''}
            </span>
          </li>
        )}
      />

      <p className="pt-8 text-center text-xs text-muted-foreground">
        Built for{' '}
        <a
          href="https://colosseum.com/frontier"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-purple-400"
        >
          Colosseum Frontier
        </a>
        . Code at{' '}
        <a
          href="https://github.com/EcosystemNetwork/loar"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-purple-400"
        >
          github.com/EcosystemNetwork/loar
        </a>
        .
      </p>
    </div>
  );
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          {icon} {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</div>
      </CardContent>
    </Card>
  );
}

function ProgramRow({
  label,
  address,
  extra,
}: {
  label: string;
  address?: string;
  extra?: string;
}) {
  if (!address) {
    return (
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-muted-foreground italic">not configured</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <a
        href={explorerAddr(address)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-mono text-xs hover:text-purple-400"
      >
        {trunc(address)} {extra && <span className="text-muted-foreground">· {extra}</span>}
        <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  );
}

function ActivityList<T>({
  title,
  rows,
  empty,
  render,
}: {
  title: string;
  rows: T[];
  empty: string;
  render: (row: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-muted-foreground" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-0">{rows.map(render)}</ul>
        )}
      </CardContent>
    </Card>
  );
}
