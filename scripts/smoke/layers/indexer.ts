/**
 * Layer 7 — indexer
 * Checks: Ponder health, GraphQL schema reachable, universe query returns data,
 *         optional: node written by chain layer appears within sync timeout.
 * Identifies: Ponder sync stalled, GraphQL schema broken, RPC-to-indexer lag.
 */
import type { SmokeConfig } from '../config.ts';
import { indexerGet, indexerGraphQL } from '../client.ts';
import { check, skipped, type CheckResult } from '../reporter.ts';

interface GraphQLUniverseResponse {
  universes: {
    items: Array<{
      id: string;
      name: string;
      creator: string;
      nodeCount: number;
    }>;
    totalCount: number;
  };
}

interface GraphQLNodeResponse {
  nodes: {
    items: Array<{
      id: string;
      nodeId: number;
      creator: string;
    }>;
  };
}

export interface IndexerResult {
  universeCount: number;
  checks: CheckResult[];
}

export async function runIndexerLayer(
  cfg: SmokeConfig,
  // nodeId written by chain layer — used to verify indexer sync
  chainNodeId?: bigint,
  chainUniverseAddress?: string
): Promise<IndexerResult> {
  const results: CheckResult[] = [];
  let universeCount = 0;

  // 1. /health — Ponder process + DB reachable
  results.push(
    await check('indexer /health → healthy', async () => {
      const { status, body } = await indexerGet(cfg, '/health');
      if (status !== 200) throw new Error(`HTTP ${status}`);
      // Ponder returns 200 with an empty body on healthy by default; some deployments
      // return JSON { status }. Accept both.
      if (body === '' || body == null) return 'healthy';
      const b = body as Record<string, unknown>;
      if (b?.status === 'healthy') return 'healthy';
      if (b?.status === 'degraded') {
        throw new Error('degraded — Ponder may still be syncing from genesis');
      }
      throw new Error(`unexpected body: ${JSON.stringify(body).slice(0, 120)}`);
    })
  );

  // 2. GraphQL introspection — schema endpoint responds
  results.push(
    await check('indexer GraphQL schema reachable', async () => {
      const url = `${cfg.indexerUrl}/graphql`;
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), cfg.timeout);
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(id);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { __typename?: string } };
      if (!json.data?.__typename) throw new Error('no __typename in introspection response');
      return json.data.__typename;
    })
  );

  // 3. universes query — check we can read indexed universes
  results.push(
    await check('indexer { universes(first: 5) } → list returned', async () => {
      const data = await indexerGraphQL<GraphQLUniverseResponse>(
        cfg,
        `
        {
          universes(limit: 5, orderBy: "createdAt", orderDirection: "desc") {
            items {
              id
              name
              creator
              nodeCount
            }
            totalCount
          }
        }
      `
      );
      const items = data?.universes?.items ?? [];
      universeCount = data?.universes?.totalCount ?? items.length;
      if (items.length === 0 && universeCount === 0) {
        // Not a failure — just nothing indexed yet
        return 'no universes indexed yet (expected after first deploy)';
      }
      const names = items
        .slice(0, 3)
        .map((u) => u.name?.slice(0, 20) ?? u.id.slice(0, 10))
        .join(', ');
      return `total=${universeCount} samples=[${names}]`;
    })
  );

  // 4. nodes query
  results.push(
    await check('indexer { nodes(first: 5) } → list returned', async () => {
      const data = await indexerGraphQL<GraphQLNodeResponse>(
        cfg,
        `
        {
          nodes(limit: 5, orderBy: "createdAt", orderDirection: "desc") {
            items {
              id
              nodeId
              creator
            }
          }
        }
      `
      );
      const items = data?.nodes?.items ?? [];
      return `${items.length} node(s) in recent index`;
    })
  );

  // 5. Verify chain-written node appears in indexer (optional, requires chain layer)
  if (chainNodeId !== undefined && chainUniverseAddress) {
    const nodeCompositeId = `${chainUniverseAddress.toLowerCase()}:${chainNodeId}`;
    results.push(
      await check(
        `indexer sync: node ${chainNodeId} appears within ${cfg.indexerSyncTimeout / 1000}s`,
        async () => {
          const deadline = Date.now() + cfg.indexerSyncTimeout;
          const pollInterval = 3_000;

          while (Date.now() < deadline) {
            const data = await indexerGraphQL<GraphQLNodeResponse>(
              cfg,
              `
              query CheckNode($id: String!) {
                nodes(where: { id: $id }, limit: 1) {
                  items {
                    id
                    nodeId
                    creator
                  }
                }
              }
            `,
              { id: nodeCompositeId }
            );

            const found = data?.nodes?.items?.length > 0;
            if (found) {
              const waited = cfg.indexerSyncTimeout - (deadline - Date.now());
              return `synced in ~${Math.round(waited / 1000)}s`;
            }

            await new Promise((r) => setTimeout(r, pollInterval));
          }

          throw new Error(
            `node ${chainNodeId} not indexed after ${cfg.indexerSyncTimeout / 1000}s — ` +
              'check PONDER_RPC_URL_2 and Ponder process'
          );
        }
      )
    );
  } else {
    results.push(
      skipped(
        'indexer sync: verify chain node appears',
        'run chain layer with SMOKE_PRIVATE_KEY + SMOKE_UNIVERSE_ADDRESS to enable'
      )
    );
  }

  return { universeCount, checks: results };
}
