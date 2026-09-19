/** Returns the URL only if it parses and uses http(s); otherwise undefined. */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
