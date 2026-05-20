/**
 * Prompt sanitization for AI generation routes.
 *
 * Strips potential prompt injection patterns before sending user-supplied
 * text to external AI model APIs.
 *
 * Design constraint: this MUST be conservative. Creators write dialogue
 * with "system: greet the user" or "ignore my last note" all the time;
 * tearing those out silently produces complaints about the model
 * "ignoring" their instructions. Only match patterns that are unambiguous
 * injection attempts (role-impersonation tokens at line start, override
 * directives at message/line start) — preserve embedded prose as-is.
 *
 * Code blocks are kept verbatim: they are content, not control flow, and
 * the model treats them as text. Removing them broke a huge fraction of
 * legitimate prompts (script samples, syntax demos, etc.).
 */

// Role-impersonation only at LINE START. Mid-sentence "system:" /
// "user:" tokens are normal English / UI strings.
const ROLE_PREFIX_AT_LINE_START = /(^|\n)[ \t]*(system|assistant|user)\s*:\s*/gi;

// Instruction-override only when it leads a line. This catches the
// archetypal injection ("Ignore previous instructions and ...") without
// mangling creative prose ("I had to ignore previous instructions when
// the queen interrupted").
//
// The entire phrase (verb + qualifier + noun) gets replaced — replacing
// only the verb would leave a suspicious tail like "[filtered] previous
// instructions" that retains the original injection's noun phrase.
const OVERRIDE_AT_LINE_START =
  /(^|\n)[ \t]*(ignore|disregard|forget|override)\s+(all\s+)?(previous|above|prior|earlier)\s+(instructions?|rules?|prompts?|directives?|guidelines?)/gi;

/**
 * Sanitize a user-supplied prompt to mitigate prompt injection.
 * Conservative — only strips patterns that are unambiguous injection
 * attempts at line start. Preserves creative content (dialogue, code
 * blocks, embedded mentions of "system" / "ignore previous", etc.).
 */
export function sanitizePrompt(prompt: string): string {
  const sanitized = prompt
    // `$1` preserves the line-start anchor (`^` or `\n`); the rest of
    // the match (verb + qualifier + noun) is replaced wholesale.
    .replace(OVERRIDE_AT_LINE_START, '$1[filtered]')
    .replace(ROLE_PREFIX_AT_LINE_START, '$1[filtered]: ')
    .trim();

  // Length cap — 10 000 characters is generous for any legitimate prompt.
  return sanitized.slice(0, 10_000);
}
