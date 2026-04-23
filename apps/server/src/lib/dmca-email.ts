/**
 * DMCA § 512 email templates + send helpers.
 *
 * Three legally-meaningful notifications:
 *
 *   1. takedown applied → notify the SUBSCRIBER that their content was
 *      removed/hidden and tell them how to file a counter-notice.
 *      (§ 512(g)(1) — "the service provider takes reasonable steps
 *       promptly to notify the subscriber that it has removed or
 *       disabled access to the material"). Without this notice the
 *       safe-harbor loop is broken — the subscriber can't dispute a
 *       takedown they don't know about.
 *
 *   2. counter-notice received → email the original CLAIMANT with the
 *      counter-notice details. Gives them the 10–14 business day window
 *      to file a court action before we auto-restore content.
 *      (§ 512(g)(2)(B) — "replace the removed material ... not less than
 *       10, nor more than 14, business days following receipt of the
 *       counter notice, unless ... an action ... is filed")
 *
 *   3. putback completed → email the original CLAIMANT that the hold
 *      expired and the content was restored. Gives them a clean paper
 *      trail and eliminates "why is this content back up?" support
 *      tickets.
 *
 * All sends are best-effort: sendEmail() never throws, and we log +
 * continue if Resend is unreachable. The hard legal defence lives in the
 * `contentAuditLog` Firestore rows + the in-app `notifications`
 * collection (which is the dispatcher's always-on channel), not the
 * email — email is operator courtesy + transparency for cases where
 * the user has shared an address.
 */
import { sendEmail } from '../services/email-notifications';

const APP_BASE_URL = process.env.APP_BASE_URL ?? 'https://loar.fun';

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
 * § 512(g)(1) notice: content was hidden/removed in response to a DMCA
 * takedown. Tells the subscriber what happened and how to file a
 * counter-notice. The counter-notice URL embeds the takedown reference
 * so the form arrives pre-filled.
 *
 * `subscriberEmail` is optional because LOAR's primary identity is a
 * wallet address — many subscribers will never have shared an email.
 * For those users the in-app notification (written in parallel by the
 * caller) is the only channel and is, on its own, "reasonable steps"
 * under the statute.
 */
export async function emailTakedownToSubscriber(params: {
  subscriberEmail: string;
  subscriberDisplayName?: string;
  contentId: string;
  contentTitle?: string;
  takedownRequestId: string;
  newStatus: 'hidden' | 'removed';
  reason?: string;
}): Promise<void> {
  const counterNoticeUrl = `${APP_BASE_URL}/counter-notice?takedownRequestId=${encodeURIComponent(
    params.takedownRequestId
  )}`;
  const verb = params.newStatus === 'removed' ? 'removed' : 'hidden';
  const subject = `LOAR: your content was ${verb} following a DMCA takedown notice`;

  const html = `<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 640px; line-height: 1.5;">
  <p>Hi${params.subscriberDisplayName ? ` ${escape(params.subscriberDisplayName)}` : ''},</p>

  <p>Your content
  ${params.contentTitle ? `<strong>"${escape(params.contentTitle)}"</strong> ` : ''}
  (content id <code>${escape(params.contentId)}</code>) has been <strong>${verb}</strong>
  on LOAR in response to a DMCA takedown notice from a third party who claims
  to own the copyright in the underlying work.</p>

  ${params.reason ? `<p><strong>Reviewer note:</strong> ${escape(params.reason)}</p>` : ''}

  <p><strong>Your right to dispute — 17 U.S.C. § 512(g)(3)</strong></p>
  <p>If you believe the takedown was a mistake or misidentification (for
  example, you own the work, the use is licensed, or the use is fair use),
  you may file a <strong>counter-notice</strong>. A valid counter-notice is
  made under penalty of perjury and consents to the jurisdiction of the
  federal court for your address (or the Northern District of California
  if you are outside the United States).</p>

  <p><a href="${counterNoticeUrl}"
     style="display:inline-block;padding:10px 18px;background:#6366f1;color:#fff;text-decoration:none;border-radius:6px;">
     File a counter-notice
  </a></p>

  <p>If you do nothing, the takedown will remain in effect. If you file a
  counter-notice, we will forward it to the claimant. Unless the claimant
  notifies us within 10–14 business days that they have filed a court
  action, we will restore your content automatically.</p>

  <p>Takedown reference: <code>${escape(params.takedownRequestId)}</code></p>

  <p>This notification is required by U.S. copyright law (17 U.S.C. § 512(g)(1))
  and is not legal advice or an opinion on the merits of either party's
  claim.</p>

  <p>— LOAR moderation</p>
</div>`;

  const text = `Your content was ${verb} on LOAR

Hi${params.subscriberDisplayName ? ` ${params.subscriberDisplayName}` : ''},

Your content${params.contentTitle ? ` "${params.contentTitle}"` : ''} (content
id ${params.contentId}) has been ${verb} on LOAR in response to a DMCA
takedown notice.

${params.reason ? `Reviewer note: ${params.reason}\n\n` : ''}Your right to dispute — 17 U.S.C. § 512(g)(3):
If you believe the takedown was a mistake, you may file a counter-notice
under penalty of perjury at:

${counterNoticeUrl}

If you do nothing, the takedown remains in effect. If you file a
counter-notice, we will forward it to the claimant; unless they file a
court action within 10–14 business days, your content is restored
automatically.

Takedown reference: ${params.takedownRequestId}

This notice is required by 17 U.S.C. § 512(g)(1) and is not legal advice.

— LOAR moderation`;

  const result = await sendEmail({
    to: params.subscriberEmail,
    subject,
    html,
    text,
  });
  if (!result.ok) {
    console.warn(
      `[dmca-email] takedown-to-subscriber email to ${params.subscriberEmail} failed: ${result.error}`
    );
  }
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
