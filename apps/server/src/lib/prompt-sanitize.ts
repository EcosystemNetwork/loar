/**
 * Prompt sanitization for AI generation routes.
 *
 * Strips potential prompt injection patterns before sending
 * user-supplied text to external AI model APIs.
 */

/**
 * Sanitize a user-supplied prompt to mitigate prompt injection attacks.
 * Removes common injection patterns (role impersonation, instruction override,
 * embedded code blocks) and enforces a length cap.
 */
export function sanitizePrompt(prompt: string): string {
  const sanitized = prompt
    // Strip "ignore/disregard/forget previous instructions" patterns
    .replace(
      /\b(ignore|disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|rules?|prompts?)/gi,
      '[filtered]'
    )
    // Strip role impersonation markers (e.g. "system:", "assistant:")
    .replace(/\b(system|assistant|user)\s*:/gi, '[filtered]:')
    // Remove code blocks that might contain injection payloads
    .replace(/```[\s\S]*?```/g, '')
    .trim();

  // Length cap — 10 000 characters is generous for any legitimate prompt
  return sanitized.slice(0, 10_000);
}
