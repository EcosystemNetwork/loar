/**
 * Testnet transparency page.
 *
 * Linked from the sitewide testnet banner. Tells visitors what's real,
 * what's simulated, and where to get test funds + report bugs. Lives
 * separately from /docs (technical) and /status (live health).
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { CheckCircle2, AlertTriangle, Beaker, ExternalLink } from 'lucide-react';

export const Route = createFileRoute('/testnet')({
  component: TestnetPage,
});

type StatusRow = { label: string; status: 'live' | 'beta' | 'limited' | 'planned'; note?: string };

const FEATURE_MATRIX: { group: string; rows: StatusRow[] }[] = [
  {
    group: 'Wallet & Identity',
    rows: [
      { label: 'Sign-In with Ethereum (SIWE)', status: 'live' },
      { label: 'External wallets (MetaMask, WalletConnect, Coinbase)', status: 'live' },
      { label: 'In-app wallet (email / passkey via Circle)', status: 'beta' },
      { label: 'Mobile app', status: 'beta', note: 'Internal builds; public stores TBD' },
    ],
  },
  {
    group: 'Universes & Content',
    rows: [
      { label: 'Create a universe (private or public)', status: 'live' },
      { label: 'Add nodes / characters / entities (wiki)', status: 'live' },
      { label: 'AI image + video generation', status: 'live' },
      { label: 'Talking-scene + animate flows', status: 'beta' },
      { label: 'IPFS storage (Pinata + Lighthouse)', status: 'live' },
      { label: 'Episode minting + Netflix-style canon rail', status: 'live' },
    ],
  },
  {
    group: 'Tokens & Governance',
    rows: [
      { label: '$LOAR testnet faucet', status: 'live' },
      { label: 'Per-universe governance token launch', status: 'beta' },
      { label: 'Bonding curve buy / sell', status: 'beta' },
      { label: 'Per-universe Governor + Timelock', status: 'beta' },
      { label: 'Multi-sig (Gnosis Safe) admin path', status: 'planned', note: 'Mainnet only' },
    ],
  },
  {
    group: 'Marketplaces',
    rows: [
      { label: 'Slop market (NFT trading)', status: 'beta' },
      { label: 'Canon submission marketplace', status: 'beta' },
      { label: 'Story bounties', status: 'beta' },
      { label: 'Ad placement / sponsored slots', status: 'planned' },
      { label: 'Subscription tiers', status: 'planned' },
    ],
  },
  {
    group: 'Trust & Safety',
    rows: [
      { label: 'Content flagging + admin review queue', status: 'live' },
      { label: 'DMCA takedown intake (/dmca)', status: 'live' },
      { label: 'DMCA counter-notice + auto-restore', status: 'live' },
      { label: 'Immutable audit log', status: 'live' },
    ],
  },
];

function StatusBadge({ status }: { status: StatusRow['status'] }) {
  const styles: Record<StatusRow['status'], string> = {
    live: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    beta: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
    limited: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    planned: 'bg-white/5 text-muted-foreground border-white/10',
  };
  const label: Record<StatusRow['status'], string> = {
    live: 'Live',
    beta: 'Beta',
    limited: 'Limited',
    planned: 'Planned',
  };
  return (
    <span
      className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded border font-medium ${styles[status]}`}
    >
      {label[status]}
    </span>
  );
}

function TestnetPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Beaker className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">You're on testnet</h1>
            <p className="text-sm text-muted-foreground">
              LOAR is in public beta on Ethereum Sepolia and Base Sepolia.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 my-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-200/90">
              <p className="font-semibold text-amber-300 mb-1">No real value</p>
              <p>
                ETH and $LOAR on this deployment are testnet tokens. They have no monetary value and
                cannot be moved to mainnet. Anything you mint, buy, or trade here is for testing
                only. The deployment may be reset without notice.
              </p>
            </div>
          </div>
        </div>

        <section className="space-y-3 mb-10">
          <h2 className="text-xl font-semibold">What's running where</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <p className="font-semibold mb-1">Ethereum Sepolia</p>
              <p className="text-muted-foreground text-xs">Chain ID 11155111</p>
              <p className="text-muted-foreground text-xs mt-2">
                Universe creation, governance tokens, $LOAR.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
              <p className="font-semibold mb-1">Base Sepolia</p>
              <p className="text-muted-foreground text-xs">Chain ID 84532</p>
              <p className="text-muted-foreground text-xs mt-2">
                Secondary chain for cross-chain experiments.
              </p>
            </div>
          </div>
        </section>

        <section className="space-y-6 mb-10">
          <h2 className="text-xl font-semibold">Feature status</h2>
          <p className="text-sm text-muted-foreground">
            <StatusBadge status="live" /> ships full functionality. <StatusBadge status="beta" />{' '}
            works end-to-end but rough edges expected. <StatusBadge status="limited" /> partially
            gated. <StatusBadge status="planned" /> not yet enabled.
          </p>
          <div className="space-y-5">
            {FEATURE_MATRIX.map((group) => (
              <div
                key={group.group}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-4"
              >
                <p className="font-semibold mb-3">{group.group}</p>
                <ul className="space-y-2 text-sm">
                  {group.rows.map((r) => (
                    <li key={r.label} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p>{r.label}</p>
                        {r.note && <p className="text-xs text-muted-foreground mt-0.5">{r.note}</p>}
                      </div>
                      <StatusBadge status={r.status} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3 mb-10">
          <h2 className="text-xl font-semibold">Known limitations</h2>
          <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
            <li>
              All smart contracts on this deployment are owned by a single deployer EOA. The
              multi-sig + 48-hour timelock handoff happens before mainnet, not on testnet.
            </li>
            <li>
              Token launches use testnet liquidity only. Bonding curves are real but the ETH backing
              them has no market value.
            </li>
            <li>
              The indexer reorgs occasionally on Sepolia. If a recent transaction looks missing,
              wait a minute and refresh.
            </li>
            <li>First-load bundles are still on the heavy side; subsequent navigation is fast.</li>
            <li>
              Email notifications (DMCA flow, putback notices) ship best-effort — confirm receipt if
              you depend on them.
            </li>
          </ul>
        </section>

        <section className="space-y-3 mb-10">
          <h2 className="text-xl font-semibold">Get testnet funds</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <Link
              to="/faucet"
              className="rounded-lg border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.06] hover:border-violet-500/40 transition-colors"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold">$LOAR faucet</p>
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              </div>
              <p className="text-muted-foreground text-xs mt-1">
                Claim testnet $LOAR for in-app spending.
              </p>
            </Link>
            <a
              href="https://www.alchemy.com/faucets/ethereum-sepolia"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.06] hover:border-violet-500/40 transition-colors"
            >
              <div className="flex items-center justify-between">
                <p className="font-semibold">Sepolia ETH</p>
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground text-xs mt-1">
                Use any public Sepolia faucet for gas.
              </p>
            </a>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Found a bug?</h2>
          <p className="text-sm text-muted-foreground">
            Report issues or share feedback at{' '}
            <a href="mailto:support@loar.fun" className="text-primary underline underline-offset-2">
              support@loar.fun
            </a>
            . For live health, see the{' '}
            <Link to="/status" className="text-primary underline underline-offset-2">
              status page
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
