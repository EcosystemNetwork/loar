/**
 * ExtractionReview — the creator-facing UI for a VLM extraction.
 *
 *   - shows summary, scene timeline, extracted relationships
 *   - lets the creator accept / reject / merge each entity proposal
 *   - surfaces risk badges so users see what moderation will flag
 *
 * Designed to be embedded on upload, generation, and standalone routes.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trpcClient } from '@/utils/trpc';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, Check, X, GitMerge, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { RiskBadge } from './RiskBadge';

export interface ExtractionReviewProps {
  extractionId: string;
}

function formatTimestamp(sec: number | undefined): string {
  if (sec === undefined) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function ExtractionReview({ extractionId }: ExtractionReviewProps) {
  const queryClient = useQueryClient();
  const [mergeDialog, setMergeDialog] = useState<{
    proposalId: string;
    name: string;
  } | null>(null);
  const [mergeTarget, setMergeTarget] = useState('');

  const { data: extraction, isLoading } = useQuery({
    queryKey: ['vlm-extraction', extractionId],
    queryFn: () => trpcClient.vlm.extract.get.query({ extractionId }),
  });

  const { data: proposals, isLoading: loadingProposals } = useQuery({
    queryKey: ['vlm-proposals', extractionId],
    queryFn: () => trpcClient.vlm.proposals.listByExtraction.query({ extractionId }),
  });

  const { data: risk } = useQuery({
    queryKey: ['vlm-risk', extractionId],
    queryFn: () => {
      const contentId = (extraction as any)?.contentId;
      if (!contentId) return null;
      return trpcClient.vlm.moderation.riskScore.query({ contentId });
    },
    enabled: Boolean(extraction),
  });

  const acceptMutation = useMutation({
    mutationFn: (proposalId: string) =>
      trpcClient.vlm.proposals.accept.mutate({ proposalId, overrides: {} }),
    onSuccess: () => {
      toast.success('Entity added to canon');
      queryClient.invalidateQueries({ queryKey: ['vlm-proposals', extractionId] });
    },
    onError: (e: any) => toast.error(e.message || 'Accept failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: (proposalId: string) => trpcClient.vlm.proposals.reject.mutate({ proposalId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vlm-proposals', extractionId] });
    },
    onError: (e: any) => toast.error(e.message || 'Reject failed'),
  });

  const mergeMutation = useMutation({
    mutationFn: (args: { proposalId: string; targetEntityId: string }) =>
      trpcClient.vlm.proposals.merge.mutate(args),
    onSuccess: () => {
      toast.success('Merged into existing entity');
      setMergeDialog(null);
      setMergeTarget('');
      queryClient.invalidateQueries({ queryKey: ['vlm-proposals', extractionId] });
    },
    onError: (e: any) => toast.error(e.message || 'Merge failed'),
  });

  if (isLoading || !extraction) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const ex = extraction as any;
  const proposalList = (proposals as any[]) ?? [];
  const pendingCount = proposalList.filter((p) => p.status === 'pending').length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Extracted Lore
            </CardTitle>
            <div className="flex items-center gap-2">
              <RiskBadge risk={risk as any} />
              <Badge variant="outline" className="text-[10px]">
                {ex.model}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{ex.summary}</p>
          {ex.durationSec ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> {formatTimestamp(ex.durationSec)} duration
            </p>
          ) : null}
          {ex.risks?.length ? (
            <div className="flex flex-wrap gap-1">
              {ex.risks.map((r: any, i: number) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="text-[10px] text-rose-300 border-rose-500/40"
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  {r.kind} · {(r.score * 100).toFixed(0)}%
                </Badge>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Scenes */}
      {ex.scenes?.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Scenes</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ol className="divide-y">
              {ex.scenes.map((s: any) => (
                <li key={s.index} className="p-3 text-xs space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground">
                      {formatTimestamp(s.startSec)}–{formatTimestamp(s.endSec)}
                    </span>
                    {s.shotType ? (
                      <Badge variant="outline" className="text-[9px]">
                        {s.shotType}
                      </Badge>
                    ) : null}
                    {s.location ? (
                      <span className="text-muted-foreground">{s.location}</span>
                    ) : null}
                  </div>
                  <p>{s.description}</p>
                  {s.subjects?.length ? (
                    <p className="text-muted-foreground">Subjects: {s.subjects.join(', ')}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {/* Proposals */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Entity Proposals
            {pendingCount > 0 ? (
              <Badge variant="destructive" className="text-[10px]">
                {pendingCount} pending
              </Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingProposals ? (
            <div className="flex justify-center py-6">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : proposalList.length === 0 ? (
            <p className="text-xs text-muted-foreground p-4">
              No entity proposals for this extraction.
            </p>
          ) : (
            <ul className="divide-y">
              {proposalList.map((p: any) => (
                <li key={p.id} className="p-3 text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">
                      {p.kind}
                    </Badge>
                    <span className="font-semibold">{p.name}</span>
                    <Badge
                      variant="outline"
                      className={`text-[9px] ${
                        p.status === 'accepted'
                          ? 'text-emerald-300 border-emerald-500/40'
                          : p.status === 'rejected'
                            ? 'text-rose-300 border-rose-500/40'
                            : p.status === 'merged'
                              ? 'text-sky-300 border-sky-500/40'
                              : ''
                      }`}
                    >
                      {p.status}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{p.description}</p>
                  {p.status === 'pending' ? (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="default"
                        className="h-7"
                        disabled={acceptMutation.isPending}
                        onClick={() => acceptMutation.mutate(p.id)}
                      >
                        <Check className="h-3 w-3 mr-1" /> Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7"
                        disabled={rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate(p.id)}
                      >
                        <X className="h-3 w-3 mr-1" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7"
                        onClick={() => setMergeDialog({ proposalId: p.id, name: p.name })}
                      >
                        <GitMerge className="h-3 w-3 mr-1" /> Merge
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {mergeDialog ? (
        <Card className="border-primary/40">
          <CardContent className="p-3 space-y-2 text-xs">
            <p>
              Merge proposal <span className="font-semibold">{mergeDialog.name}</span> into existing
              entity (paste entity id):
            </p>
            <input
              className="w-full bg-background border rounded px-2 py-1 text-xs"
              value={mergeTarget}
              onChange={(e) => setMergeTarget(e.target.value)}
              placeholder="entity id"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="h-7"
                disabled={!mergeTarget || mergeMutation.isPending}
                onClick={() =>
                  mergeMutation.mutate({
                    proposalId: mergeDialog.proposalId,
                    targetEntityId: mergeTarget.trim(),
                  })
                }
              >
                Merge
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => {
                  setMergeDialog(null);
                  setMergeTarget('');
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
