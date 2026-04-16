/**
 * Collabs Hub — Browse and manage cross-universe collaborations
 *
 * Tabs:
 *   Active     — current active collabs with episode tracking
 *   Proposals  — incoming/outgoing proposals needing action
 *   History    — completed and cancelled collabs
 */
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import {
  Handshake,
  Plus,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  Zap,
  ArrowRight,
  Film,
  Banknote,
  Users,
  Send,
  Inbox,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  useMyCollabs,
  useAcceptCollab,
  useActivateCollab,
  useCancelCollab,
} from '@/hooks/useRevenue';
import { useWalletAuth } from '@/lib/wallet-auth';
import { toast } from 'sonner';

export const Route = createFileRoute('/collabs/')({
  beforeLoad: () => {
    throw redirect({ to: '/coming-soon' });
  },
  component: CollabsHubPage,
});

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  PROPOSED: {
    label: 'Proposed',
    color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    icon: <Clock className="w-3 h-3" />,
  },
  ACCEPTED: {
    label: 'Accepted',
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  ACTIVE: {
    label: 'Active',
    color: 'bg-green-500/10 text-green-400 border-green-500/20',
    icon: <Zap className="w-3 h-3" />,
  },
  COMPLETED: {
    label: 'Completed',
    color: 'bg-muted text-muted-foreground border-border',
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'bg-red-500/10 text-red-400 border-red-500/20',
    icon: <XCircle className="w-3 h-3" />,
  },
};

type Tab = 'active' | 'proposals' | 'history';

function CollabsHubPage() {
  const { isAuthenticated, address: uid } = useWalletAuth();
  const [tab, setTab] = useState<Tab>('active');
  const { data: collabs, isLoading } = useMyCollabs(isAuthenticated);
  const acceptCollab = useAcceptCollab();
  const activateCollab = useActivateCollab();
  const cancelCollab = useCancelCollab();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const active = (collabs ?? []).filter((c: any) => c.status === 'ACTIVE');
  const proposals = (collabs ?? []).filter(
    (c: any) => c.status === 'PROPOSED' || c.status === 'ACCEPTED'
  );
  const history = (collabs ?? []).filter(
    (c: any) => c.status === 'COMPLETED' || c.status === 'CANCELLED'
  );

  async function handleAccept(collabId: string) {
    setPendingId(collabId);
    try {
      await acceptCollab.mutateAsync({ collabId });
      toast.success('Collaboration accepted! Ready to activate.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to accept');
    } finally {
      setPendingId(null);
    }
  }

  async function handleActivate(collabId: string) {
    setPendingId(collabId);
    try {
      await activateCollab.mutateAsync({ collabId });
      toast.success('Collaboration is now active!');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to activate');
    } finally {
      setPendingId(null);
    }
  }

  async function handleCancel(collabId: string) {
    if (!window.confirm('Are you sure you want to cancel this collaboration?')) return;
    setPendingId(collabId);
    try {
      await cancelCollab.mutateAsync({ collabId });
      toast.success('Collaboration cancelled.');
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to cancel');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-b from-primary/10 to-background px-4 pt-6 pb-4">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-1">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Handshake className="w-6 h-6 text-primary" />
                Collaborations
              </h1>
              <p className="text-sm text-muted-foreground">
                Cross-universe partnerships with shared revenue
              </p>
            </div>
            {isAuthenticated && (
              <Link to="/collabs/new">
                <Button size="sm" className="gap-1">
                  <Plus className="w-4 h-4" />
                  Propose
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4">
        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b">
          {[
            { key: 'active' as Tab, label: 'Active', count: active.length },
            { key: 'proposals' as Tab, label: 'Proposals', count: proposals.length },
            { key: 'history' as Tab, label: 'History', count: history.length },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <Badge variant="secondary" className="ml-1.5 text-xs px-1.5 py-0">
                  {t.count}
                </Badge>
              )}
            </button>
          ))}
        </div>

        {!isAuthenticated ? (
          <div className="text-center py-16 text-muted-foreground">
            <Handshake className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Connect your wallet</p>
            <p className="text-sm mt-1">to view and manage collaborations</p>
          </div>
        ) : isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {tab === 'active' && <ActiveTab collabs={active} />}
            {tab === 'proposals' && (
              <ProposalsTab
                collabs={proposals}
                currentUid={uid ?? ''}
                onAccept={handleAccept}
                onActivate={handleActivate}
                onCancel={handleCancel}
                pendingId={pendingId}
              />
            )}
            {tab === 'history' && <HistoryTab collabs={history} />}
          </>
        )}
      </div>
    </div>
  );
}

function ActiveTab({ collabs }: { collabs: any[] }) {
  if (collabs.length === 0) {
    return (
      <div className="space-y-6">
        {/* How it works */}
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-2 pt-4 px-4">
            <h3 className="text-sm font-semibold">How Collaborations Work</h3>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-2.5">
              {[
                {
                  icon: <Send className="w-4 h-4" />,
                  text: 'Propose a cross-universe collaboration with revenue sharing',
                },
                {
                  icon: <Inbox className="w-4 h-4" />,
                  text: 'The other universe creator accepts and activates',
                },
                {
                  icon: <Film className="w-4 h-4" />,
                  text: 'Create joint episodes that blend both universes',
                },
                {
                  icon: <Banknote className="w-4 h-4" />,
                  text: 'Revenue is automatically split per the agreed terms',
                },
              ].map((step, i) => (
                <div key={i} className="flex items-start gap-2.5 text-sm">
                  <div className="shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                    {step.icon}
                  </div>
                  <span className="text-muted-foreground pt-0.5">{step.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="text-center py-8 text-muted-foreground">
          <Handshake className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No active collaborations</p>
          <p className="text-sm mt-1 mb-4">Propose one to start creating together</p>
          <Link to="/collabs/new">
            <Button variant="outline" size="sm" className="gap-1">
              Propose a Collab
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {collabs.map((collab: any) => (
        <CollabCard key={collab.id} collab={collab} />
      ))}
    </div>
  );
}

function ProposalsTab({
  collabs,
  currentUid,
  onAccept,
  onActivate,
  onCancel,
  pendingId,
}: {
  collabs: any[];
  currentUid: string;
  onAccept: (id: string) => void;
  onActivate: (id: string) => void;
  onCancel: (id: string) => void;
  pendingId: string | null;
}) {
  if (collabs.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Inbox className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No pending proposals</p>
        <p className="text-sm mt-1 mb-4">Your incoming and outgoing proposals appear here</p>
        <Link to="/collabs/new">
          <Button variant="outline" size="sm">
            Propose a Collab
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {collabs.map((collab: any) => {
        const isProposer = collab.proposerUid === currentUid;
        const canAccept = !isProposer && collab.status === 'PROPOSED';
        const canActivate = collab.status === 'ACCEPTED';
        const canCancel =
          isProposer && (collab.status === 'PROPOSED' || collab.status === 'ACCEPTED');

        return (
          <Card key={collab.id} className="border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-medium text-sm">{collab.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {collab.universeA?.slice(0, 8)}… x {collab.universeB?.slice(0, 8)}…
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs gap-1">
                    {isProposer ? <Send className="w-3 h-3" /> : <Inbox className="w-3 h-3" />}
                    {isProposer ? 'Sent' : 'Received'}
                  </Badge>
                  <StatusBadge status={collab.status} />
                </div>
              </div>

              <p className="text-xs text-muted-foreground mb-3 line-clamp-2">
                {collab.description}
              </p>

              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <span>{(collab.revenueShareBps / 100).toFixed(1)}% revenue share</span>
                <span>·</span>
                <span>{collab.durationDays} days</span>
              </div>

              <div className="flex gap-2">
                {canAccept && (
                  <Button
                    size="sm"
                    onClick={() => onAccept(collab.id)}
                    disabled={pendingId === collab.id}
                    className="gap-1"
                  >
                    {pendingId === collab.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3 h-3" />
                    )}
                    Accept
                  </Button>
                )}
                {canActivate && (
                  <Button
                    size="sm"
                    onClick={() => onActivate(collab.id)}
                    disabled={pendingId === collab.id}
                    className="gap-1"
                  >
                    {pendingId === collab.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Zap className="w-3 h-3" />
                    )}
                    Activate
                  </Button>
                )}
                {canCancel && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCancel(collab.id)}
                    disabled={pendingId === collab.id}
                    className="gap-1 text-red-400 border-red-500/30 hover:bg-red-500/10"
                  >
                    {pendingId === collab.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <XCircle className="w-3 h-3" />
                    )}
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function HistoryTab({ collabs }: { collabs: any[] }) {
  if (collabs.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Clock className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="font-medium">No history yet</p>
        <p className="text-sm mt-1">Completed and cancelled collabs appear here</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {collabs.map((collab: any) => (
        <CollabCard key={collab.id} collab={collab} />
      ))}
    </div>
  );
}

function CollabCard({ collab }: { collab: any }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="font-medium text-sm">{collab.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {collab.universeA?.slice(0, 8)}… x {collab.universeB?.slice(0, 8)}…
            </p>
          </div>
          <StatusBadge status={collab.status} />
        </div>

        {collab.description && (
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{collab.description}</p>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Stat
            icon={<Banknote className="w-3.5 h-3.5 text-primary" />}
            label="Revenue Share"
            value={`${(collab.revenueShareBps / 100).toFixed(1)}%`}
          />
          <Stat
            icon={<Film className="w-3.5 h-3.5 text-blue-400" />}
            label="Episodes"
            value={String(collab.episodeCount ?? 0)}
          />
          <Stat
            icon={<Clock className="w-3.5 h-3.5 text-muted-foreground" />}
            label="Duration"
            value={`${collab.durationDays}d`}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.PROPOSED;
  return (
    <Badge variant="outline" className={`text-xs gap-1 ${config.color}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="flex justify-center mb-0.5">{icon}</div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}
