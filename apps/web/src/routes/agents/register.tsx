/**
 * Agent Registration — Register as a talent agent on the platform
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useRegisterAgent, useMyAgentProfile } from '@/hooks/useTalentAgents';
import { useWalletAuth } from '@/lib/wallet-auth';
import { WalletConnectButton } from '@/components/wallet-connect-button';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useState } from 'react';
import { Briefcase, ArrowLeft } from 'lucide-react';

export const Route = createFileRoute('/agents/register')({
  component: AgentRegisterPage,
});

const SPECIALTIES = [
  'animation',
  'character-design',
  'world-building',
  'licensing',
  'voice-acting',
  'music',
  'writing',
  'directing',
  '3d-modeling',
  'vfx',
  'marketing',
  'brand-deals',
  'merch',
  'legal',
];

function AgentRegisterPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useWalletAuth();
  const { data: existing } = useMyAgentProfile();
  const register = useRegisterAgent();

  const [form, setForm] = useState({
    agencyName: '',
    displayName: '',
    bio: '',
    website: '',
    specialties: [] as string[],
  });

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="p-8 text-center">
          <Briefcase className="mx-auto mb-4 h-12 w-12 text-violet-400" />
          <h2 className="mb-2 text-xl font-bold text-white">Connect Wallet to Register</h2>
          <p className="mb-4 text-zinc-400">You need a wallet to become a talent agent</p>
          <WalletConnectButton />
        </Card>
      </div>
    );
  }

  if (existing) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="mb-2 text-xl font-bold text-white">Already Registered</h2>
          <p className="mb-4 text-zinc-400">You're already a talent agent on LOAR</p>
          <Button onClick={() => navigate({ to: '/agents/dashboard' })}>Go to Dashboard</Button>
        </Card>
      </div>
    );
  }

  const toggleSpecialty = (s: string) => {
    setForm((prev) => ({
      ...prev,
      specialties: prev.specialties.includes(s)
        ? prev.specialties.filter((x) => x !== s)
        : [...prev.specialties, s],
    }));
  };

  const handleSubmit = async () => {
    if (!form.agencyName || !form.displayName) {
      toast.error('Agency name and display name are required');
      return;
    }

    try {
      await register.mutateAsync({
        agencyName: form.agencyName,
        displayName: form.displayName,
        bio: form.bio,
        website: form.website || undefined,
        specialties: form.specialties,
      });
      toast.success('Registered as a talent agent!');
      navigate({ to: '/agents/dashboard' });
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Button variant="ghost" onClick={() => navigate({ to: '/agents' })} className="mb-4 gap-2">
        <ArrowLeft className="h-4 w-4" />
        Back to Agents
      </Button>

      <Card className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Briefcase className="h-7 w-7 text-violet-400" />
            Become a Talent Agent
          </h1>
          <p className="mt-2 text-zinc-400">
            Represent creators, broker deals, earn commissions on licensing and collabs
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-zinc-400">Agency Name *</label>
            <Input
              placeholder="e.g. Creative Universe Agency"
              value={form.agencyName}
              onChange={(e) => setForm((p) => ({ ...p, agencyName: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-zinc-400">Display Name *</label>
            <Input
              placeholder="Your public name"
              value={form.displayName}
              onChange={(e) => setForm((p) => ({ ...p, displayName: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-zinc-400">Bio</label>
            <textarea
              placeholder="Tell creators what you bring to the table..."
              value={form.bio}
              onChange={(e) => setForm((p) => ({ ...p, bio: e.target.value }))}
              className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder:text-zinc-500"
              rows={3}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-zinc-400">Website</label>
            <Input
              placeholder="https://..."
              value={form.website}
              onChange={(e) => setForm((p) => ({ ...p, website: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-zinc-400">Specialties</label>
            <div className="flex flex-wrap gap-2">
              {SPECIALTIES.map((s) => (
                <Badge
                  key={s}
                  variant={form.specialties.includes(s) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleSpecialty(s)}
                >
                  {s}
                </Badge>
              ))}
            </div>
          </div>

          <Button className="w-full mt-4" onClick={handleSubmit} disabled={register.isPending}>
            {register.isPending ? 'Registering...' : 'Register as Talent Agent'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
