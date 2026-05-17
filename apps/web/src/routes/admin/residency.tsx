/**
 * Admin Residency Queue — review pending applications, accept/reject.
 *
 * Mirrors the /admin/moderation pattern: SIWE session + ADMIN_ADDRESSES
 * allowlist gate on the client; server enforces admin via adminProcedure.
 */

import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';
import { CheckCircle2, XCircle, ShieldAlert } from 'lucide-react';

export const Route = createFileRoute('/admin/residency')({
  beforeLoad: ({ context }) => {
    if (!context.hasSession()) {
      throw redirect({ to: '/login', search: { redirect: '/admin/residency' } });
    }
  },
  component: AdminResidencyPage,
});

interface AdminApplication {
  id: string;
  applicantUid: string;
  applicantAddress?: string;
  name: string;
  portfolioUrl: string;
  statement: string;
  sampleWorkUrls: string[];
  cohort: string;
  status: 'pending' | 'accepted' | 'rejected';
  reviewerNote?: string;
  submittedAt: string;
  reviewedAt?: string;
}

function AdminResidencyPage() {
  const { isAuthenticated, address } = useWalletAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'accepted' | 'rejected'>('pending');

  const adminAddresses = (import.meta.env.VITE_ADMIN_ADDRESSES ?? '')
    .split(',')
    .map((a: string) => a.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = !!address && adminAddresses.includes(address.toLowerCase());

  const listQuery = useQuery({
    queryKey: ['admin', 'residency', tab],
    queryFn: () =>
      trpcClient.residencies.listApplications.query({
        status: tab,
        limit: 100,
      }) as unknown as Promise<AdminApplication[]>,
    enabled: isAuthenticated && isAdmin,
  });

  const reviewMutation = useMutation({
    mutationFn: (input: { id: string; status: 'accepted' | 'rejected'; reviewerNote?: string }) =>
      trpcClient.residencies.review.mutate(input),
    onSuccess: () => {
      toast.success('Application reviewed');
      queryClient.invalidateQueries({ queryKey: ['admin', 'residency'] });
    },
    onError: (err: any) => toast.error(err.message || 'Review failed'),
  });

  if (!isAuthenticated) {
    return <div className="p-8 text-muted-foreground">Sign in required.</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-8 flex items-start gap-3 max-w-xl">
        <ShieldAlert className="h-5 w-5 text-red-500 mt-0.5" />
        <div>
          <p className="font-medium">Admin only</p>
          <p className="text-sm text-muted-foreground">
            Your wallet ({address}) is not on the ADMIN_ADDRESSES allowlist.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Residency Review Queue</h1>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="accepted">Accepted</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="space-y-3 mt-4">
          {listQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : !listQuery.data || listQuery.data.length === 0 ? (
            <div className="text-sm text-muted-foreground border rounded p-6 text-center">
              No {tab} applications.
            </div>
          ) : (
            listQuery.data.map((app) => (
              <ApplicationCard
                key={app.id}
                app={app}
                onReview={(status, note) =>
                  reviewMutation.mutate({ id: app.id, status, reviewerNote: note })
                }
                reviewing={reviewMutation.isPending}
              />
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ApplicationCard({
  app,
  onReview,
  reviewing,
}: {
  app: AdminApplication;
  onReview: (status: 'accepted' | 'rejected', note?: string) => void;
  reviewing: boolean;
}) {
  const [note, setNote] = useState('');
  const isPending = app.status === 'pending';

  return (
    <article className="border rounded p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="font-medium">{app.name}</h2>
          <a
            href={app.portfolioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline"
          >
            {app.portfolioUrl}
          </a>
        </div>
        <div className="text-[10px] text-muted-foreground text-right">
          <div>Cohort: {app.cohort}</div>
          <div>{new Date(app.submittedAt).toLocaleDateString()}</div>
          {app.applicantAddress && (
            <div className="font-mono mt-0.5">
              {app.applicantAddress.slice(0, 6)}…{app.applicantAddress.slice(-4)}
            </div>
          )}
        </div>
      </header>

      <p className="text-sm whitespace-pre-wrap">{app.statement}</p>

      {app.sampleWorkUrls.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1">
          {app.sampleWorkUrls.map((url, i) => (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block aspect-square rounded overflow-hidden bg-muted"
            >
              <img
                src={url}
                alt={`Sample ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = '0.2';
                }}
              />
            </a>
          ))}
        </div>
      )}

      {app.reviewerNote && !isPending && (
        <div className="text-xs bg-muted/40 rounded p-2">
          <span className="text-muted-foreground">Reviewer note: </span>
          {app.reviewerNote}
        </div>
      )}

      {isPending && (
        <div className="border-t pt-3 space-y-2">
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Reviewer note (optional)"
            maxLength={500}
            className="w-full text-xs px-2 py-1.5 rounded border bg-background"
            disabled={reviewing}
          />
          <div className="flex gap-2">
            <button
              onClick={() => onReview('accepted', note || undefined)}
              disabled={reviewing}
              className="flex-1 px-3 py-1.5 rounded bg-green-500/10 text-green-600 border border-green-500/30 text-sm flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Accept
            </button>
            <button
              onClick={() => onReview('rejected', note || undefined)}
              disabled={reviewing}
              className="flex-1 px-3 py-1.5 rounded bg-red-500/10 text-red-600 border border-red-500/30 text-sm flex items-center justify-center gap-1 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
