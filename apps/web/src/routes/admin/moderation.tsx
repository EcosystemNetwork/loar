/**
 * Admin Moderation Dashboard — Review flagged content and DMCA takedowns.
 *
 * Admin-only page. Shows pending flags, takedown requests, and audit log.
 */
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpcClient } from '@/utils/trpc';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';
import {
  Shield,
  Flag,
  FileWarning,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Trash2,
  RotateCcw,
  Loader2,
  Clock,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import { RiskBadge } from '@/components/vlm/RiskBadge';

export const Route = createFileRoute('/admin/moderation')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/moderation' } });
    }
  },
  component: ModerationDashboard,
});

function ModerationDashboard() {
  const { isAuthenticated, isAuthenticating, address } = useWalletAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('flags');

  // Admin address check
  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());

  const { data: flags, isLoading: loadingFlags } = useQuery({
    queryKey: ['mod-flags'],
    queryFn: () =>
      trpcClient.moderation.reviewQueue.query({ type: 'flags', status: 'pending', limit: 50 }),
    enabled: isAuthenticated,
  });

  // VLM risk scores for all flagged content (one batch call — cheaper than per-row)
  const flagContentIds = ((flags as any[]) ?? []).map((f) => f.contentId as string).filter(Boolean);
  const { data: vlmRiskMap } = useQuery({
    queryKey: ['mod-vlm-risk', flagContentIds.join(',')],
    queryFn: () =>
      flagContentIds.length
        ? trpcClient.vlm.moderation.batchRiskScores.query({ contentIds: flagContentIds })
        : Promise.resolve({} as Record<string, any>),
    enabled: isAuthenticated && flagContentIds.length > 0,
  });

  const { data: takedowns, isLoading: loadingTakedowns } = useQuery({
    queryKey: ['mod-takedowns'],
    queryFn: () =>
      trpcClient.moderation.reviewQueue.query({ type: 'takedowns', status: 'pending', limit: 50 }),
    enabled: isAuthenticated,
  });

  const { data: auditLog } = useQuery({
    queryKey: ['mod-audit'],
    queryFn: () => trpcClient.moderation.auditLog.query({ limit: 50 }),
    enabled: isAuthenticated,
  });

  const updateStatusMutation = useMutation({
    mutationFn: (data: {
      contentId: string;
      newStatus: 'active' | 'flagged' | 'under_review' | 'hidden' | 'removed' | 'reinstated';
      reason?: string;
    }) => trpcClient.moderation.updateContentStatus.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mod-flags'] });
      toast.success('Content status updated');
    },
  });

  const resolveTakedownMutation = useMutation({
    mutationFn: (data: { takedownId: string; action: 'actioned' | 'rejected'; reason?: string }) =>
      trpcClient.moderation.resolveTakedown.mutate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mod-takedowns'] });
      toast.success('Takedown resolved');
    },
  });

  if (isAuthenticating) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-2">
          <Shield className="h-12 w-12 mx-auto text-red-400" />
          <h2 className="text-xl font-bold">Unauthorized</h2>
          <p className="text-muted-foreground text-sm">
            Your wallet address does not have admin access.
          </p>
        </div>
      </div>
    );
  }

  const statusActions = [
    { status: 'active' as const, label: 'Restore', icon: RotateCcw, color: 'text-green-500' },
    { status: 'hidden' as const, label: 'Hide', icon: EyeOff, color: 'text-yellow-500' },
    { status: 'removed' as const, label: 'Remove', icon: Trash2, color: 'text-red-500' },
  ];

  return (
    <div className="min-h-screen bg-background p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-6 w-6" /> Content Moderation
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review flagged content, DMCA takedown requests, and audit history
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Flag className="h-8 w-8 text-orange-500" />
            <div>
              <p className="text-2xl font-bold">{(flags as any[])?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">Pending Flags</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <FileWarning className="h-8 w-8 text-red-500" />
            <div>
              <p className="text-2xl font-bold">{(takedowns as any[])?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">DMCA Requests</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">{(auditLog as any[])?.length ?? 0}</p>
              <p className="text-xs text-muted-foreground">Audit Entries</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="flags">
            Flags{' '}
            {(flags as any[])?.length ? (
              <Badge variant="destructive" className="ml-1 text-[10px]">
                {(flags as any[]).length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="takedowns">
            DMCA{' '}
            {(takedowns as any[])?.length ? (
              <Badge variant="destructive" className="ml-1 text-[10px]">
                {(takedowns as any[]).length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        {/* Flags Tab */}
        <TabsContent value="flags">
          {loadingFlags ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin" />
            </div>
          ) : !(flags as any[])?.length ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No pending flags
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(flags as any[]).map((flag: any) => (
                <Card key={flag.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <AlertTriangle className="h-4 w-4 text-orange-500" />
                          <span className="font-semibold text-sm">Content: {flag.contentId}</span>
                          <Badge variant="outline" className="text-[10px]">
                            {flag.reason}
                          </Badge>
                          {flag.source === 'vlm' ? (
                            <Badge
                              variant="outline"
                              className="text-[10px] border-primary/40 text-primary"
                            >
                              <Sparkles className="h-3 w-3 mr-1" /> VLM auto-flag
                            </Badge>
                          ) : null}
                          <RiskBadge risk={(vlmRiskMap as any)?.[flag.contentId] ?? null} compact />
                        </div>
                        {flag.description && (
                          <p className="text-xs text-muted-foreground">{flag.description}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          Flagged by {flag.flaggerAddress?.slice(0, 8) ?? 'system'}... on{' '}
                          {new Date(flag.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        {statusActions.map((action) => {
                          const Icon = action.icon;
                          return (
                            <Button
                              key={action.status}
                              size="sm"
                              variant="ghost"
                              className="h-8"
                              onClick={() =>
                                updateStatusMutation.mutate({
                                  contentId: flag.contentId,
                                  newStatus: action.status,
                                })
                              }
                              disabled={updateStatusMutation.isPending}
                            >
                              <Icon className={`h-3 w-3 mr-1 ${action.color}`} />
                              <span className="text-xs">{action.label}</span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Takedowns Tab */}
        <TabsContent value="takedowns">
          {loadingTakedowns ? (
            <div className="flex justify-center py-12">
              <Loader2 className="animate-spin" />
            </div>
          ) : !(takedowns as any[])?.length ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No pending takedowns
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {(takedowns as any[]).map((td: any) => (
                <Card key={td.id}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileWarning className="h-4 w-4 text-red-500" />
                        <span className="font-semibold text-sm">Content: {td.contentId}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {td.status}
                      </Badge>
                    </div>
                    <div className="text-xs space-y-1">
                      <p>
                        <span className="text-muted-foreground">Claimant:</span> {td.claimantName} (
                        {td.claimantEmail})
                      </p>
                      <p>
                        <span className="text-muted-foreground">Original work:</span>{' '}
                        {td.copyrightWork}
                      </p>
                      <p>
                        <span className="text-muted-foreground">Explanation:</span> {td.explanation}
                      </p>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          resolveTakedownMutation.mutate({ takedownId: td.id, action: 'actioned' })
                        }
                        disabled={resolveTakedownMutation.isPending}
                        className="flex-1"
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> Remove Content
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          resolveTakedownMutation.mutate({ takedownId: td.id, action: 'rejected' })
                        }
                        disabled={resolveTakedownMutation.isPending}
                        className="flex-1"
                      >
                        <XCircle className="h-3 w-3 mr-1" /> Reject Claim
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Audit Log Tab */}
        <TabsContent value="audit">
          {!(auditLog as any[])?.length ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                No audit entries yet
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-1">
              {(auditLog as any[]).map((entry: any) => (
                <div key={entry.id} className="flex items-center gap-3 p-2 text-xs border-b">
                  <Clock className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <span className="text-muted-foreground w-32 flex-shrink-0">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  <Badge variant="outline" className="text-[9px]">
                    {entry.action}
                  </Badge>
                  <span className="text-muted-foreground truncate">
                    {entry.contentId && `Content: ${entry.contentId}`}
                    {entry.takedownId && `Takedown: ${entry.takedownId}`}
                    {entry.reason && ` — ${entry.reason}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
