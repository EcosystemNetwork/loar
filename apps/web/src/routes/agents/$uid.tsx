/**
 * Agent Profile — Public profile page for a talent agent
 */
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useAgentProfile } from '@/hooks/useTalentAgents';
import { useProposeContract } from '@/hooks/useTalentAgents';
import { useWalletAuth } from '@/lib/wallet-auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useState } from 'react';
import { Briefcase, Star, Shield, Globe, ArrowLeft, Handshake, ExternalLink } from 'lucide-react';
import { AgentContractModal } from '@/components/agents/AgentContractModal';
import { resolveIpfsUrl } from '@/utils/ipfs-url';

export const Route = createFileRoute('/agents/$uid')({
  component: AgentProfilePage,
});

function AgentProfilePage() {
  const { uid } = Route.useParams();
  const navigate = useNavigate();
  const { isAuthenticated, address } = useWalletAuth();
  const { data: agent, isLoading } = useAgentProfile(uid);
  const [showContractModal, setShowContractModal] = useState(false);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-bold text-white">Agent Not Found</h2>
          <Button onClick={() => navigate({ to: '/agents' })} className="mt-4">
            Browse Agents
          </Button>
        </Card>
      </div>
    );
  }

  const isOwnProfile = address?.toLowerCase() === uid.toLowerCase();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Button variant="ghost" onClick={() => navigate({ to: '/agents' })} className="mb-4 gap-2">
        <ArrowLeft className="h-4 w-4" />
        Back to Agents
      </Button>

      <Card className="p-8">
        {/* Profile Header */}
        <div className="flex items-start gap-6">
          {(agent as any).avatarUrl ? (
            <img
              src={resolveIpfsUrl((agent as any).avatarUrl)}
              alt={(agent as any).displayName}
              className="h-20 w-20 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-violet-500/20 text-violet-400">
              <Briefcase className="h-10 w-10" />
            </div>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">{(agent as any).displayName}</h1>
              {(agent as any).verified && <Shield className="h-5 w-5 text-blue-400" />}
            </div>
            <p className="text-lg text-zinc-400">{(agent as any).agencyName}</p>

            {(agent as any).website && (
              <a
                href={(agent as any).website}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-sm text-violet-400 hover:underline"
              >
                <Globe className="h-3 w-3" />
                Website
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {isOwnProfile ? (
              <Button onClick={() => navigate({ to: '/agents/dashboard' })}>Dashboard</Button>
            ) : (
              isAuthenticated && (
                <Button onClick={() => setShowContractModal(true)} className="gap-2">
                  <Handshake className="h-4 w-4" />
                  Propose Contract
                </Button>
              )
            )}
          </div>
        </div>

        {/* Bio */}
        {(agent as any).bio && (
          <p className="mt-6 text-zinc-300 leading-relaxed">{(agent as any).bio}</p>
        )}

        {/* Specialties */}
        {(agent as any).specialties?.length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium text-zinc-400">Specialties</h3>
            <div className="flex flex-wrap gap-2">
              {(agent as any).specialties.map((s: string) => (
                <Badge key={s} variant="secondary">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="mt-8 grid grid-cols-3 gap-4 border-t border-zinc-800 pt-6">
          <div className="text-center">
            <p className="text-2xl font-bold text-white">{(agent as any).totalDeals || 0}</p>
            <p className="text-sm text-zinc-400">Deals Closed</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white">
              {(agent as any).rating ? (agent as any).rating.toFixed(1) : 'N/A'}
            </p>
            <p className="text-sm text-zinc-400">Rating</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-white font-mono">
              {(agent as any).totalRevenueGenerated !== '0'
                ? `${((agent as any).totalRevenueGenerated / 1e18).toFixed(2)} ETH`
                : '—'}
            </p>
            <p className="text-sm text-zinc-400">Revenue Generated</p>
          </div>
        </div>

        {/* Social Links */}
        {(agent as any).socialLinks &&
          Object.entries((agent as any).socialLinks).some(([_, v]) => v) && (
            <div className="mt-6 border-t border-zinc-800 pt-6">
              <h3 className="mb-2 text-sm font-medium text-zinc-400">Social</h3>
              <div className="flex gap-3">
                {Object.entries((agent as any).socialLinks)
                  .filter(([_, v]) => v)
                  .map(([platform, url]) => (
                    <a
                      key={platform}
                      href={url as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-violet-400 hover:underline capitalize"
                    >
                      {platform}
                    </a>
                  ))}
              </div>
            </div>
          )}
      </Card>

      {showContractModal && (
        <AgentContractModal agentUid={uid} onClose={() => setShowContractModal(false)} />
      )}
    </div>
  );
}
