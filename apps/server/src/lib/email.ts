/**
 * Transactional email via Resend.
 *
 * Called from /auth/circle/register to deliver OTP codes. Intentionally
 * uses the REST API directly (not @resend/node) to keep dependencies lean.
 *
 * Env:
 *   RESEND_API_KEY     required. "re_..." from resend.com/api-keys.
 *   RESEND_FROM_EMAIL  optional. Sender address. Defaults to
 *                      "onboarding@resend.dev" (Resend's shared sender;
 *                      caps at 100/day and only sends to the email that
 *                      owns the Resend account — fine for alpha, not prod).
 *   RESEND_FROM_NAME   optional. Display name. Defaults to "LOAR".
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendViaResend(args: SendArgs): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'onboarding@resend.dev';
  const fromName = process.env.RESEND_FROM_NAME ?? 'LOAR';
  const from = `${fromName} <${fromEmail}>`;

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Resend API ${res.status}: ${body.slice(0, 200)}`);
  }
}

/** Send a 6-digit OTP code for email sign-in. */
export async function sendOtpEmail(to: string, code: string): Promise<void> {
  const subject = `Your LOAR sign-in code: ${code}`;
  const text = [
    `Your LOAR sign-in code is: ${code}`,
    '',
    'This code expires in 5 minutes. If you did not request it, ignore this email.',
    '',
    '— LOAR',
  ].join('\n');

  const html = `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #111;">
    <div style="text-align:center; margin-bottom: 24px;">
      <span style="font-family: Georgia, serif; font-style: italic; font-size: 28px; color: #6366f1;">LOAR</span>
    </div>
    <h1 style="font-size: 20px; margin: 0 0 16px 0;">Your sign-in code</h1>
    <p style="font-size: 15px; line-height: 1.5; color: #333;">Enter this code to finish signing in to LOAR:</p>
    <div style="font-family: 'SF Mono', Menlo, monospace; font-size: 32px; letter-spacing: 8px; font-weight: 600; background: #f4f4f7; border-radius: 12px; padding: 20px 0; text-align: center; margin: 20px 0; color: #111;">
      ${code}
    </div>
    <p style="font-size: 13px; color: #666; line-height: 1.5;">
      This code expires in 5 minutes. If you didn't request it, just ignore this email — no action needed.
    </p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0 16px;" />
    <p style="font-size: 11px; color: #999; text-align: center;">loar.fun</p>
  </body>
</html>`;

  await sendViaResend({ to, subject, html, text });
}
