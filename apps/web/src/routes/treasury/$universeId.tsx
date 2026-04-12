import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { trpc } from '../../utils/trpc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Wallet, Plus, History, Users, Settings, Banknote, Shield } from 'lucide-react';
import { TreasuryBalanceCard } from '@/components/treasury/TreasuryBalanceCard';
import { FundPoolDialog } from '@/components/treasury/FundPoolDialog';
import { TreasuryHistoryTable } from '@/components/treasury/TreasuryHistoryTable';
import { AllocateCreditsForm } from '@/components/treasury/AllocateCreditsForm';
import { TreasuryRulesPanel } from '@/components/treasury/TreasuryRulesPanel';
import { DepositRevenueCard } from '@/components/treasury/DepositRevenueCard';

export const Route = createFileRoute('/treasury/$universeId')({
  component: TreasuryPage,
});

function TreasuryPage() {
  const { universeId } = Route.useParams();
  const { address } = useAccount();
  const [showFundDialog, setShowFundDialog] = useState(false);
  const [creditSharePct, setCreditSharePct] = useState(70);

  const { data: universeData } = useQuery(trpc.universes.get.queryOptions({ id: universeId }));

  const universeName =
    (universeData?.data as any)?.name || (universeData?.data as any)?.universeName || 'Universe';

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link to={`/universe/${universeId}` as any}>
              <Button variant="ghost" size="sm" className="text-zinc-400 hover:text-white">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Universe
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold flex items-center gap-3">
                  <Wallet className="h-8 w-8 text-emerald-400" />
                  Treasury
                </h1>
                <Badge variant="outline" className="border-zinc-700 text-zinc-400">
                  {universeName}
                </Badge>
              </div>
              <p className="text-zinc-400 mt-1">
                Manage your universe's credit pool, allocations, and revenue
              </p>
            </div>
          </div>
          {address && (
            <Button
              onClick={() => setShowFundDialog(true)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Fund Pool
            </Button>
          )}
        </div>

        {/* Balance Cards */}
        <div className="mb-8">
          <TreasuryBalanceCard universeId={universeId} />
        </div>

        {/* Tabbed Content */}
        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="bg-zinc-900 border border-zinc-800">
            <TabsTrigger
              value="overview"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
            >
              <Banknote className="h-4 w-4 mr-2" />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
            >
              <History className="h-4 w-4 mr-2" />
              History
            </TabsTrigger>
            <TabsTrigger
              value="allocate"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
            >
              <Users className="h-4 w-4 mr-2" />
              Allocate
            </TabsTrigger>
            <TabsTrigger
              value="rules"
              className="data-[state=active]:bg-zinc-800 data-[state=active]:text-white"
            >
              <Settings className="h-4 w-4 mr-2" />
              Rules
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Deposit Revenue */}
              <DepositRevenueCard universeId={universeId} creditSharePct={creditSharePct} />

              {/* Quick Info */}
              <div className="space-y-6">
                <Card className="bg-zinc-900/50 border-zinc-800">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
                      <Shield className="h-4 w-4 text-violet-400" />
                      How Treasury Works
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-xs text-zinc-400">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/50">
                      <div className="w-6 h-6 rounded-full bg-emerald-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-emerald-400 text-xs font-bold">1</span>
                      </div>
                      <div>
                        <p className="text-zinc-300 font-medium">Fund the Pool</p>
                        <p>
                          Purchase credit packages using fiat, ETH, or $LOAR tokens to fill the
                          shared pool.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/50">
                      <div className="w-6 h-6 rounded-full bg-blue-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-blue-400 text-xs font-bold">2</span>
                      </div>
                      <div>
                        <p className="text-zinc-300 font-medium">Team Generates Content</p>
                        <p>
                          Team members draw from the pool for AI generation within their monthly
                          allowance.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/50">
                      <div className="w-6 h-6 rounded-full bg-amber-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-amber-400 text-xs font-bold">3</span>
                      </div>
                      <div>
                        <p className="text-zinc-300 font-medium">Deposit Revenue</p>
                        <p>
                          Bridge on-chain revenue back into credits. Split between pool and staker
                          rewards.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/50">
                      <div className="w-6 h-6 rounded-full bg-violet-900/50 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-violet-400 text-xs font-bold">4</span>
                      </div>
                      <div>
                        <p className="text-zinc-300 font-medium">Allocate to Members</p>
                        <p>
                          Directly transfer credits from the pool to individual member balances as
                          bonuses.
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history">
            <TreasuryHistoryTable universeId={universeId} />
          </TabsContent>

          {/* Allocate Tab */}
          <TabsContent value="allocate">
            <AllocateCreditsForm universeId={universeId} />
          </TabsContent>

          {/* Rules Tab */}
          <TabsContent value="rules">
            <TreasuryRulesPanel universeId={universeId} />
          </TabsContent>
        </Tabs>
      </div>

      {/* Fund Pool Dialog */}
      <FundPoolDialog
        universeId={universeId}
        open={showFundDialog}
        onOpenChange={setShowFundDialog}
      />
    </div>
  );
}
