/** Minimal server-side client for the Ponder indexer's GraphQL endpoint. */

const ponderUrl = () => (process.env.PONDER_URL || 'https://idx.loar.fun').replace(/\/$/, '');

/** Returns `data`, or null on any network / HTTP / GraphQL error (callers degrade gracefully). */
export async function ponderQuery<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T | null> {
  try {
    const res = await fetch(`${ponderUrl()}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T; errors?: unknown[] };
    return json.errors?.length ? null : (json.data ?? null);
  } catch {
    return null;
  }
}
