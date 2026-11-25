/**
 * Global governance feed — proposals across every universe that has a token,
 * newest first, filterable by state. Each row links through to that universe's
 * full governance page.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '@/utils/trpc';
import { ErrorState } from '@/components/states';

const STATES = ['All', 'Active', 'Pending', 'Succeeded', 'Defeated', 'Queued', 'Executed'] as const;
type StateTab = (typeof STATES)[number];

interface TokenSearch {
  state?: string;
}

interface ProposalRow {
  id: string;
  proposalId: string;
  universeId: string;
  description: string;
  proposer: string;
  state: string;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  createdAt?: unknown;
}

const STATE_STYLE: Record<string, string> = {
  Pending: 'bg-amber-900/30 text-amber-400',
  Active: 'bg-blue-900/30 text-blue-400',
  Succeeded: 'bg-green-900/30 text-green-400',
  Defeated: 'bg-red-900/30 text-red-400',
  Executed: 'bg-violet-900/30 text-violet-400',
  Queued: 'bg-orange-900/30 text-orange-400',
  Canceled: 'bg-muted text-muted-foreground',
  Expired: 'bg-muted text-muted-foreground',
};

function fmtVotes(raw: string): string {
  // Vote weights are 18-decimal token units.
  const n = Number(BigInt(raw || '0') / 10n ** 15n) / 1000;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export const Route = createFileRoute('/governance/')({
  validateSearch: (search: Record<string, unknown>): TokenSearch => ({
    state: typeof search.state === 'string' ? search.state : undefined,
  }),
  component: GovernanceIndex,
});

function GovernanceIndex() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeState = (search.state as StateTab) || 'All';

  const { data, isLoading, isError, refetch } = useQuery(
    trpc.governance.listAllProposals.queryOptions({
      state: activeState === 'All' ? undefined : (activeState as Exclude<StateTab, 'All'>),
      limit: 50,
    })
  );
  const proposals = (data?.proposals ?? []) as unknown as ProposalRow[];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-6 pb-bottom-nav sm:py-8 md:pb-12">
        <div className="mb-6">
          <h1 className="text-2xl font-bold sm:text-3xl">Governance</h1>
          <p className="mt-1 text-sm text-muted-foreground sm:text-base">
            Every open proposal across all universe tokens.
          </p>
        </div>

        <div className="mb-5 flex gap-2 overflow-x-auto pb-2">
          {STATES.map((s) => (
            <button
              key={s}
              onClick={() =>
                navigate({ search: { state: s === 'All' ? undefined : s }, replace: true })
              }
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeState === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {isError ? (
          <ErrorState
            title="Couldn’t load proposals"
            description="Governance data comes from the indexer, which may be catching up. Try again in a moment."
            onRetry={() => refetch()}
          />
        ) : isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse rounded-xl bg-card p-5">
                <div className="mb-3 h-5 w-3/4 rounded bg-muted" />
                <div className="h-4 w-1/2 rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : proposals.length === 0 ? (
          <div className="rounded-xl bg-card p-12 text-center">
            <p className="text-lg text-muted-foreground">No proposals</p>
            <p className="mt-2 text-muted-foreground">
              {activeState === 'All'
                ? 'Nothing has been proposed yet.'
                : `No ${activeState.toLowerCase()} proposals right now.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {proposals.map((p) => {
              const title = (p.description || 'Untitled proposal').split('\n')[0].slice(0, 120);
              const forV = BigInt(p.forVotes || '0');
              const againstV = BigInt(p.againstVotes || '0');
              const total = forV + againstV;
              const forPct = total > 0n ? Number((forV * 100n) / total) : 0;
              return (
                <Link
                  key={p.id}
                  to="/governance/$universeId"
                  params={{ universeId: p.universeId }}
                  className="block rounded-xl bg-card p-5 transition-colors hover:bg-muted/80"
                >
                  <div className="mb-2 flex items-start gap-3">
                    <p className="flex-1 font-medium leading-snug">{title}</p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        STATE_STYLE[p.state] ?? 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {p.state}
                    </span>
                  </div>
                  <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-red-900/40">
                    <div className="h-full bg-green-500" style={{ width: `${forPct}%` }} />
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span className="text-green-400">For {fmtVotes(p.forVotes)}</span>
                    <span className="text-red-400">Against {fmtVotes(p.againstVotes)}</span>
                    <span>Abstain {fmtVotes(p.abstainVotes)}</span>
                    <span className="ml-auto font-mono">
                      {p.universeId.slice(0, 6)}…{p.universeId.slice(-4)}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
