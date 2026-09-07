/**
 * TokenGovernanceCard — surfaces the token's universe governance on the token
 * detail page: the holder's voting power, open proposal count, and the latest
 * few proposals with inline For / Against / Abstain voting for active ones.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useReadContract } from 'wagmi';
import { formatEther } from 'viem';
import { toast } from 'sonner';
import { governanceErc20Abi } from '@loar/abis/generated';
import { useWalletAccount as useAccount } from '@/hooks/useWalletAccount';
import { useUniverseAddresses } from '@/hooks/useUniverseAddresses';
import { useUniverseGovernor } from '@/hooks/useUniverseGovernor';
import { trpc } from '@/utils/trpc';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Landmark, ExternalLink, Check, X, Minus } from 'lucide-react';

interface ProposalRow {
  id: string;
  proposalId: string;
  description: string;
  state: string;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
}

const STATE_STYLE: Record<string, string> = {
  Pending: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  Active: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  Succeeded: 'bg-green-500/15 text-green-600 dark:text-green-400',
  Defeated: 'bg-red-500/15 text-red-600 dark:text-red-400',
  Executed: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  Queued: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
  Canceled: 'bg-muted text-muted-foreground',
  Expired: 'bg-muted text-muted-foreground',
};

function fmtVotes(raw: string): string {
  const n = Number(formatEther(BigInt(raw || '0')));
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

export function TokenGovernanceCard({
  universeId,
  tokenSymbol,
}: {
  universeId: string;
  tokenSymbol: string;
}) {
  const { address } = useAccount();
  const { tokenAddress, governorAddress } = useUniverseAddresses(universeId);
  const { castVote } = useUniverseGovernor(governorAddress);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: votes } = useReadContract({
    address: tokenAddress,
    abi: governanceErc20Abi,
    functionName: 'getVotes',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!tokenAddress },
  });
  const { data: balance } = useReadContract({
    address: tokenAddress,
    abi: governanceErc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!tokenAddress },
  });

  const { data: proposalsData, isLoading } = useQuery(
    trpc.governance.listProposals.queryOptions({ universeId, limit: 5 })
  );
  const proposals = (proposalsData?.proposals ?? []) as unknown as ProposalRow[];
  const activeCount = proposals.filter((p) => p.state === 'Active').length;

  const votePower = votes != null ? Number(formatEther(votes)) : 0;
  const bal = balance != null ? Number(formatEther(balance)) : 0;
  const needsDelegation = bal > 0 && votePower === 0;

  const doVote = async (p: ProposalRow, support: 0 | 1 | 2) => {
    if (p.proposalId?.startsWith('0x')) {
      toast.error('This proposal predates on-chain voting support.');
      return;
    }
    let pid: bigint;
    try {
      pid = BigInt(p.proposalId);
    } catch {
      toast.error('Invalid proposal id');
      return;
    }
    setBusyId(p.id);
    try {
      await castVote({ proposalId: pid, support });
      toast.success('Vote submitted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Vote failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Landmark className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Governance</h3>
          <Link
            to="/governance/$universeId"
            params={{ universeId }}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Open <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {/* Voting power */}
        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
          <span className="text-muted-foreground">Your voting power</span>
          <span className="font-mono font-semibold tabular-nums">
            {votePower >= 1e6
              ? `${(votePower / 1e6).toFixed(2)}M`
              : votePower >= 1e3
                ? `${(votePower / 1e3).toFixed(1)}K`
                : votePower.toFixed(0)}{' '}
            ${tokenSymbol}
          </span>
        </div>
        {needsDelegation && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            You hold ${tokenSymbol} but haven't delegated — activate voting power on the governance
            page.
          </p>
        )}

        {/* Proposals */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{proposals.length} recent proposals</span>
          {activeCount > 0 && (
            <Badge className="bg-blue-500/15 px-1.5 py-0 text-[10px] text-blue-600 dark:text-blue-400">
              {activeCount} active
            </Badge>
          )}
        </div>

        {isLoading ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">Loading proposals…</p>
        ) : proposals.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">No proposals yet</p>
        ) : (
          <div className="space-y-2">
            {proposals.slice(0, 3).map((p) => {
              const title = (p.description || 'Untitled proposal').split('\n')[0].slice(0, 90);
              const isActive = p.state === 'Active';
              return (
                <div key={p.id} className="rounded-lg border p-2.5">
                  <div className="mb-1 flex items-start gap-2">
                    <p className="flex-1 text-xs font-medium leading-snug">{title}</p>
                    <Badge
                      className={`px-1.5 py-0 text-[9px] ${
                        STATE_STYLE[p.state] ?? 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {p.state}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className="text-green-500">For {fmtVotes(p.forVotes)}</span>
                    <span className="text-red-500">Against {fmtVotes(p.againstVotes)}</span>
                    <span>Abstain {fmtVotes(p.abstainVotes)}</span>
                  </div>
                  {isActive && address && (
                    <div className="mt-2 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 flex-1 gap-1 px-2 text-[10px]"
                        disabled={busyId === p.id}
                        onClick={() => doVote(p, 1)}
                      >
                        <Check className="h-3 w-3 text-green-500" /> For
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 flex-1 gap-1 px-2 text-[10px]"
                        disabled={busyId === p.id}
                        onClick={() => doVote(p, 0)}
                      >
                        <X className="h-3 w-3 text-red-500" /> Against
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 flex-1 gap-1 px-2 text-[10px]"
                        disabled={busyId === p.id}
                        onClick={() => doVote(p, 2)}
                      >
                        <Minus className="h-3 w-3" /> Abstain
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
