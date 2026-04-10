import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Settings, Loader2, Users } from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTreasury';
import { trpcClient } from '@/utils/trpc';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface TreasuryRulesPanelProps {
  universeId: string;
}

export function TreasuryRulesPanel({ universeId }: TreasuryRulesPanelProps) {
  const [creditSharePct, setCreditSharePct] = useState(70);
  const { data: members } = useTeamMembers(universeId);
  const qc = useQueryClient();

  // Member allowance update
  const updateMember = useMutation({
    mutationFn: (input: { universeId: string; memberUid: string; monthlyAllowance: number }) =>
      trpcClient.universeTeam.updateMember.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team-members', universeId] }),
  });

  const [editingMember, setEditingMember] = useState<string | null>(null);
  const [editAllowance, setEditAllowance] = useState('');

  const handleSaveAllowance = async (memberUid: string) => {
    const val = parseInt(editAllowance, 10);
    if (isNaN(val) || val < 0) return;
    await updateMember.mutateAsync({
      universeId,
      memberUid,
      monthlyAllowance: val,
    });
    setEditingMember(null);
    setEditAllowance('');
  };

  return (
    <div className="space-y-6">
      {/* Revenue Split Configuration */}
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
            <Settings className="h-4 w-4" />
            Revenue Deposit Split
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-zinc-500">
            When depositing on-chain revenue, this controls how much goes to the credit pool vs
            staker rewards.
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-zinc-400">Credit Pool</Label>
              <Badge variant="outline" className="border-emerald-700 text-emerald-400">
                {creditSharePct}%
              </Badge>
            </div>
            <Slider
              value={[creditSharePct]}
              onValueChange={([v]) => setCreditSharePct(v)}
              min={0}
              max={100}
              step={5}
              className="[&_[role=slider]]:bg-emerald-500"
            />
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>Credit Pool: {creditSharePct}%</span>
              <span>Staker Rewards: {100 - creditSharePct}%</span>
            </div>
          </div>

          <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-400 space-y-1">
            <p>This setting applies when you use "Deposit Revenue" from the Overview tab.</p>
            <p>
              Credits fuel AI generation for your team. Staker rewards incentivize token holders.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Member Allowances */}
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
            <Users className="h-4 w-4" />
            Member Monthly Allowances
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-zinc-500">
            Set how many credits each team member can draw from the pool per month. 0 = unlimited.
          </p>

          {!members || members.length === 0 ? (
            <div className="text-center py-6 text-zinc-500 text-sm">
              No team members yet. Add members from the Team tab.
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m: any) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-zinc-800 bg-zinc-900"
                >
                  <div>
                    <div className="text-sm font-medium text-zinc-200">
                      {m.memberUid.slice(0, 6)}...{m.memberUid.slice(-4)}
                    </div>
                    <div className="text-xs text-zinc-500 capitalize">{m.role}</div>
                  </div>

                  {editingMember === m.memberUid ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        value={editAllowance}
                        onChange={(e) => setEditAllowance(e.target.value)}
                        className="w-24 h-8 bg-zinc-800 border-zinc-700 text-white text-sm"
                        placeholder="0"
                      />
                      <Button
                        size="sm"
                        onClick={() => handleSaveAllowance(m.memberUid)}
                        disabled={updateMember.isPending}
                        className="h-8 bg-emerald-600 hover:bg-emerald-700"
                      >
                        {updateMember.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          'Save'
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditingMember(null)}
                        className="h-8"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setEditingMember(m.memberUid);
                        setEditAllowance(String(m.monthlyAllowance || 0));
                      }}
                      className="text-sm text-zinc-400 hover:text-white transition-colors"
                    >
                      {m.monthlyAllowance
                        ? `${m.monthlyAllowance.toLocaleString()}/mo`
                        : 'Unlimited'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
