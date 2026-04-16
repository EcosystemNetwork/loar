/**
 * Ponder API Layer
 *
 * Exposes REST endpoints and a GraphQL API for querying indexed blockchain data.
 * Includes custom Hono routes for universe, node, proposal, and token queries
 * alongside Ponder's built-in GraphQL middleware.
 *
 * NOTE: The raw SQL client endpoint has been removed for security.
 * Use the GraphQL endpoint for all queries.
 */
import { db } from 'ponder:api';
import schema from 'ponder:schema';
import { Hono } from 'hono';
import { graphql } from 'ponder';
import { getAddress } from 'viem';
import { eq } from 'ponder';
import { universe, node, proposal, token, vote } from 'ponder:schema';

const app = new Hono();

// ── Query limits to prevent DoS ──────────────────────────────────────
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function getLimit(c: any): number {
  const raw = parseInt(c.req.query('limit') || String(DEFAULT_LIMIT), 10);
  return Math.min(Math.max(1, raw), MAX_LIMIT);
}

app.get('/indexer-status', async (c) => {
  let dbStatus = 'ok';
  try {
    await db.select().from(universe).limit(1);
  } catch {
    dbStatus = 'degraded';
  }

  const checks = { db: dbStatus };
  const status = dbStatus === 'ok' ? 'healthy' : 'degraded';

  return c.json({
    status,
    service: 'indexer',
    timestamp: new Date().toISOString(),
    checks,
  });
});

// NOTE: Raw SQL endpoint removed — use GraphQL instead.
// Previously: app.use('/sql/*', client({ db, schema }));

// Custom REST endpoints — all queries are bounded with LIMIT
app.get('/creator/:address/universes', async (c) => {
  const address = getAddress(c.req.param('address'));
  const limit = getLimit(c);

  const universes = await db
    .select()
    .from(universe)
    .where(eq(universe.creator, address))
    .limit(limit);

  return c.json({ universes });
});

app.get('/creator/:address/nodes', async (c) => {
  const address = getAddress(c.req.param('address'));
  const limit = getLimit(c);

  const nodes = await db.select().from(node).where(eq(node.creator, address)).limit(limit);

  return c.json({ nodes });
});

app.get('/creator/:address/proposals', async (c) => {
  const address = getAddress(c.req.param('address'));
  const limit = getLimit(c);

  const proposals = await db
    .select()
    .from(proposal)
    .where(eq(proposal.proposer, address))
    .limit(limit);

  return c.json({ proposals });
});

app.get('/creator/:address/votes', async (c) => {
  const address = getAddress(c.req.param('address'));
  const limit = getLimit(c);

  const votes = await db.select().from(vote).where(eq(vote.voter, address)).limit(limit);

  return c.json({ votes });
});

app.get('/creator/:address/summary', async (c) => {
  const address = getAddress(c.req.param('address'));

  const [universes, nodes, proposals, votes] = await Promise.all([
    db.select().from(universe).where(eq(universe.creator, address)).limit(100),
    db.select().from(node).where(eq(node.creator, address)).limit(100),
    db.select().from(proposal).where(eq(proposal.proposer, address)).limit(100),
    db.select().from(vote).where(eq(vote.voter, address)).limit(100),
  ]);

  return c.json({
    address,
    summary: {
      universesCreated: universes.length,
      nodesCreated: nodes.length,
      proposalsCreated: proposals.length,
      votesCast: votes.length,
    },
    universes,
    nodes,
    proposals,
    votes,
  });
});

app.get('/universe/:address', async (c) => {
  const address = c.req.param('address').toLowerCase();

  // Query only the specific universe — NOT the entire database
  const universeData = await db.select().from(universe).where(eq(universe.id, address)).limit(1);

  if (universeData.length === 0) {
    return c.json({ error: 'Universe not found' }, 404);
  }

  const [nodes, tokenData] = await Promise.all([
    db.select().from(node).where(eq(node.universeAddress, address)).limit(500),
    db.select().from(token).where(eq(token.universeAddress, address)).limit(10),
  ]);

  return c.json({
    universe: universeData[0],
    token: tokenData[0] || null,
    nodes: nodes.sort((a, b) => a.createdAt - b.createdAt),
  });
});

app.get('/universe/:address/proposals', async (c) => {
  const address = getAddress(c.req.param('address'));
  const limit = getLimit(c);

  const proposals = await db
    .select()
    .from(proposal)
    .where(eq(proposal.universeAddress, address))
    .limit(limit);

  return c.json({ proposals });
});

app.use('/', graphql({ db, schema }));
app.use('/graphql', graphql({ db, schema }));

export default app;
