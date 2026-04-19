/**
 * Slack alert helper.
 *
 * Posts to a single incoming webhook (`SLACK_WEBHOOK_URL`). No-op when the
 * env var is unset so local dev and test environments don't blast noise at
 * a production channel.
 *
 * Use for operator-actionable events only — kill-switch flips, admin config
 * changes, flagged abuse. Don't route request-volume signals here (that's
 * what the Grafana alertmanager on top of /metrics is for).
 */
import { captureException } from './sentry';

const WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const ENV = process.env.NODE_ENV ?? 'development';

export const slackEnabled = Boolean(WEBHOOK_URL);

export interface SlackAlert {
  /** Short headline — appears in the mobile notification. */
  title: string;
  /** Multi-line body. Markdown rendered (mrkdwn). */
  body?: string;
  /** Structured context (actor, before/after, ids) rendered as a key: value list. */
  fields?: Array<{ label: string; value: string }>;
  /** Severity colour: info (grey), warn (yellow), critical (red). Defaults to info. */
  severity?: 'info' | 'warn' | 'critical';
}

const COLOUR = {
  info: '#808080',
  warn: '#f1c40f',
  critical: '#e74c3c',
} as const;

/**
 * Fire-and-forget alert. Never throws — delivery failure should not break
 * the caller's flow. Errors surface in Sentry so an unreachable webhook is
 * still visible.
 */
export async function sendSlackAlert(alert: SlackAlert): Promise<void> {
  if (!WEBHOOK_URL) return;

  const severity = alert.severity ?? 'info';
  const attachment: Record<string, unknown> = {
    color: COLOUR[severity],
    title: `[${ENV.toUpperCase()}] ${alert.title}`,
    mrkdwn_in: ['text', 'fields'],
  };
  if (alert.body) attachment.text = alert.body;
  if (alert.fields && alert.fields.length > 0) {
    attachment.fields = alert.fields.map((f) => ({
      title: f.label,
      value: f.value,
      short: f.value.length < 40,
    }));
  }

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments: [attachment] }),
      // Don't let a slow webhook block the request pipeline.
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      console.error(`[slack] webhook returned ${res.status}: ${await res.text().catch(() => '')}`);
    }
  } catch (err) {
    console.error('[slack] webhook delivery failed:', err);
    if (err instanceof Error) captureException(err);
  }
}
