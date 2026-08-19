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
import { cors } from 'hono/cors';
import { graphql } from 'ponder';
import { getAddress } from 'viem';
import { eq } from 'ponder';
import { universe, node, proposal, token, vote } from 'ponder:schema';

const app = new Hono();

// CORS — mirror apps/server: comma-separated allowlist via CORS_ORIGIN.
// Browser clients (loar.fun) need this to fetch /graphql and REST endpoints.
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3001')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  '/*',
  cors({
    origin: (origin) => {
      if (!origin) return null;
      return allowedOrigins.includes(origin) ? origin : null;
    },
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Per-IP rate limit ────────────────────────────────────────────────
// CORS is not enough — server-to-server scrapers bypass origin checks.
// Simple in-memory token bucket: 60 req/min per IP for REST endpoints,
// 30 req/min for GraphQL (more expensive per call).
//
// NOTE: in-memory means per-replica. Scaling the indexer past one replica
// multiplies the effective limit by the replica count.
const rateLimitBuckets = new Map<string, { tokens: number; lastRefill: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
// Hard cap so a spoofed-header flood can't grow this Map until the process OOMs.
const MAX_BUCKETS = 50_000;

/**
 * Number of reverse proxies between the public internet and this process.
 * nginx uses `$proxy_add_x_forwarded_for` and Railway's edge behaves the same:
 * both APPEND the peer address to whatever the client already sent. So the
 * LEFTMOST X-Forwarded-For entry is fully attacker-controlled and the only
 * trustworthy entry is the one our own proxy appended — counted from the RIGHT.
 *
 * Reading `[0]` (as this did previously) let anyone bypass the limiter entirely
 * by rotating the header, and allocate an unbounded number of buckets doing it.
 */
const TRUSTED_PROXY_HOPS = Math.max(1, parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10) || 1);

/** Set only when actually behind Cloudflare — otherwise the header is spoofable. */
const TRUST_CF_HEADER = process.env.TRUST_CF_CONNECTING_IP === 'true';

function clientIp(c: any): string {
  if (TRUST_CF_HEADER) {
    const cf = c.req.header('cf-connecting-ip')?.trim();
    if (cf) return cf;
  }
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      // parts[len - hops] is the address our outermost trusted proxy observed.
      const idx = parts.length - TRUSTED_PROXY_HOPS;
      return parts[idx >= 0 ? idx : 0]!;
    }
  }
  return 'unknown';
}

/** GraphQL is mounted at both '/' and '/graphql'; both are the expensive class. */
function isGraphQLPath(path: string): boolean {
  return path === '/' || path === '/graphql' || path.startsWith('/graphql/');
}

/** Health/readiness probes must never be throttled — a 429 fails the deploy. */
const UNTHROTTLED = new Set(['/health', '/ready', '/indexer-status']);

function consumeToken(key: string, max: number): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) ?? { tokens: max, lastRefill: now };
  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(max, bucket.tokens + (elapsed / RATE_LIMIT_WINDOW_MS) * max);
  bucket.lastRefill = now;
  const allowed = bucket.tokens >= 1;
  if (allowed) bucket.tokens -= 1;
  if (rateLimitBuckets.size < MAX_BUCKETS || rateLimitBuckets.has(key)) {
    rateLimitBuckets.set(key, bucket);
  }
  return allowed;
}

/**
 * Global limiter. Registered with `app.use('*', ...)` BEFORE any route.
 *
 * Hono composes handlers in registration order, and a route handler that
 * returns without calling next() ends the chain. The previous version
 * registered `app.use('/creator/*', rateLimit(60))` AFTER the matching
 * `app.get('/creator/...')` handlers, so the limiter never ran on any REST
 * endpoint — they were entirely unlimited against Postgres.
 */
async function rateLimitMiddleware(c: any, next: any) {
  const path = c.req.path;
  if (UNTHROTTLED.has(path)) return next();
  const gql = isGraphQLPath(path);
  const key = `${gql ? 'gql' : 'rest'}:${clientIp(c)}`;
  if (!consumeToken(key, gql ? 30 : 60)) {
    c.header('Retry-After', '60');
    return c.json({ error: 'rate_limit_exceeded' }, 429);
  }
  await next();
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [k, b] of rateLimitBuckets) {
    if (b.lastRefill < cutoff) rateLimitBuckets.delete(k);
  }
}, 60_000).unref?.();

// ── GraphQL structural guard ─────────────────────────────────────────
// Cheap structural guard on incoming GraphQL queries: reject queries with
// excessive nesting, aliases, or document length. Universe→nodes→universe
// cycles otherwise let an attacker force thousands of joins per request.
//
// Applied to BOTH mount points. Previously it was registered only on
// '/graphql' while `app.use('/', graphql(...))` served the same schema at the
// root — so POSTing a deeply-nested query to '/' bypassed every check here.
const MAX_GQL_DEPTH = 7;
const MAX_GQL_ALIASES = 20;
const MAX_GQL_LENGTH = 10_000;

function estimateGraphQLDepth(query: string): number {
  let depth = 0;
  let max = 0;
  for (const ch of query) {
    if (ch === '{') max = Math.max(max, ++depth);
    else if (ch === '}') depth = Math.max(0, depth - 1);
  }
  return max;
}

async function graphqlGuard(c: any, next: any) {
  if (c.req.method !== 'POST') return next();
  const raw = await c.req.text();
  const body = raw.length <= MAX_GQL_LENGTH ? raw : null;
  if (!body) return c.json({ error: 'query_too_long' }, 400);
  try {
    const json = JSON.parse(body) as { query?: string };
    const query = json.query ?? '';
    const depth = estimateGraphQLDepth(query);
    if (depth > MAX_GQL_DEPTH) return c.json({ error: 'query_too_deep', depth }, 400);
    const aliases = (query.match(/:\s*[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g) || []).length;
    if (aliases > MAX_GQL_ALIASES) return c.json({ error: 'too_many_aliases' }, 400);
  } catch {
    // Non-JSON or malformed — let ponder's graphql middleware produce the real error.
  }
  c.req.raw = new Request(c.req.raw, { body, headers: c.req.raw.headers, method: 'POST' });
  await next();
}

// ── Middleware registration ──────────────────────────────────────────
// MUST come before every route below. See rateLimitMiddleware's note on
// Hono's registration-order semantics.
app.use('*', rateLimitMiddleware);
app.use('/', graphqlGuard);
app.use('/graphql', graphqlGuard);

// ── Query limits to prevent DoS ──────────────────────────────────────
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function getLimit(c: any): number {
  const raw = parseInt(c.req.query('limit') || String(DEFAULT_LIMIT), 10);
  return Math.min(Math.max(1, raw), MAX_LIMIT);
}

const indexerHealth = async (c: any) => {
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
};

app.get('/health', indexerHealth);
app.get('/indexer-status', indexerHealth);

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
  const address = c.req.param('address').toLowerCase() as `0x${string}`;

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

// GraphQL handlers last. Rate limiting and the structural guard are already
// registered above — registering them here would be too late to run.
app.use('/', graphql({ db, schema }));
app.use('/graphql', graphql({ db, schema }));

export default app;
