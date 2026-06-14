/**
 * /agents/discover — the agent economy, in one place.
 *
 *   • ENS resolver        (ens.resolve / ens.reverse)        — identity
 *   • ERC-8004 leaderboard (agentRegistry.rank, BigQuery)    — reputation
 *   • x402-payable agents  (agentRegistry.x402Agents)        — payments
 *
 * Doubles as the Google Cloud track's lightweight frontend over BigQuery.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AddressDisplay } from '@/components/tokens/AddressDisplay';
import { Loader2, Search, Trophy, Zap, Fingerprint } from 'lucide-react';

export const Route = createFileRoute('/agents/discover')({
  component: DiscoverPage,
});

function short(s: string, head = 10, tail = 6) {
  return s.length > head + tail ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

function DiscoverPage() {
  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Fingerprint className="h-6 w-6" /> Agent Economy
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          ENS identities · ERC-8004 reputation (BigQuery) · x402 payments (Arc).
        </p>
      </div>
      <EnsResolver />
      <ReputationLeaderboard />
      <X402Agents />
    </div>
  );
}

function EnsResolver() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const isAddr = /^0x[0-9a-fA-F]{40}$/.test(submitted ?? '');

  const result = useQuery({
    queryKey: ['ens-lookup', submitted],
    queryFn: () =>
      isAddr
        ? trpcClient.ens.reverse.query({ address: submitted! })
        : trpcClient.ens.resolve.query({ name: submitted! }),
    enabled: !!submitted,
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Search className="h-4 w-4" /> ENS resolver
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input
            placeholder="name.eth or 0x address…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setSubmitted(q.trim())}
          />
          <Button onClick={() => setSubmitted(q.trim())} disabled={!q.trim()}>
            Resolve
          </Button>
        </div>
        {result.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {submitted && !result.isFetching && (
          <p className="text-sm font-mono">
            {result.data ? (
              <span className="text-primary">{result.data}</span>
            ) : (
              <span className="text-muted-foreground">No result</span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReputationLeaderboard() {
  const status = useQuery({
    queryKey: ['agentreg-status'],
    queryFn: () => trpcClient.agentRegistry.status.query(),
    staleTime: 60_000,
  });
  const rank = useQuery({
    queryKey: ['agentreg-rank'],
    queryFn: () => trpcClient.agentRegistry.rank.query({ limit: 10 }),
    enabled: !!status.data?.configured,
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Trophy className="h-4 w-4" /> ERC-8004 reputation leaderboard
          <Badge variant="secondary" className="ml-auto text-[10px]">
            BigQuery · mainnet
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!status.data?.configured ? (
          <p className="text-xs text-muted-foreground">
            BigQuery not configured on this server (set GCP_PROJECT_ID + service account). Querying{' '}
            the EF ERC-8004 registries on Ethereum mainnet.
          </p>
        ) : rank.isFetching ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : rank.isError ? (
          <p className="text-xs text-destructive">Query failed.</p>
        ) : !rank.data?.length ? (
          <p className="text-xs text-muted-foreground">No ranked agents yet.</p>
        ) : (
          <div className="space-y-1">
            {rank.data.map((a, i) => (
              <div
                key={a.agentId}
                className="flex items-center gap-2 text-sm py-1 border-b border-border/40 last:border-0"
              >
                <span className="w-5 text-muted-foreground">{i + 1}</span>
                <span className="font-mono flex-1">{short(a.agentId)}</span>
                <span className="text-muted-foreground">{a.feedbackCount} fb</span>
                <Badge variant="outline">score {a.reputationScore}</Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function X402Agents() {
  const agents = useQuery({
    queryKey: ['x402-agents'],
    queryFn: () => trpcClient.agentRegistry.x402Agents.query({ limit: 20 }),
    retry: false,
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Zap className="h-4 w-4" /> x402-payable agents
        </CardTitle>
      </CardHeader>
      <CardContent>
        {agents.isFetching ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !agents.data?.length ? (
          <p className="text-xs text-muted-foreground">
            No agents have claimed an ENS name with an MCP endpoint yet.
          </p>
        ) : (
          <div className="space-y-1">
            {agents.data.map((a) => (
              <div key={a.name} className="flex items-center gap-2 text-sm py-1">
                <span className="font-medium flex-1">{a.name}</span>
                <AddressDisplay address={a.address} className="text-xs text-muted-foreground" />
                <Badge variant="outline" className="gap-1">
                  <Zap className="h-3 w-3" /> x402
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
