# Hosted MCP SSE Deploy Runbook (`mcp.loar.fun`)

> Companion to [prd-mcp-integration.md](prd-mcp-integration.md) Week 4.
>
> Status: scaffold merged ([apps/mcp-gateway/](../apps/mcp-gateway/)); production
> deploy still requires DNS + hosting provisioning + a handful of server-side
> glue endpoints. This doc enumerates every step.

---

## What this ships

A public HTTPS endpoint `https://mcp.loar.fun/sse` that:

1. Implements OAuth 2.1 + PKCE so agent clients (OpenClaw, Hermes, Claude Desktop remote connector, Cursor remote MCP) can one-click connect without the user pasting an API key.
2. Proxies MCP JSON-RPC over SSE to a session-scoped MCP server instance.
3. Injects `X-Loar-End-User-Address` (from the OAuth `sub` claim) on every upstream LOAR tRPC call so `apiKeyUsage` tags the relay back to the real end-user.

Architecture diagram in [apps/mcp-gateway/src/index.ts](../apps/mcp-gateway/src/index.ts).

---

## What's scaffolded vs. what still needs code

| Area                                                            | Status                                                                     | Path                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| OAuth 2.1 discovery (`/.well-known/oauth-authorization-server`) | Scaffold                                                                   | [src/metadata.ts](../apps/mcp-gateway/src/metadata.ts)             |
| Authorize endpoint + PKCE                                       | Scaffold                                                                   | [src/index.ts](../apps/mcp-gateway/src/index.ts) `handleAuthorize` |
| Token endpoint + JWT issuance                                   | Scaffold                                                                   | [src/tokens.ts](../apps/mcp-gateway/src/tokens.ts), `handleToken`  |
| Session store (pending authz / bound authz / SSE sessions)      | Scaffold (in-memory)                                                       | [src/sessionStore.ts](../apps/mcp-gateway/src/sessionStore.ts)     |
| SSE + message-relay endpoints                                   | **Stub** — returns 501                                                     | `handleSse` / `handleMessages`                                     |
| LOAR SIWE callback return page                                  | **Not yet**                                                                | `apps/web/src/routes/oauth/siwe.tsx` (TBD)                         |
| LOAR `/auth/siwe/verify` public endpoint                        | **Exists** (`apps/server/src/routes/auth.ts`) but needs OAuth-flow wrapper |
| Per-wallet MCP key mint on first login                          | **Not yet**                                                                | New `apiKeys.mintForOAuthSession()` privileged procedure           |
| Redis-backed session store (multi-instance)                     | **Not yet**                                                                | Replace in-memory maps in sessionStore.ts                          |

⚠️ Deploy is **blocked on the stubs**. Scaffold-level endpoints respond correctly to OAuth metadata discovery and the authz/token exchange, but `/sse` returns 503 without a valid `LOAR_API_KEY`, and `/messages` returns 501. Two engineering days to finish; see "Finishing the stubs" below.

---

## Phase 0 — Prerequisites

### DNS

Reserve `mcp.loar.fun` — recommended record type is a `CNAME` pointing at whatever hosting target the gateway runs on (Railway / Fly / Render all provision valid TLS certificates automatically on custom domains).

```
mcp.loar.fun.   CNAME   <provider-default-domain>.
```

### Hosting target

Any of Railway, Fly.io, Render, or a dedicated VM works. Requirements:

- Long-lived HTTP connections (SSE streams stay open for up to 10 min)
- HTTP/2 or HTTP/1.1 keep-alive tolerant of slow clients
- ~50 MB RAM per active session (mostly MCP SDK buffers + session state)
- Graceful drain on restart

Recommended **Railway** because `apps/server` already runs there and it
shares DNS + ops tooling.

### Redis

Same Redis cluster as the main server (`REDIS_URL`). The gateway uses it for:

- Pending + bound OAuth authorizations (short TTL)
- Multi-instance session lookup

Scaffold currently uses an in-memory map (`sessionStore.ts`) — swap for
Redis before scaling past one replica.

### Secrets

Generate two new secrets:

```bash
openssl rand -hex 32   # → OAUTH_JWT_SECRET
openssl rand -hex 32   # → MCP_GATEWAY_SERVICE_KEY (for the LOAR→gateway service auth)
```

---

## Phase 1 — Finishing the stubs

### 1.1 SIWE callback page in `apps/web`

Create `apps/web/src/routes/oauth/siwe.tsx` — a minimal page that:

1. Reads `authz` + `return_to` query params.
2. Triggers the existing `useWalletAuth()` SIWE sign-in flow.
3. On success, redirects to `${return_to}?authz=${authz}&address=${sig.address}&signature=${sig.sig}&message=${sig.msg}`.

Model after [apps/web/src/routes/login.tsx](../apps/web/src/routes/login.tsx). ~50 LOC.

### 1.2 Gateway verifies SIWE upstream

In `apps/mcp-gateway/src/index.ts::handleCallback`, replace the stub with:

```ts
const verifyRes = await fetch(`${LOAR_SERVER_URL}/auth/siwe/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address, signature, message }),
});
if (!verifyRes.ok) return oauthError(res, 'access_denied', 'SIWE verification failed');
```

### 1.3 LOAR-side key-mint service

In `apps/server/src/routers/apiKeys/apiKeys.routes.ts`, add a new procedure
`apiKeys.mintForOAuthSession` that:

- Requires a privileged service bearer (`MCP_GATEWAY_SERVICE_KEY`).
- Takes `{ walletAddress }`.
- Returns a cached-or-minted `mcp_server`-scoped API key for that wallet.
- Cache key: `apiKeys/oauth-gateway/{walletAddress}` — one key per wallet, rotated on 30-day expiry.

Gateway calls this on first SSE connect per wallet, caches the returned
key in the session store for the TTL.

### 1.4 Gateway SSE plumbing

Wire `handleSse` + `handleMessages` to use the MCP SDK's `SSEServerTransport`
the same way [apps/mcp/src/index.ts::startSse](../apps/mcp/src/index.ts)
already does — but instead of using a single process-wide `LOAR_API_KEY`,
use the per-wallet key minted in 1.3 and forward the wallet as
`X-Loar-End-User-Address`.

Code pattern:

```ts
// In handleSse:
const apiKey = await resolveApiKeyForWallet(payload.sub);
const client = new LoarClient({
  serverUrl: LOAR_SERVER_URL,
  apiKey,
  endUserAddress: payload.sub, // NEW field in LoarClient — sets the X-Loar-End-User-Address header
});
const server = createServer();
setupHandlers(server, client);
const transport = new SSEServerTransport('/messages', res);
await server.connect(transport);
```

`createServer` + `setupHandlers` are already exported by `@loar/mcp-server`
(need to add them as named exports — one-line change). Install via:

```bash
pnpm add @loar/mcp-server@workspace:* -F @loar/mcp-gateway
```

### 1.5 Redis session store

Replace the in-memory maps in `sessionStore.ts` with a thin wrapper over
`ioredis`. Retain the same API so the switch is mechanical. Pending +
bound authz codes → plain SET with TTL. SSE sessions → Redis Streams or
pub/sub, with the local instance still holding the response stream in
memory (streams can't be serialized).

---

## Phase 2 — Deploy

### 2.1 Railway project

```bash
railway login
railway init --name loar-mcp-gateway
railway link  # link to existing loar org
```

### 2.2 Environment variables

```bash
railway variables --set OAUTH_JWT_SECRET=$(openssl rand -hex 32)
railway variables --set OAUTH_ISSUER=https://mcp.loar.fun
railway variables --set LOAR_SERVER_URL=https://api.loar.fun
railway variables --set LOAR_WEB_URL=https://loar.fun
railway variables --set REDIS_URL=${RAILWAY_REDIS_URL}
railway variables --set MCP_GATEWAY_SERVICE_KEY=$(openssl rand -hex 32)
railway variables --set PORT=3334
railway variables --set HOST=0.0.0.0
```

Copy `MCP_GATEWAY_SERVICE_KEY` to the main `apps/server` env as well so the
key-mint procedure can authenticate inbound calls from the gateway.

### 2.3 Custom domain

```bash
railway domain add mcp.loar.fun
```

Railway returns a DNS target — point `mcp.loar.fun` at it via CNAME.
TLS provisions automatically within ~2 minutes.

### 2.4 Dockerfile

Add a `Dockerfile` at the repo root (or `apps/mcp-gateway/Dockerfile`):

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY apps/mcp/ apps/mcp/
COPY apps/mcp-gateway/ apps/mcp-gateway/
RUN corepack enable && pnpm install --frozen-lockfile --filter @loar/mcp-gateway...
RUN pnpm --filter @loar/mcp-gateway build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/apps/mcp-gateway/dist ./dist
COPY --from=build /app/apps/mcp-gateway/node_modules ./node_modules
COPY --from=build /app/apps/mcp/dist ./node_modules/@loar/mcp-server/dist
CMD ["node", "dist/src/index.js"]
```

### 2.5 ⚠️ First deploy

```bash
railway up
```

Verify:

```bash
curl https://mcp.loar.fun/health
# → {"ok":true,"sessions":0,"issuer":"https://mcp.loar.fun","version":"0.1.0"}

curl https://mcp.loar.fun/.well-known/oauth-authorization-server | jq
# Should return the metadata document with the live issuer URL.
```

---

## Phase 3 — Update skill configs

Once the gateway is live, update [skills/loar-video/setup.sh](../skills/loar-video/setup.sh)
so the "Option 3: Hosted SSE" block becomes the recommended default:

```json
{
  "mcpServers": {
    "loar": { "url": "https://mcp.loar.fun/sse", "oauth": true }
  }
}
```

And the `oauth: true` flag tells the host to use the OAuth discovery flow
(it will fetch `/.well-known/oauth-authorization-server` and walk the
user through authorization automatically).

Update [apps/mcp/README.md](../apps/mcp/README.md) to note the hosted
option is now recommended for most users; stdio + self-hosted SSE remain
available for advanced / privacy-sensitive use cases.

---

## Scaling beyond one instance

When a single gateway instance becomes the bottleneck:

1. **Session store** — all in-memory state in `sessionStore.ts` moves to Redis (per "Finishing the stubs 1.5").
2. **Sticky routing** — SSE sessions are bound to a specific instance because the response stream can't migrate. Use cookie-based sticky sessions at the load balancer.
3. **Graceful drain** — on shutdown, close pending SSE streams with a `Connection: close` header so clients reconnect to a different instance.
4. **Concurrency cap per instance** — set `MAX_SESSIONS_PER_INSTANCE=500` (default Node memory supports this comfortably with the MCP SDK).

---

## Security checklist

- [ ] `OAUTH_JWT_SECRET` is 32+ random bytes, rotated quarterly
- [ ] `MCP_GATEWAY_SERVICE_KEY` is different from `OAUTH_JWT_SECRET` and only deployed to gateway + main server
- [ ] PKCE S256 enforced at `/authorize` (scaffold already does this)
- [ ] Access token TTL ≤ 1 hour (scaffold: 1h)
- [ ] Refresh tokens: NOT implemented in v0.1 — users re-auth after 1h. Add in v0.2 if UX complaint.
- [ ] Rate limit `/token` at 10 req/min per client_id (add in Phase 2)
- [ ] `redirect_uri` allowlist per `client_id` — v0.1 accepts any registered redirect; v0.2 should require client pre-registration
- [ ] Audit log: every `/authorize` + `/token` exchange writes to `apiKeyUsage` with `keyType: 'oauth_gateway'` so the admin dashboard can see gateway-minted keys separately

---

## Rollback

If the gateway goes sideways, point `mcp.loar.fun` at a 503 static page:

```bash
railway domain remove mcp.loar.fun
```

Agent clients lose connectivity but existing skill installations
(stdio or self-hosted SSE) continue to work because they don't depend on
the gateway.

---

## Incident playbook

### OAuth flow fails for all users

Likely causes:

1. LOAR `/auth/siwe/verify` down → gateway returns `access_denied` on `/callback`
2. `OAUTH_JWT_SECRET` mismatched between gateway + verify path → tokens fail verification at `/sse`
3. `OAUTH_ISSUER` env doesn't match the user-facing URL → metadata document advertises wrong endpoint

Check `railway logs mcp-gateway | grep '\[gateway\]'`.

### Specific user stuck in a retry loop

Check `apiKeyUsage` in admin dashboard with `keyType = oauth_gateway`. High
failure rate = likely a mismatch between their cached MCP config and the
gateway's current issuer URL. Tell them to remove + re-add the integration
in their agent client.

### Gateway at high memory

Each SSE session holds ~50 MB. Monitor via `/health` endpoint `sessions`
field. If > 400 on a 2GB instance, scale horizontally or raise memory.

---

## What's explicitly out-of-scope for v0.1

- **Refresh tokens** — users re-authorize hourly. Add if UX demands.
- **Client pre-registration** — any `client_id` is accepted. Fine while
  `mcp.loar.fun` is LOAR's private gateway; tighten if we ever open it
  to third-party agent clients.
- **Per-user rate limits** — relied on upstream LOAR enforcement.
- **Sign-out** — there's no `/logout` endpoint; tokens expire on their own.
