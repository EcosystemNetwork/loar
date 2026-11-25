import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Settings, Loader2, Users } from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTreasury';
import { useVocab } from '@/hooks/use-vocab';
import { trpcClient } from '@/utils/trpc';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface TreasuryRulesPanelProps {
  universeId: string;
}

export function TreasuryRulesPanel({ universeId }: TreasuryRulesPanelProps) {
  const v = useVocab();
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
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-foreground/80">
            <Settings className="h-4 w-4" />
            Revenue Deposit Split
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            When depositing on-chain revenue, this controls how much goes to the credit pool vs
            staker rewards.
          </p>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground">Credit Pool</Label>
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
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Credit Pool: {creditSharePct}%</span>
              <span>
                {v('staker-rewards')}: {100 - creditSharePct}%
              </span>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p>This setting applies when you use "Deposit Revenue" from the Overview tab.</p>
            <p>
              Credits fuel AI generation for your team. {v('staker-rewards')} incentivize{' '}
              {v('token-holders').toLowerCase()}.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Member Allowances */}
      <Card className="bg-card/50 border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-foreground/80">
            <Users className="h-4 w-4" />
            Member Monthly Allowances
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Set how many credits each team member can draw from the pool per month. 0 = unlimited.
          </p>

          {!members || members.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-sm">
              No team members yet. Add members from the Team tab.
            </div>
          ) : (
            <div className="space-y-2">
              {members.map((m: any) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-card"
                >
                  <div>
                    <div className="text-sm font-medium text-foreground">
                      {m.memberUid.slice(0, 6)}...{m.memberUid.slice(-4)}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">{m.role}</div>
                  </div>

                  {editingMember === m.memberUid ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min="0"
                        value={editAllowance}
                        onChange={(e) => setEditAllowance(e.target.value)}
                        className="w-24 h-8 bg-muted border-border text-foreground text-sm"
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
                      className="text-sm text-zinc-400 hover:text-foreground transition-colors"
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
