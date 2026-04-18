/**
 * Email Notification Service
 *
 * Transactional email delivery via Resend API.
 * Uses raw fetch to avoid additional dependencies.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@loar.fun';
const RESEND_API_URL = 'https://api.resend.com/emails';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendEmailResult {
  ok: boolean;
  error?: string;
}

/**
 * Send a transactional email via Resend.
 * Returns { ok: true } on success or { ok: false, error } on failure.
 * Never throws — errors are captured in the return value.
 */
export async function sendEmail(options: EmailOptions): Promise<SendEmailResult> {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not configured — skipping email send');
    return { ok: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        ...(options.text ? { text: options.text } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[email] Resend API error ${response.status}: ${body}`);
      return { ok: false, error: `Resend API ${response.status}: ${body}` };
    }

    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[email] Failed to send email:', message);
    return { ok: false, error: message };
  }
}
