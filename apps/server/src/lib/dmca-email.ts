/**
 * DMCA § 512 email templates + send helpers.
 *
 * Two legally-meaningful notifications:
 *
 *   1. counter-notice received → email the original CLAIMANT with the
 *      counter-notice details. Gives them the 10–14 business day window
 *      to file a court action before we auto-restore content.
 *      (§ 512(g)(2)(B) — "replace the removed material ... not less than
 *       10, nor more than 14, business days following receipt of the
 *       counter notice, unless ... an action ... is filed")
 *
 *   2. putback completed → email the original CLAIMANT that the hold
 *      expired and the content was restored. Gives them a clean paper
 *      trail and eliminates "why is this content back up?" support
 *      tickets.
 *
 * All sends are best-effort: sendEmail() never throws, and we log +
 * continue if Resend is unreachable. The hard legal defence lives in the
 * `contentAuditLog` Firestore rows, not the email — email is operator
 * courtesy + transparency.
 */
import { sendEmail } from '../services/email-notifications';

interface TakedownSummary {
  id: string;
  contentId: string;
  claimantName?: string;
  claimantEmail: string;
  copyrightWork?: string;
  createdAt: string;
}

interface CounterNoticeSummary {
  id: string;
  respondentName: string;
  respondentEmail: string;
  respondentAddress?: string;
  explanation: string;
  createdAt: string;
}

/**
 * § 512(g)(2)(B) notice: a counter-notice was filed; claimant has 10–14
 * business days to provide proof of a court action before we restore.
 */
export async function emailCounterNoticeToClaimant(
  takedown: TakedownSummary,
  counterNotice: CounterNoticeSummary
): Promise<void> {
  const deadline = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toDateString();

  const subject = `LOAR DMCA counter-notice received — action may be required within 14 days`;

  const html = `<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 640px; line-height: 1.5;">
  <p>Dear ${escape(takedown.claimantName ?? 'claimant')},</p>

  <p>We have received a DMCA counter-notice in response to the takedown
  request you filed on ${new Date(takedown.createdAt).toDateString()} concerning
  <strong>${escape(takedown.copyrightWork ?? 'material on LOAR')}</strong>
  (content id <code>${escape(takedown.contentId)}</code>, takedown reference
  <code>${escape(takedown.id)}</code>).</p>

  <p><strong>Counter-notice details</strong></p>
  <ul>
    <li>Respondent: ${escape(counterNotice.respondentName)}</li>
    <li>Contact: ${escape(counterNotice.respondentEmail)}</li>
    <li>Address on file: ${escape(counterNotice.respondentAddress ?? 'see counter-notice record')}</li>
    <li>Respondent statement:<br><em>${escape(counterNotice.explanation)}</em></li>
  </ul>

  <p><strong>What happens next — per 17 U.S.C. § 512(g)(2)(B)</strong></p>
  <p>Unless you notify us on or before <strong>${deadline}</strong> that you
  have filed a court action seeking to restrain the alleged infringing activity,
  the content will be automatically restored. This notification is a statutory
  requirement, not an opinion about the merits of either party's claim.</p>

  <p><strong>If you have filed (or intend to file) a court action,</strong>
  reply to this email with your case number and the filing court. We will
  preserve the takedown status pending resolution.</p>

  <p><strong>If you do not intend to pursue the matter,</strong> no response is
  required; the content will be restored automatically after the hold period
  expires.</p>

  <p>Takedown reference: <code>${escape(takedown.id)}</code><br>
  Counter-notice reference: <code>${escape(counterNotice.id)}</code></p>

  <p>— LOAR moderation</p>
</div>`;

  const text = `LOAR DMCA counter-notice received

Dear ${takedown.claimantName ?? 'claimant'},

We received a DMCA counter-notice in response to the takedown request you
filed on ${new Date(takedown.createdAt).toDateString()} concerning
"${takedown.copyrightWork ?? 'material on LOAR'}" (content id ${takedown.contentId},
takedown reference ${takedown.id}).

Counter-notice details
- Respondent: ${counterNotice.respondentName}
- Contact: ${counterNotice.respondentEmail}
- Statement: ${counterNotice.explanation}

What happens next — per 17 U.S.C. § 512(g)(2)(B):
Unless you notify us on or before ${deadline} that you have filed a court
action seeking to restrain the alleged infringing activity, the content will
be automatically restored.

If you have filed a court action, reply with your case number and filing
court. If you do not intend to pursue, no response is required.

Takedown reference: ${takedown.id}
Counter-notice reference: ${counterNotice.id}

— LOAR moderation`;

  const result = await sendEmail({ to: takedown.claimantEmail, subject, html, text });
  if (!result.ok) {
    console.warn(
      `[dmca-email] counter-notice email to ${takedown.claimantEmail} failed: ${result.error}`
    );
  }
}

/**
 * Hold-period-expired notice: content was restored per § 512(g). Sent to
 * the original claimant for transparency + paper trail.
 */
export async function emailPutbackToClaimant(
  takedown: TakedownSummary,
  counterNotice: CounterNoticeSummary
): Promise<void> {
  const subject = `LOAR DMCA takedown closed — content restored after counter-notice hold period`;

  const html = `<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 640px; line-height: 1.5;">
  <p>Dear ${escape(takedown.claimantName ?? 'claimant')},</p>

  <p>The 10–14 business day hold period following the DMCA counter-notice on
  content <code>${escape(takedown.contentId)}</code>
  (takedown reference <code>${escape(takedown.id)}</code>) has expired. Per
  17 U.S.C. § 512(g)(2)(C), the content has been restored.</p>

  <p>We have no record of a court action having been filed during the hold
  period. If you believe this is in error — for example, if you filed but
  the notification did not reach us — please reply to this email with
  filing details and we will review the record.</p>

  <p>Takedown reference: <code>${escape(takedown.id)}</code><br>
  Counter-notice reference: <code>${escape(counterNotice.id)}</code><br>
  Restored at: ${new Date().toISOString()}</p>

  <p>— LOAR moderation</p>
</div>`;

  const text = `LOAR DMCA takedown closed

Dear ${takedown.claimantName ?? 'claimant'},

The 10-14 business day hold period following the counter-notice on
content ${takedown.contentId} (takedown reference ${takedown.id}) has
expired. Per 17 U.S.C. § 512(g)(2)(C), the content has been restored.

We have no record of a court action having been filed during the hold
period. If you believe this is in error, please reply with filing details.

Takedown reference: ${takedown.id}
Counter-notice reference: ${counterNotice.id}
Restored at: ${new Date().toISOString()}

— LOAR moderation`;

  const result = await sendEmail({ to: takedown.claimantEmail, subject, html, text });
  if (!result.ok) {
    console.warn(`[dmca-email] putback email to ${takedown.claimantEmail} failed: ${result.error}`);
  }
}

/** HTML-escape so user-supplied names/statements can't inject markup into the email. */
function escape(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
