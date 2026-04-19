/**
 * DMCA Takedown Request page.
 *
 * Public form for copyright holders to submit takedown requests.
 * Submits to the server's /api/takedown REST endpoint.
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/dmca')({
  component: DmcaPage,
});

function DmcaPage() {
  const [form, setForm] = useState({
    contentId: '',
    claimantName: '',
    claimantEmail: '',
    claimantAddress: '',
    claimantPhone: '',
    copyrightWork: '',
    explanation: '',
    goodFaith: false,
    swornStatement: false,
    signature: '',
  });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg('');

    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
      const res = await fetch(`${serverUrl}/api/takedown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to submit takedown request');
      }

      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Something went wrong');
    }
  };

  if (status === 'success') {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-6 py-16 text-center">
          <h1 className="text-3xl font-bold mb-4">Request Received</h1>
          <p className="text-muted-foreground">
            Your DMCA takedown request has been submitted. We will review it within 72 hours and
            contact you at the email address provided.
          </p>
        </div>
      </div>
    );
  }

  const CounterNoticeLink = (
    <p className="text-sm text-muted-foreground mt-2">
      If your content was removed by mistake, you may file a{' '}
      <a href="/counter-notice" className="text-primary underline">
        counter-notice
      </a>{' '}
      under 17 U.S.C. § 512(g).
    </p>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">DMCA Takedown Request</h1>
        <p className="text-sm text-muted-foreground mb-2">
          If you believe content on LOAR infringes your copyright, please submit a takedown request
          using the form below.
        </p>
        {CounterNoticeLink}
        <div className="h-6" />

        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 mb-8 text-sm text-muted-foreground space-y-3">
          <p>
            <strong className="text-foreground">On-chain permanence:</strong> Content metadata
            hashes stored on the blockchain cannot be deleted. While infringing content will be
            removed from the platform interface, on-chain records (content hashes, transaction
            history, NFT metadata) are immutable and persist on the Base L2 public ledger
            indefinitely.
          </p>
          <p>
            <strong className="text-foreground">Designated DMCA Agent:</strong> [DMCA Agent Name —
            TO BE FILED]
            <br />
            [Email — TO BE FILED]
            <br />
            [Physical Address — TO BE FILED]
          </p>
          <p>
            <strong className="text-foreground">512(c) Safe Harbor:</strong> LOAR maintains a
            designated agent registration with the U.S. Copyright Office pursuant to 17 U.S.C.
            Section 512(c). The current filing fee for agent designation is $6, payable to the
            Copyright Office. Our agent registration status is available at{' '}
            <a
              href="https://www.copyright.gov/dmca-directory/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              copyright.gov/dmca-directory
            </a>
            .
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-1">Content ID</label>
            <input
              type="text"
              required
              value={form.contentId}
              onChange={(e) => setForm((f) => ({ ...f, contentId: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="The ID of the infringing content"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Your Name</label>
            <input
              type="text"
              required
              value={form.claimantName}
              onChange={(e) => setForm((f) => ({ ...f, claimantName: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Your Email</label>
            <input
              type="email"
              required
              value={form.claimantEmail}
              onChange={(e) => setForm((f) => ({ ...f, claimantEmail: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Physical Address{' '}
              <span className="text-muted-foreground">
                (required by 17 U.S.C. § 512(c)(3)(A)(iv))
              </span>
            </label>
            <textarea
              required
              rows={2}
              value={form.claimantAddress}
              onChange={(e) => setForm((f) => ({ ...f, claimantAddress: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Street, City, State/Region, Postal Code, Country"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Phone Number{' '}
              <span className="text-muted-foreground">
                (required by 17 U.S.C. § 512(c)(3)(A)(iv))
              </span>
            </label>
            <input
              type="tel"
              required
              value={form.claimantPhone}
              onChange={(e) => setForm((f) => ({ ...f, claimantPhone: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="+1 555 123 4567"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Original Copyrighted Work</label>
            <textarea
              required
              rows={3}
              value={form.copyrightWork}
              onChange={(e) => setForm((f) => ({ ...f, copyrightWork: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Describe the original work that has been infringed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Explanation</label>
            <textarea
              required
              rows={3}
              value={form.explanation}
              onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Explain how the content infringes your copyright"
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={form.goodFaith}
              onChange={(e) => setForm((f) => ({ ...f, goodFaith: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              <strong className="text-foreground">§ 512(c)(3)(A)(v) — Good-Faith Belief.</strong> I
              have a good faith belief that the use of the copyrighted material described above is
              not authorized by the copyright owner, its agent, or the law.
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={form.swornStatement}
              onChange={(e) => setForm((f) => ({ ...f, swornStatement: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              <strong className="text-foreground">§ 512(c)(3)(A)(vi) — Sworn Statement.</strong> I
              state, under penalty of perjury, that the information in this notification is accurate
              and that I am the copyright owner, or am authorized to act on behalf of the owner, of
              an exclusive right that is allegedly infringed.
            </span>
          </label>

          <div>
            <label className="block text-sm font-medium mb-1">
              Electronic Signature{' '}
              <span className="text-muted-foreground">
                (type your full legal name — 17 U.S.C. § 512(c)(3)(A)(i))
              </span>
            </label>
            <input
              type="text"
              required
              value={form.signature}
              onChange={(e) => setForm((f) => ({ ...f, signature: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Full legal name"
            />
          </div>

          {status === 'error' && <div className="text-sm text-red-400">{errorMsg}</div>}

          <button
            type="submit"
            disabled={status === 'submitting'}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {status === 'submitting' ? 'Submitting...' : 'Submit Takedown Request'}
          </button>
        </form>
      </div>
    </div>
  );
}
