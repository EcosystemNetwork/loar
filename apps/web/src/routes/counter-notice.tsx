/**
 * DMCA Counter-Notice page (17 U.S.C. § 512(g)(3)).
 *
 * Public form used by the uploader of content that was taken down to dispute
 * the notice. Submits to /api/counter-notice (no auth — many disputes come
 * from users who cannot log in because their content was removed).
 */
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

export const Route = createFileRoute('/counter-notice')({
  component: CounterNoticePage,
});

function CounterNoticePage() {
  // The § 512(g)(1) email + in-app notice deep-links here with
  // ?takedownRequestId=<id>; pre-fill so the user doesn't have to copy
  // the reference manually.
  const initialTakedownId =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('takedownRequestId') ?? '')
      : '';
  const [form, setForm] = useState({
    takedownRequestId: initialTakedownId,
    respondentName: '',
    respondentEmail: '',
    respondentAddress: '',
    explanation: '',
    consentToJurisdiction: false,
    perjuryStatement: false,
  });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('submitting');
    setErrorMsg('');

    try {
      const serverUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
      const res = await fetch(`${serverUrl}/api/counter-notice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to submit counter-notice');
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
          <h1 className="text-3xl font-bold mb-4">Counter-Notice Received</h1>
          <p className="text-muted-foreground">
            Your DMCA counter-notice has been submitted. Under 17 U.S.C. § 512(g), the original
            claimant has 10–14 business days to file a court action. If no action is filed, the
            content may be restored.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">DMCA Counter-Notice</h1>
        <p className="text-sm text-muted-foreground mb-8">
          If your content was removed after a DMCA takedown request and you believe the removal was
          a mistake or misidentification, you may file a counter-notice under 17 U.S.C. § 512(g)(3).
          Submitting a false counter-notice has legal consequences.
        </p>

        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 mb-8 text-sm text-muted-foreground space-y-3">
          <p>
            <strong className="text-foreground">Legal consequences:</strong> Filing a false
            counter-notice under penalty of perjury can result in liability for damages, including
            costs and attorney's fees (17 U.S.C. § 512(f)).
          </p>
          <p>
            <strong className="text-foreground">What happens next:</strong> We forward your
            counter-notice to the original claimant. If they do not file a court action within 10–14
            business days, the content may be restored. If they do sue, the content stays down
            pending the outcome.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-1">
              Takedown Request ID{' '}
              <span className="text-muted-foreground">
                (included in the notification email you received)
              </span>
            </label>
            <input
              type="text"
              required
              value={form.takedownRequestId}
              onChange={(e) => setForm((f) => ({ ...f, takedownRequestId: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Your Name</label>
            <input
              type="text"
              required
              value={form.respondentName}
              onChange={(e) => setForm((f) => ({ ...f, respondentName: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Your Email</label>
            <input
              type="email"
              required
              value={form.respondentEmail}
              onChange={(e) => setForm((f) => ({ ...f, respondentEmail: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              Physical Address{' '}
              <span className="text-muted-foreground">(required by 17 U.S.C. § 512(g)(3)(D))</span>
            </label>
            <textarea
              required
              rows={2}
              value={form.respondentAddress}
              onChange={(e) => setForm((f) => ({ ...f, respondentAddress: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Street, City, State/Region, Postal Code, Country"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Explanation</label>
            <textarea
              required
              rows={4}
              value={form.explanation}
              onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Explain why you believe the content was taken down in error (e.g. mistake, misidentification, fair use, you hold the copyright, license, etc.)"
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={form.consentToJurisdiction}
              onChange={(e) => setForm((f) => ({ ...f, consentToJurisdiction: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              <strong className="text-foreground">§ 512(g)(3)(D) — Jurisdiction consent.</strong> I
              consent to the jurisdiction of the Federal District Court for the judicial district in
              which my address is located (or, if outside the United States, any judicial district
              in which LOAR may be found) and I will accept service of process from the original
              claimant or their agent.
            </span>
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              required
              checked={form.perjuryStatement}
              onChange={(e) => setForm((f) => ({ ...f, perjuryStatement: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="text-muted-foreground">
              <strong className="text-foreground">§ 512(g)(3)(C) — Sworn statement.</strong> I
              state, under penalty of perjury, that I have a good faith belief that the material was
              removed or disabled as a result of mistake or misidentification of the material.
            </span>
          </label>

          {status === 'error' && <div className="text-sm text-red-400">{errorMsg}</div>}

          <button
            type="submit"
            disabled={status === 'submitting'}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {status === 'submitting' ? 'Submitting...' : 'Submit Counter-Notice'}
          </button>
        </form>
      </div>
    </div>
  );
}
