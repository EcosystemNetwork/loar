/**
 * Universe Agent Panel — Shows assigned talent agents and AI agents for a universe
 */
import {
  useAIAgentsByUniverse,
  useUniverseAgentAssignments,
  useAllocateAgentBudget,
  usePauseAIAgent,
  useResumeAIAgent,
} from '@/hooks/useAIAgents';
import { useAgentProfile } from '@/hooks/useTalentAgents';
import { usePipelinesByAgent, useRunPipeline } from '@/hooks/useAIPipelines';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { AIAgentCreator } from './AIAgentCreator';
import {
  Bot,
  Briefcase,
  Plus,
  Play,
  Pause,
  Zap,
  CreditCard,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

interface Props {
  universeId: string;
  isAdmin: boolean;
}

export function UniverseAgentPanel({ universeId, isAdmin }: Props) {
  const { data: assignments } = useUniverseAgentAssignments(universeId);
  const { data: aiAgents, refetch: refetchAgents } = useAIAgentsByUniverse(universeId);
  const [showCreator, setShowCreator] = useState(false);
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Talent Agent Section */}
      <div>
        <h3 className="mb-3 text-lg font-semibold text-white flex items-center gap-2">
          <Briefcase className="h-5 w-5 text-violet-400" />
          Talent Agent
        </h3>
        {assignments?.talentAgentUid ? (
          <TalentAgentCard uid={assignments.talentAgentUid} />
        ) : (
          <Card className="p-4 text-center text-zinc-500">
            <p>No talent agent assigned</p>
            {isAdmin && (
              <Link to="/agents">
                <Button variant="outline" size="sm" className="mt-2 gap-1">
                  <Plus className="h-3 w-3" />
                  Find an Agent
                </Button>
              </Link>
            )}
          </Card>
        )}
      </div>

      {/* AI Agents Section */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Bot className="h-5 w-5 text-cyan-400" />
            AI Agents
          </h3>
          {isAdmin && (
            <Button size="sm" onClick={() => setShowCreator(true)} className="gap-1">
              <Plus className="h-3 w-3" />
              Add Agent
            </Button>
          )}
        </div>

        {!aiAgents?.length ? (
          <Card className="p-4 text-center text-zinc-500">
            <Bot className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>No AI agents configured</p>
            {isAdmin && (
              <p className="mt-1 text-sm">
                Create an AI agent to automate content creation and management
              </p>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {aiAgents.map((agent: any) => (
              <AIAgentCard
                key={agent.id}
                agent={agent}
                isAdmin={isAdmin}
                expanded={expandedAgent === agent.id}
                onToggle={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreator && (
        <AIAgentCreator
          universeId={universeId}
          onClose={() => setShowCreator(false)}
          onCreated={() => refetchAgents()}
        />
      )}
    </div>
  );
}

function TalentAgentCard({ uid }: { uid: string }) {
  const { data: agent } = useAgentProfile(uid);

  if (!agent) return null;

  return (
    <Link to={`/agents/${uid}`}>
      <Card className="flex items-center gap-4 p-4 transition-colors hover:border-violet-500/50">
        {(agent as any).avatarUrl ? (
          <img
            src={(agent as any).avatarUrl}
            alt={(agent as any).displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/20 text-violet-400">
            <Briefcase className="h-5 w-5" />
          </div>
        )}
        <div className="flex-1">
          <p className="font-medium text-white">{(agent as any).displayName}</p>
          <p className="text-sm text-zinc-400">{(agent as any).agencyName}</p>
        </div>
        <Badge variant="secondary">Active</Badge>
      </Card>
    </Link>
  );
}

function AIAgentCard({
  agent,
  isAdmin,
  expanded,
  onToggle,
}: {
  agent: any;
  isAdmin: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pause = usePauseAIAgent();
  const resume = useResumeAIAgent();
  const allocate = useAllocateAgentBudget();
  const { data: pipelines } = usePipelinesByAgent(expanded ? agent.id : undefined);
  const runPipeline = useRunPipeline();
  const [budgetAmount, setBudgetAmount] = useState('');

  const handleAllocate = async () => {
    const amount = parseInt(budgetAmount);
    if (!amount || amount <= 0) return;
    try {
      await allocate.mutateAsync({ agentId: agent.id, amount });
      toast.success(`Allocated ${amount} credits`);
      setBudgetAmount('');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRunPipeline = async (pipelineId: string) => {
    try {
      const result = await runPipeline.mutateAsync({ pipelineId });
      toast.success(`Pipeline started: ${result.runId}`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 cursor-pointer" onClick={onToggle}>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400">
          <Bot className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-white truncate">{agent.name}</p>
            <Badge
              variant={agent.status === 'active' ? 'default' : 'secondary'}
              className="text-xs"
            >
              {agent.status}
            </Badge>
          </div>
          <p className="text-xs text-zinc-400 capitalize">{agent.type?.replace('_', ' ')}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{agent.totalRunCount || 0} runs</span>
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-zinc-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-zinc-400" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-zinc-800 pt-4">
          {/* Permissions */}
          <div>
            <p className="mb-1 text-xs text-zinc-400">Permissions</p>
            <div className="flex flex-wrap gap-1">
              {agent.permissions?.map((p: string) => (
                <Badge key={p} variant="outline" className="text-xs">
                  {p.replace('_', ' ')}
                </Badge>
              ))}
            </div>
          </div>

          {/* Budget */}
          {isAdmin && (
            <div>
              <p className="mb-1 text-xs text-zinc-400">Credit Budget</p>
              <div className="flex gap-2">
                <Input
                  type="number"
                  placeholder="Amount"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                  className="w-32"
                />
                <Button
                  size="sm"
                  onClick={handleAllocate}
                  disabled={allocate.isPending}
                  className="gap-1"
                >
                  <CreditCard className="h-3 w-3" />
                  Allocate
                </Button>
              </div>
            </div>
          )}

          {/* Pipelines */}
          {pipelines && pipelines.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-zinc-400">Pipelines</p>
              <div className="space-y-2">
                {pipelines.map((p: any) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 p-2"
                  >
                    <div>
                      <p className="text-sm text-white">{p.name}</p>
                      <p className="text-xs text-zinc-500">{p.steps?.length || 0} steps</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRunPipeline(p.id)}
                      disabled={runPipeline.isPending}
                      className="gap-1"
                    >
                      <Play className="h-3 w-3" />
                      Run
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Controls */}
          {isAdmin && (
            <div className="flex gap-2">
              {agent.status === 'active' ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    pause.mutateAsync(agent.id).then(() => toast.success('Agent paused'))
                  }
                  className="gap-1"
                >
                  <Pause className="h-3 w-3" />
                  Pause
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    resume.mutateAsync(agent.id).then(() => toast.success('Agent resumed'))
                  }
                  className="gap-1"
                >
                  <Zap className="h-3 w-3" />
                  Resume
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
