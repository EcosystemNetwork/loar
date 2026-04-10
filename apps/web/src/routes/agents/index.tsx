/**
 * Agent Discovery — Browse and search talent agents
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { useDiscoverAgents } from '@/hooks/useTalentAgents';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { Search, Users, Star, Briefcase, Shield, Plus } from 'lucide-react';

export const Route = createFileRoute('/agents/')({
  component: AgentDiscoveryPage,
});

function AgentDiscoveryPage() {
  const { isAuthenticated } = useWalletAuth();
  const [search, setSearch] = useState('');
  const [selectedSpecialties, setSelectedSpecialties] = useState<string[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const { data, isLoading } = useDiscoverAgents({
    search: search || undefined,
    specialties: selectedSpecialties.length > 0 ? selectedSpecialties : undefined,
    verifiedOnly,
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

  const toggleSpecialty = (s: string) => {
    setSelectedSpecialties((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Users className="h-8 w-8 text-violet-400" />
            Talent Agents
          </h1>
          <p className="mt-2 text-zinc-400">
            Discover agents who represent creators, broker deals, and manage IP licensing
          </p>
        </div>
        {isAuthenticated && (
          <Link to="/agents/register">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Become an Agent
            </Button>
          </Link>
        )}
      </div>

      {/* Search + Filters */}
      <div className="mb-6 space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            placeholder="Search agents by name, agency, or expertise..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant={verifiedOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVerifiedOnly(!verifiedOnly)}
            className="gap-1"
          >
            <Shield className="h-3 w-3" />
            Verified Only
          </Button>
          {SPECIALTIES.map((s) => (
            <Badge
              key={s}
              variant={selectedSpecialties.includes(s) ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => toggleSpecialty(s)}
            >
              {s}
            </Badge>
          ))}
        </div>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
        </div>
      ) : !data?.agents?.length ? (
        <div className="py-20 text-center text-zinc-500">
          <Users className="mx-auto mb-4 h-12 w-12 opacity-50" />
          <p>No talent agents found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.agents.map((agent: any) => (
            <Link key={agent.uid || agent.id} to={`/agents/${agent.uid || agent.id}`}>
              <Card className="p-5 transition-colors hover:border-violet-500/50 hover:bg-zinc-900/50">
                <div className="flex items-start gap-4">
                  {agent.avatarUrl ? (
                    <img
                      src={agent.avatarUrl}
                      alt={agent.displayName}
                      className="h-12 w-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-500/20 text-violet-400">
                      <Briefcase className="h-6 w-6" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-white truncate">{agent.displayName}</h3>
                      {agent.verified && <Shield className="h-4 w-4 text-blue-400 flex-shrink-0" />}
                    </div>
                    <p className="text-sm text-zinc-400 truncate">{agent.agencyName}</p>
                  </div>
                </div>

                {agent.bio && (
                  <p className="mt-3 text-sm text-zinc-400 line-clamp-2">{agent.bio}</p>
                )}

                <div className="mt-3 flex flex-wrap gap-1">
                  {(agent.specialties || []).slice(0, 4).map((s: string) => (
                    <Badge key={s} variant="secondary" className="text-xs">
                      {s}
                    </Badge>
                  ))}
                </div>

                <div className="mt-4 flex items-center gap-4 text-sm text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Briefcase className="h-3 w-3" />
                    {agent.totalDeals || 0} deals
                  </span>
                  {agent.rating && (
                    <span className="flex items-center gap-1">
                      <Star className="h-3 w-3 text-yellow-400" />
                      {agent.rating.toFixed(1)}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
