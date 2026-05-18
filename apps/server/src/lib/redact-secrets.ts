/**
 * Redact provider keys and bearer tokens from strings before they end up
 * in error messages, logs, or client responses.
 *
 * Conservative — matches common shapes from OpenAI (`sk-…`), Anthropic
 * (`sk-ant-…`), Stripe (`sk_live_…` / `pk_live_…`), Google (`AIza…`),
 * Bearer / Token / x-api-key headers, and any 32+ char alnum tail that
 * follows a "key", "secret", "token" or "Authorization" prefix in JSON
 * body echos.
 *
 * Intended use:
 *
 *   if (!res.ok) {
 *     const raw = await res.text().catch(() => '');
 *     throw new Error(`OpenAI ${res.status}: ${redactSecrets(raw).slice(0, 500)}`);
 *   }
 *
 * Not a defense for *log destination* exfil — assume any caller-facing
 * error string could be screenshot'd / pasted into a ticket.
 */

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // OpenAI / Anthropic / generic sk_… and sk-ant_… style keys.
  [/\bsk[-_](?:proj[-_]|ant[-_]|live[-_]|test[-_])?[A-Za-z0-9-_]{16,}\b/g, 'sk-***'],
  // Google API keys.
  [/\bAIza[A-Za-z0-9-_]{20,}\b/g, 'AIza***'],
  // Stripe live/test keys (pk_… / sk_… / rk_…). Earlier draft used
  // `'$&_REDACTED'` which (since `$&` IS the match itself) left the full
  // key in place. Use a literal replacement so the key is truly stripped.
  [/\b(?:pk|sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g, 'stripe_***_REDACTED'],
  // Bearer / Token authorization tails.
  [/(Authorization\s*:\s*)?Bearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer ***'],
  [/(Authorization\s*:\s*)?Token\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Token ***'],
  // x-goog-api-key / x-api-key / api-key headers.
  [/(x-(?:goog-)?api-key|api-key)\s*[:=]\s*[A-Za-z0-9._\-+/=]+/gi, '$1: ***'],
  // JSON body echos of `"…api_key"` / `"…token"` / `"…secret"` values.
  [
    /("(?:[a-zA-Z0-9_]*?(?:api[_-]?key|token|secret)[a-zA-Z0-9_]*?)"\s*:\s*)"[^"]{8,}"/gi,
    '$1"***"',
  ],
];

export function redactSecrets(input: string | null | undefined): string {
  if (!input) return '';
  let out = String(input);
  for (const [re, sub] of PATTERNS) {
    out = out.replace(re, sub);
  }
  return out;
}
