/**
 * Filmmaker Residency — public showcase + application form.
 *
 * LOAR's curated creator program. Browse the current cohort, apply with a
 * portfolio link + statement + sample-work URLs. Admin curation happens
 * elsewhere (admin queue).
 */

import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { trpcClient } from '@/utils/trpc';
import { useWalletAuth } from '@/lib/wallet-auth';

export const Route = createFileRoute('/residency')({
  component: ResidencyPage,
});

interface PublicResident {
  id: string;
  applicantUid: string;
  applicantAddress?: string;
  name: string;
  portfolioUrl: string;
  sampleWorkUrls: string[];
  cohort: string;
  status: 'accepted';
  submittedAt: Date;
  reviewedAt?: Date;
}

interface MyApplication {
  id: string;
  name: string;
  portfolioUrl: string;
  status: 'pending' | 'accepted' | 'rejected';
  cohort: string;
  submittedAt: Date;
}

function ResidencyPage() {
  const { isAuthenticated } = useWalletAuth();
  const [showApplyForm, setShowApplyForm] = useState(false);

  const cohortQuery = useQuery({
    queryKey: ['residency', 'cohort', 'default'],
    queryFn: () =>
      trpcClient.residencies.cohort.query({ cohort: 'default' }) as unknown as Promise<
        PublicResident[]
      >,
  });

  const myAppsQuery = useQuery({
    queryKey: ['residency', 'mine'],
    queryFn: () => trpcClient.residencies.mine.query() as unknown as Promise<MyApplication[]>,
    enabled: isAuthenticated,
  });

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold">LOAR Filmmaker Residency</h1>
        <p className="text-muted-foreground max-w-2xl">
          A curated cohort of emerging AI-native filmmakers. Residents get featured placement,
          access to premium model routes, and a path into LOAR's festival pipeline. Apply with a
          portfolio link, a short statement of intent, and sample work.
        </p>
      </header>

      {/* My applications */}
      {isAuthenticated && myAppsQuery.data && myAppsQuery.data.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Your Applications
          </h2>
          <div className="space-y-1.5">
            {myAppsQuery.data.map((app) => (
              <div
                key={app.id}
                className="flex items-center justify-between gap-3 p-3 rounded border"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{app.name}</div>
                  <a
                    href={app.portfolioUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:underline truncate block"
                  >
                    {app.portfolioUrl}
                  </a>
                </div>
                <StatusBadge status={app.status} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Apply */}
      <section>
        {!showApplyForm ? (
          <button
            onClick={() => setShowApplyForm(true)}
            disabled={!isAuthenticated}
            className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            {isAuthenticated ? 'Apply to the residency' : 'Connect wallet to apply'}
          </button>
        ) : (
          <ApplyForm
            onCancel={() => setShowApplyForm(false)}
            onSuccess={() => {
              setShowApplyForm(false);
              myAppsQuery.refetch();
            }}
          />
        )}
      </section>

      {/* Cohort showcase */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Current Cohort
        </h2>
        {cohortQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !cohortQuery.data || cohortQuery.data.length === 0 ? (
          <div className="text-sm text-muted-foreground border rounded p-6 text-center">
            The first cohort is being assembled. Apply above to be considered.
          </div>
        ) : (
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {cohortQuery.data.map((resident) => (
              <article key={resident.id} className="border rounded p-4 space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-medium truncate">{resident.name}</h3>
                </div>
                <a
                  href={resident.portfolioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline truncate block"
                >
                  Portfolio →
                </a>
                {resident.sampleWorkUrls.length > 0 && (
                  <div className="grid grid-cols-3 gap-1">
                    {resident.sampleWorkUrls.slice(0, 3).map((url, i) => (
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
                        />
                      </a>
                    ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatusBadge({ status }: { status: 'pending' | 'accepted' | 'rejected' }) {
  const styles = {
    pending: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30',
    accepted: 'bg-green-500/10 text-green-600 border-green-500/30',
    rejected: 'bg-red-500/10 text-red-600 border-red-500/30',
  } as const;
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${styles[status]}`}>{status}</span>
  );
}

function ApplyForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) {
  const [name, setName] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [statement, setStatement] = useState('');
  const [sampleUrls, setSampleUrls] = useState('');

  const applyMutation = useMutation({
    mutationFn: (input: {
      name: string;
      portfolioUrl: string;
      statement: string;
      sampleWorkUrls: string[];
    }) => trpcClient.residencies.apply.mutate(input),
    onSuccess: () => {
      toast.success('Application submitted');
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message || 'Failed to submit'),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const urls = sampleUrls
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (urls.length === 0) {
      toast.error('Add at least one sample work URL');
      return;
    }
    applyMutation.mutate({
      name: name.trim(),
      portfolioUrl: portfolioUrl.trim(),
      statement: statement.trim(),
      sampleWorkUrls: urls,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="border rounded p-4 space-y-3 bg-muted/30">
      <h2 className="font-medium">Apply to the residency</h2>
      <div className="space-y-2">
        <label className="block">
          <span className="text-xs text-muted-foreground">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            className="mt-1 w-full text-sm px-2 py-1.5 rounded border bg-background"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Portfolio URL</span>
          <input
            type="url"
            value={portfolioUrl}
            onChange={(e) => setPortfolioUrl(e.target.value)}
            required
            className="mt-1 w-full text-sm px-2 py-1.5 rounded border bg-background"
            placeholder="https://yourportfolio.com"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Statement of intent (50–2000 chars)</span>
          <textarea
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            required
            minLength={50}
            maxLength={2000}
            rows={5}
            className="mt-1 w-full text-sm px-2 py-1.5 rounded border bg-background"
            placeholder="What kind of films do you want to make on LOAR? What does AI-native filmmaking mean to you?"
          />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">
            Sample work URLs (one per line or comma-separated, 1–8)
          </span>
          <textarea
            value={sampleUrls}
            onChange={(e) => setSampleUrls(e.target.value)}
            required
            rows={3}
            className="mt-1 w-full text-sm px-2 py-1.5 rounded border bg-background"
            placeholder="https://…/scene1.mp4&#10;https://…/scene2.mp4"
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={applyMutation.isPending}
          className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
        >
          {applyMutation.isPending ? 'Submitting…' : 'Submit application'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={applyMutation.isPending}
          className="px-3 py-1.5 rounded border text-sm"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
