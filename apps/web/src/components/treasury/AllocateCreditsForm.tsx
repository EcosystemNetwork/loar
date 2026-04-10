import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Send, Users } from 'lucide-react';
import { useAllocateToMember, useTeamMembers } from '@/hooks/useTreasury';

export function AllocateCreditsForm({ universeId }: { universeId: string }) {
  const [memberUid, setMemberUid] = useState('');
  const [credits, setCredits] = useState('');
  const [reason, setReason] = useState('');
  const allocate = useAllocateToMember();
  const { data: members } = useTeamMembers(universeId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberUid.trim() || !credits) return;

    await allocate.mutateAsync({
      universeId,
      memberUid: memberUid.trim(),
      credits: parseInt(credits, 10),
      reason: reason.trim() || undefined,
    });
    setMemberUid('');
    setCredits('');
    setReason('');
  };

  return (
    <div className="space-y-6">
      {/* Team Members List */}
      {members && members.length > 0 && (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
              <Users className="h-4 w-4" />
              Team Members
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {members.map((m: any) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMemberUid(m.memberUid)}
                className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all text-left ${
                  memberUid === m.memberUid
                    ? 'border-violet-500 bg-violet-950/30'
                    : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'
                }`}
              >
                <div>
                  <div className="text-sm font-medium text-zinc-200">
                    {m.memberUid.slice(0, 6)}...{m.memberUid.slice(-4)}
                  </div>
                  <div className="text-xs text-zinc-500 capitalize">{m.role}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-400">
                    Allowance: {m.monthlyAllowance || 'Unlimited'}
                  </div>
                  <div className="text-xs text-zinc-500">Used: {m.creditsUsedThisMonth || 0}</div>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Allocation Form */}
      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-zinc-300">
            <Send className="h-4 w-4" />
            Allocate Credits
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-zinc-400">Member Address / UID</Label>
              <Input
                value={memberUid}
                onChange={(e) => setMemberUid(e.target.value)}
                placeholder="0x... or user UID"
                className="bg-zinc-900 border-zinc-700 text-white"
                required
              />
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-400">Credits to Allocate</Label>
              <Input
                type="number"
                min="1"
                value={credits}
                onChange={(e) => setCredits(e.target.value)}
                placeholder="1000"
                className="bg-zinc-900 border-zinc-700 text-white"
                required
              />
            </div>

            <div className="space-y-2">
              <Label className="text-zinc-400">Reason (optional)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g., Monthly generation budget, bonus for content"
                className="bg-zinc-900 border-zinc-700 text-white resize-none"
                rows={2}
              />
            </div>

            <Button
              type="submit"
              disabled={allocate.isPending || !memberUid.trim() || !credits}
              className="w-full bg-violet-600 hover:bg-violet-700"
            >
              {allocate.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Allocating...
                </>
              ) : (
                'Allocate Credits'
              )}
            </Button>

            {allocate.isError && (
              <p className="text-sm text-red-400">{(allocate.error as Error).message}</p>
            )}
            {allocate.isSuccess && (
              <p className="text-sm text-emerald-400">Credits allocated successfully!</p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
