/**
 * Agent Dashboard — Manage clients, contracts, and commissions
 */
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import {
  useMyAgentProfile,
  useMyContracts,
  useAgentClients,
  useAgentCommissionStats,
} from '@/hooks/useTalentAgents';
import { useWalletAuth } from '@/lib/wallet-auth';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { Briefcase, Users, DollarSign, FileText, TrendingUp, ArrowLeft } from 'lucide-react';

export const Route = createFileRoute('/agents/dashboard')({
  component: AgentDashboardPage,
});

function AgentDashboardPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useWalletAuth();
  const { data: profile, isLoading: profileLoading } = useMyAgentProfile();
  const { data: clients } = useAgentClients();
  const { data: contracts } = useMyContracts('ALL');
  const { data: commissionStats } = useAgentCommissionStats();
  const [activeTab, setActiveTab] = useState<'clients' | 'contracts' | 'commissions'>('clients');

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="p-8 text-center">
          <WalletConnectButton />
        </Card>
      </div>
    );
  }

  if (profileLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="mb-2 text-xl font-bold text-white">Not Registered</h2>
          <p className="mb-4 text-zinc-400">Register as a talent agent first</p>
          <Button onClick={() => navigate({ to: '/agents/register' })}>Register Now</Button>
        </Card>
      </div>
    );
  }

  const activeCount = (contracts as any[])?.filter((c: any) => c.status === 'ACTIVE').length || 0;
  const proposedCount =
    (contracts as any[])?.filter((c: any) => c.status === 'PROPOSED').length || 0;

  const tabs = [
    { key: 'clients', label: 'Clients', icon: Users, count: clients?.length || 0 },
    {
      key: 'contracts',
      label: 'Contracts',
      icon: FileText,
      count: (contracts as any[])?.length || 0,
    },
    { key: 'commissions', label: 'Commissions', icon: DollarSign },
  ] as const;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <Button variant="ghost" onClick={() => navigate({ to: '/agents' })} className="mb-4 gap-2">
        <ArrowLeft className="h-4 w-4" />
        Back to Agents
      </Button>

      {/* Header Stats */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Briefcase className="h-8 w-8 text-violet-400" />
          Agent Dashboard
        </h1>
        <p className="mt-1 text-zinc-400">{(profile as any).agencyName}</p>
      </div>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <div className="text-sm text-zinc-400">Active Clients</div>
          <div className="mt-1 text-2xl font-bold text-white">{clients?.length || 0}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-zinc-400">Active Contracts</div>
          <div className="mt-1 text-2xl font-bold text-white">{activeCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-zinc-400">Pending Proposals</div>
          <div className="mt-1 text-2xl font-bold text-yellow-400">{proposedCount}</div>
        </Card>
        <Card className="p-4">
          <div className="text-sm text-zinc-400">Total Commissions</div>
          <div className="mt-1 text-2xl font-bold text-green-400">
            {commissionStats?.totalCommissions || 0}
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-zinc-800 pb-2">
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            variant={activeTab === tab.key ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab(tab.key)}
            className="gap-2"
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            {'count' in tab && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {tab.count}
              </Badge>
            )}
          </Button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'clients' && (
        <div className="space-y-3">
          {!clients?.length ? (
            <p className="py-8 text-center text-zinc-500">No active clients yet</p>
          ) : (
            clients.map((client: any) => (
              <Card key={client.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-white">
                    {client.creatorUid?.slice(0, 6)}...{client.creatorUid?.slice(-4)}
                  </p>
                  <div className="mt-1 flex gap-2">
                    {client.scope?.map((s: string) => (
                      <Badge key={s} variant="outline" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-zinc-400">{client.commissionBps / 100}% commission</p>
                  <Badge variant={client.exclusivity === 'EXCLUSIVE' ? 'default' : 'secondary'}>
                    {client.exclusivity}
                  </Badge>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === 'contracts' && (
        <div className="space-y-3">
          {!(contracts as any[])?.length ? (
            <p className="py-8 text-center text-zinc-500">No contracts yet</p>
          ) : (
            (contracts as any[]).map((contract: any) => (
              <Card key={contract.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-white">
                      {contract.role === 'agent' ? 'Client' : 'Agent'}:{' '}
                      {(contract.role === 'agent' ? contract.creatorUid : contract.agentUid)?.slice(
                        0,
                        10
                      )}
                      ...
                    </p>
                    <div className="mt-1 flex gap-2">
                      {contract.scope?.map((s: string) => (
                        <Badge key={s} variant="outline" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="text-right">
                    <Badge
                      variant={
                        contract.status === 'ACTIVE'
                          ? 'default'
                          : contract.status === 'PROPOSED'
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {contract.status}
                    </Badge>
                    <p className="mt-1 text-sm text-zinc-400">
                      {contract.commissionBps / 100}% · {contract.dealCount || 0} deals
                    </p>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === 'commissions' && (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-green-400" />
              <div>
                <p className="text-sm text-zinc-400">Total Earned (Wei)</p>
                <p className="text-xl font-bold text-white">
                  {commissionStats?.totalEarnedWei || '0'}
                </p>
              </div>
            </div>
          </Card>

          {commissionStats?.bySource &&
            Object.entries(commissionStats.bySource).map(([source, data]: [string, any]) => (
              <Card key={source} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-white capitalize">{source.replace('_', ' ')}</p>
                  <p className="text-sm text-zinc-400">{data.count} transactions</p>
                </div>
                <p className="font-mono text-green-400">{data.total} wei</p>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
