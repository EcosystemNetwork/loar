/** Helpers for the "Ask the Wiki" answer view. */

export type AnswerPart = { type: 'text'; text: string } | { type: 'cite'; index: number };

/**
 * Split an answer into text runs and `[n]` citation markers. Markers that
 * don't point at an existing source (1..sourceCount) stay as literal text so
 * a stray "[7]" from the model never renders a dead link.
 */
export function splitCitations(answer: string, sourceCount: number): AnswerPart[] {
  const parts: AnswerPart[] = [];
  let text = '';
  let last = 0;
  for (const m of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n < 1 || n > sourceCount) continue;
    text += answer.slice(last, m.index);
    if (text) parts.push({ type: 'text', text });
    parts.push({ type: 'cite', index: n - 1 });
    text = '';
    last = m.index! + m[0].length;
  }
  text += answer.slice(last);
  if (text) parts.push({ type: 'text', text });
  return parts;
}
