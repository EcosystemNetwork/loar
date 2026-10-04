/**
 * Returns `url` only when it is an http(s) URL, else undefined. Use for any
 * user-supplied link rendered as an `href` — a stored `javascript:` URI would
 * otherwise execute on click (CSP blocks it today; this is defense in depth).
 */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}
