/**
 * ponderGql's "indexer unavailable" placeholder.
 *
 * Regression: EMPTY_RESULT is a deep Proxy that returns itself (truthy) for
 * any property, so `page.nodeContents.pageInfo.hasNextPage` read as true. The
 * universe editor's `while (true)` node-contents pager therefore never broke,
 * and — since every await resolved instantly — starved the event loop and
 * froze the whole tab whenever the indexer was unreachable or unconfigured.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadPonderGql(env: { url?: string }) {
  vi.resetModules();
  vi.stubEnv('VITE_PONDER_URL', env.url ?? '');
  vi.stubEnv('VITE_PONDER_URL_FALLBACK', '');
  vi.stubEnv('VITE_USE_TRPC_INDEXER', 'false');
  return (await import('../ponder-api')).ponderGql;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

const Q = `query { nodeContents { items { id } pageInfo { hasNextPage endCursor } } }`;

describe('ponderGql offline placeholder', () => {
  it('no indexer configured: hasNextPage is exactly false, items is []', async () => {
    const ponderGql = await loadPonderGql({});
    const r = await ponderGql<any>(Q);
    expect(r.nodeContents.items).toEqual([]);
    expect(r.nodeContents.pageInfo.hasNextPage).toBe(false);
  });

  it('indexer unreachable: same safe placeholder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const ponderGql = await loadPonderGql({ url: 'http://localhost:1' });
    const r = await ponderGql<any>(Q);
    expect(r.nodeContents.pageInfo.hasNextPage).toBe(false);
    expect(r.nodeContents.items).toEqual([]);
  });

  it('a `while (hasNextPage)` pager over the placeholder terminates', async () => {
    const ponderGql = await loadPonderGql({});
    let pages = 0;
    let more = true;
    while (more && pages < 50) {
      const page = await ponderGql<any>(Q);
      pages++;
      more = !!page?.nodeContents?.pageInfo?.hasNextPage;
    }
    expect(pages).toBe(1);
  });

  it('other property reads still degrade to a safe placeholder, not undefined', async () => {
    const ponderGql = await loadPonderGql({});
    const r = await ponderGql<any>(Q);
    expect(r.nodeContents.pageInfo.endCursor).toBeDefined();
    expect(r.anything.else.items).toEqual([]);
  });
});
