# PRD: MCP-First Agent Integration (OpenClaw + Hermes + Standard MCP)

> Status: Planned — scaffolding in place ([apps/mcp/](../apps/mcp/)), production surface TBD
> Date: 2026-04-18
> Priority: Distribution-gate for agent ecosystem (OpenClaw / Hermes / Claude Desktop / Cursor / Copilot)

---

## Problem

LOAR's agent surface today is a stdio-only MCP server at [apps/mcp/](../apps/mcp/) with 24 tools wrapping tRPC endpoints. It was enough for the hackathon and for Claude Desktop but it does not meet the bar for OpenClaw or Hermes distribution:

- **No HTTP/SSE transport** — hosted agents and the official MCP OAuth 2.1 connector flow require it.
- **No progress notifications** — a 3-minute video render returns nothing until it's done; the agent can't keep the user informed in chat.
- **No idempotency** — an agent retrying a tool call can burn a user's credits twice.
- **No cancellation** — `notifications/cancelled` is ignored; the render runs to completion even after the user gives up.
- **No resources** — the agent cannot browse "what universes does this user have?" without re-running a mutation that may cost credits.
- **No structured error codes** — `INSUFFICIENT_CREDITS`, `RATE_LIMITED`, `MODERATION_BLOCKED` all reach the agent as freeform strings it can't branch on.
- **No separate distribution for the SKILL.md** — the server exists but nothing tells the agent _when_ to use `loar_make_longform` vs. `loar_generate_shot`, or that IP guardrails apply.

In parallel, the existing `apiKeys` subsystem has two drifted scope vocabularies ([apps/server/src/lib/apiKeys.ts](../apps/server/src/lib/apiKeys.ts) and [apps/server/src/routers/apiKeys/apiKeys.routes.ts](../apps/server/src/routers/apiKeys/apiKeys.routes.ts)) and no distinction between "agent calling LOAR directly" and "MCP server relaying on behalf of an end-user". That distinction matters for rate limits, audit attribution, and abuse controls.

---

## Goal

Ship a single MCP server + SKILL.md pair that reaches every major agent ecosystem (OpenClaw via ClawHub, Hermes via Skills Hub, Claude Desktop / Cursor / Copilot / Claude Code via native MCP). One package, two registry entries, one hosted SSE endpoint for users who don't want to run a Node process.

Concretely:

1. **MCP server (Week 1)** — production-harden [apps/mcp/](../apps/mcp/): dual transport (stdio + HTTP/SSE), progress notifications, idempotency, cancellation, resources, structured error codes.
2. **SKILL.md (Week 2)** — the prompt that teaches the agent _when_ to invoke LOAR tools, composed over the server's tool surface.
3. **Distribution (Week 3)** — publish to ClawHub, Hermes Skills Hub, and npm as `@loar/mcp-server`.
4. **Hosted SSE (Week 4)** — `https://mcp.loar.fun/sse` with OAuth 2.1 so users click "Connect" in their agent and skip manual config.

Three server-side spec additions in §1, §2, §5 below unlock all of this.

---

## Non-Goals

- Rebuilding the tRPC surface — MCP tools continue to wrap existing procedures.
- Adding a parallel HTTP "remote agent" endpoint (the hackathon `POST /v1/prompt`) — MCP is the one agent interface going forward.
- Per-skill custom auth — all skills authenticate via the same `mcp_server` scope (see §1).
- Claude Code first-party integration — this repo's CLAUDE.md already works; nothing in this PRD touches that.
- CLI wrapper (`loar-video`) — nice-to-have, tracked separately; not a dependency of agent distribution.

---

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │            LOAR Server (existing)            │
                    │  tRPC + Firestore + smart contracts          │
                    └───────────────┬─────────────────────────────┘
                                    │ HTTPS + Bearer
                                    │ (agent keys with mcp_server scope, §1)
                    ┌───────────────▼─────────────────────────────┐
                    │       loar-mcp (apps/mcp/)                   │
                    │  ┌──────────────────────────────────────┐    │
                    │  │  MCP server (stdio + HTTP/SSE)       │    │
                    │  │   - tools/list, tools/call           │    │
                    │  │   - notifications/progress (§2)      │    │
                    │  │   - notifications/cancelled          │    │
                    │  │   - resources/list, resources/read   │    │
                    │  │   - structured error codes           │    │
                    │  └──────────────────────────────────────┘    │
                    │  ┌──────────────────────────────────────┐    │
                    │  │  skills/loar-video/SKILL.md          │    │
                    │  │  skills/loar-universe/SKILL.md       │    │
                    │  └──────────────────────────────────────┘    │
                    └────────┬───────────┬───────────────┬─────────┘
                             │           │               │
                  ┌──────────▼─┐  ┌──────▼──────┐  ┌────▼─────────┐
                  │  OpenClaw  │  │   Hermes    │  │ Claude       │
                  │ (MCPorter) │  │ (native MCP)│  │ Desktop /    │
                  │ stdio+HTTP │  │ stdio+HTTP  │  │ Cursor / etc │
                  └────────────┘  └─────────────┘  └──────────────┘
```

**Key principles**

- One MCP server, two registry entries. No per-ecosystem forks.
- Credentials stay in the MCP server config (not the agent's shell history).
- Long jobs stream progress back to the agent's chat via MCP notifications — never block.
- Agent asks before burning credits; SKILL.md enforces that, not the server.

---

## §1 — Agent Keys (addition: `mcp_server` scope)

### Current state

[apps/server/src/lib/apiKeys.ts](../apps/server/src/lib/apiKeys.ts) defines ~18 fine-grained scopes (`entities.read`, `generation.image`, `marketplace.submit`, etc.) and a sentinel `admin.all` that is rejected at key creation. `apiKeys.routes.ts` advertises a slightly different scope list. Keys are SHA-256 hashed in Firestore, rate-limited in-memory per-key, and tracked in `apiKeyUsage`.

### Change

Add a new meta-scope `mcp_server`. Semantics:

- Inherits **all non-admin scopes** for the key's owner (entities._, generation._, marketplace.\*, credits.read, etc.).
- Marks the key as an **MCP relay** rather than a direct programmatic client.
- MCP-tagged keys get:
  - Separate rate-limit bucket (default `rateLimitPerMinute: 300` vs. `60` for direct keys — the MCP server fans out many user requests).
  - `X-Loar-End-User-Address: 0x...` request header passthrough, recorded in `apiKeyUsage.endUserAddress` for attribution.
  - Distinct entry in `apiKeyUsage.keyType = "mcp_server" | "direct"` for analytics.
- **Never granted** alongside `admin.all` (same guard as today).
- **Never granted** to browser-facing integrations (flagged in `generateApiKey` with a dedicated error).

### Migration

- No schema change to existing `apiKeys` collection — `permissions: string[]` already accepts the new scope.
- Backfill: existing keys tagged with `aiAgentId` that are used from MCP configs get a one-time upgrade path via `apiKeys.upgradeToMcp({ keyId })` that adds `mcp_server` to `permissions`.
- Deprecate the drifted `API_KEY_PERMISSIONS` list in `apiKeys.routes.ts` — single source of truth moves to `API_KEY_SCOPES` in `lib/apiKeys.ts`. This is a pre-existing bug flagged for cleanup during this work.

### Acceptance

- Key created with `permissions: ['mcp_server']` can call any `generation.*` or `entities.*` tRPC procedure on behalf of its owner.
- `apiKeyUsage` records the end-user wallet address for every MCP-relayed call.
- Rate limit bucket is 300/min for `mcp_server` keys, 60/min for others.
- Existing direct API keys (without `mcp_server`) behave exactly as before.

---

## §2 — Async Jobs (addition: `clientToken` + `webhookUrl`)

### Current state

Generation endpoints (`generation.generate`, `image.generate`, `voice.synthesize`, etc.) are async under the hood — they enqueue BullMQ jobs and return a job ID. Clients poll `generation.status({ id })`. There is no idempotency and no push notification.

### Change

Every async-producing tRPC mutation accepts two new optional fields:

| Field         | Type   | Purpose                                                                                                                                                                                            |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clientToken` | string | Idempotency key, 16–128 chars, client-generated. If a job with the same `clientToken` exists for the same `ownerUid` in the last 24h, **return the existing job** instead of creating a new one.   |
| `webhookUrl`  | string | HTTPS URL that receives a signed POST when the job transitions to `completed` or `failed`. Used by the hosted MCP SSE server to push completion to the right session without the agent re-polling. |

**Idempotency storage**: Firestore `jobIdempotency` collection, keyed by `{ownerUid}:{clientToken}`, TTL 24h. Races handled via Firestore transaction on `create` — second caller with the same token gets the first caller's jobId.

**Webhook signing**: HMAC-SHA256 of the body using a per-key `webhookSecret` (generated on first webhook registration). Header: `X-Loar-Signature: sha256=<hex>`. Replay protection via `X-Loar-Timestamp` (reject > 5 min skew).

**Webhook payload**:

```json
{
  "jobId": "gen_abc123",
  "clientToken": "mcp-req-xyz",
  "status": "completed",
  "result": {
    "mediaUrl": "https://...",
    "contentHash": "0x...",
    "creditsCharged": 150
  },
  "completedAt": "2026-04-18T12:34:56Z"
}
```

**Retry policy**: up to 5 attempts with exponential backoff (1s, 4s, 16s, 64s, 256s). After 5 failures, mark webhook as `failed_delivery` in the job record — agent falls back to polling.

### Why MCP needs this

- **Idempotency**: Agents retry on transient errors. Without `clientToken`, a flaky network between MCP server and LOAR means the user gets charged twice for the same video.
- **Webhooks**: Hosted MCP SSE server can't keep a BullMQ subscriber open per session. Webhook pushes completion to the SSE endpoint, which fans out the MCP `notifications/progress { status: "completed" }` to the right client.

### Acceptance

- Same `clientToken` + same owner within 24h returns identical `jobId`.
- Webhook fires within 2s of job state transition.
- Signature verification example code ships with the MCP server README.
- Jobs without `webhookUrl` continue polling — backwards compatible.

---

## §3 — Rate Limits & Audit Tagging

Covered by the existing `apiKeyUsage` collection plus the `keyType` and `endUserAddress` additions from §1. No new infrastructure. One new admin view `/admin/mcp-usage` shows:

- Top MCP keys by volume
- Top end-user addresses by MCP-relayed spend
- Rate-limit hits per key per hour
- Webhook failure rate per key

---

## §4 — Webhook Delivery Infrastructure

BullMQ worker `webhook.deliver` consumes job completion events from the existing `generation` queue, loads any registered `webhookUrl` from the job metadata, and POSTs with HMAC signing. Reuses existing queue/worker patterns from [apps/server/src/workers/generation.worker.ts](../apps/server/src/workers/generation.worker.ts). No new dependencies.

---

## §5 — MCP Resources Backend (new)

### Problem

MCP resources (`resources/list`, `resources/read`) let an agent browse and quote URIs like `loar://universe/0x123...` or `loar://creation/gen_abc123` without re-running mutations. The MCP SDK handles the protocol; it needs a backend.

### Change

Add `mcp.resources` tRPC sub-router with two procedures, both requiring `mcp_server` scope:

**`mcp.resources.list`**

Input:

```ts
{
  cursor?: string;          // pagination
  types?: Array<'universe' | 'entity' | 'creation' | 'collab'>;
  ownerAddress?: string;    // end-user filter (passthrough from MCP session)
}
```

Output:

```ts
{
  resources: Array<{
    uri: string;            // e.g. "loar://universe/0x123..."
    name: string;           // human-readable
    description?: string;
    mimeType: 'application/json';
  }>;
  nextCursor?: string;
}
```

**`mcp.resources.read`**

Input: `{ uri: string }`
Output: `{ uri, mimeType: 'application/json', text: string }` (JSON stringified)

### URI scheme

| URI                              | Returns                                                  |
| -------------------------------- | -------------------------------------------------------- |
| `loar://universe/{address}`      | Universe metadata + entity counts + recent canon entries |
| `loar://entity/{entityId}`       | Entity detail (same shape as `entities.get`)             |
| `loar://creation/{generationId}` | Generation record + media URL + parent refs              |
| `loar://collab/{collabId}`       | Collab metadata + episode count                          |
| `loar://profile/{address}`       | Public profile view                                      |
| `loar://credits`                 | Current user's credit balance (owner-scoped)             |

### Why

Without resources, agents ask "what universes do I have?" by calling `universes.getAll` (which lists the entire platform). The agent either over-fetches or the tool description has to say "filter by ownerAddress" and the agent has to remember its own address. Resources make this a first-class navigation surface.

### Acceptance

- `mcp.resources.list({ ownerAddress })` returns only that user's universes, entities, and creations.
- `mcp.resources.read({ uri: "loar://universe/..." })` is cacheable for 60s.
- URIs appearing in tool output (e.g. a `loar_generate_video` result) match this scheme so the agent can round-trip.

---

## Week 1 — Production harden the MCP server

Detailed gap list in [mcp-week1-hardening-audit.md](mcp-week1-hardening-audit.md). Summary:

1. Add `StreamableHTTPServerTransport` alongside existing `StdioServerTransport`. Select via env `LOAR_MCP_TRANSPORT=stdio|http`.
2. Emit `notifications/progress` from every generation tool (poll the job every 2s until terminal, relay to MCP client).
3. Accept `clientToken` as an explicit tool input; forward to tRPC per §2.
4. Handle `notifications/cancelled` by calling `generation.cancel({ jobId })`.
5. Implement `resources/list` and `resources/read` via `mcp.resources.*` (§5).
6. Return structured errors with `_meta.errorCode`: `INSUFFICIENT_CREDITS`, `RATE_LIMITED`, `MODERATION_BLOCKED`, `INVALID_INPUT`, `UPSTREAM_TIMEOUT`.
7. Migrate auth header from `X-API-Key` to `Authorization: Bearer <key>` (dual-accept for 90 days).
8. Fix scope drift: single source of truth in `lib/apiKeys.ts`; delete the second list in `apiKeys.routes.ts`.

---

## Week 2 — SKILL.md (the important one)

Two skills:

- **`skills/loar-video/`** — broad creative surface. SKILL.md + EXAMPLES.md + POLICY.md + setup.sh.
- **`skills/loar-universe/`** — narrower universe CRUD / lookup surface. Used by agents that manage worldbuilding state but shouldn't trigger renders.

Both share the same frontmatter `description` contract — the trigger phrase match. The body specifies:

- When to use `loar_make_longform` vs. `loar_generate_shot` vs. `loar_generate_image`.
- The **ask-before-anchoring** rule: never call `loar_mint_content_nft`, `loar_submit_to_canon`, or `loar_create_listing` without explicit user confirmation.
- How to handle multi-minute renders: return the `jobId`, acknowledge, do not block the chat. If the transport supports progress, stream it; otherwise tell the user you'll check back when they ask.
- IP guardrails: refuse copyrighted IP prompts, default new content to `classification: 'fan'`, require explicit user statement of ownership to escalate to `original`.
- Error recovery: on `INSUFFICIENT_CREDITS`, link to credit purchase and stop; do not loop retry.

---

## Week 3 — Distribution

- **npm**: publish `@loar/mcp-server` from `apps/mcp/`.
- **ClawHub**: `clawhub publish skills/loar-video` and `skills/loar-universe`.
- **Hermes Skills Hub**: same SKILL.md files, registered through the Hermes publisher flow.
- **Claude Desktop**: README snippet for `~/.claude/claude_desktop_config.json` — already works with stdio, updated for Bearer auth.

---

## Week 4 — Hosted SSE

`https://mcp.loar.fun/sse` served by a thin Node process (separate deploy from `apps/mcp/`) that:

1. Accepts OAuth 2.1 discovery + token exchange.
2. On connect, provisions or reuses a user-scoped `mcp_server`-scoped API key.
3. Maps the MCP SSE session to an end-user wallet address; injects `X-Loar-End-User-Address` on every tRPC call.
4. Subscribes to webhooks registered in §2 for jobs spawned in that session; fans completion back to the session as `notifications/progress`.

User flow: dashboard.loar.fun → Integrations → "Connect to OpenClaw" → deep-link into OpenClaw's MCP connector UI with the right config block → done.

---

## Rollout Sequence

| Phase | Ships                                                     | Blocker removed                         |
| ----- | --------------------------------------------------------- | --------------------------------------- |
| P0    | §1 `mcp_server` scope, §3 audit tagging                   | Hardened MCP key provisioning           |
| P1    | §2 idempotency + webhooks                                 | Safe retries; hosted SSE can push       |
| P2    | §5 MCP resources backend                                  | Agents can browse without mutating      |
| P3    | Week 1 MCP hardening (SSE, progress, cancel, error codes) | OpenClaw / Hermes distribution eligible |
| P4    | Week 2 SKILL.md files                                     | Agents know _when_ to invoke            |
| P5    | Week 3 publish to ClawHub + Hermes Skills Hub + npm       | Public availability                     |
| P6    | Week 4 hosted SSE + OAuth                                 | Zero-config onboarding                  |

Each phase is independently shippable. P0–P2 are server-side only; P3 is `apps/mcp/` only; P4 is docs only.

---

## Open Questions

1. **Hosted SSE hosting target** — Railway, Fly.io, or dedicated? The existing server runs on Railway; SSE long-lived connections are fine there. Default: Railway with connection-draining tuned for 10-min idle timeouts.
2. **OAuth identity** — do we federate SIWE (wallet signature) through the OAuth flow, or issue a standalone email/password identity just for the MCP connector? Default: SIWE → short-lived OAuth token bridge, reuse existing [apps/web/src/lib/wallet-auth.ts](../apps/web/src/lib/wallet-auth.ts).
3. **Skill versioning** — when LOAR changes a tool's behavior, how do we prevent old SKILL.md caches from misleading agents? Default: version the skill (`loar-video@1.2.0`); SKILL.md frontmatter pins minimum MCP server version.
4. **CLI wrapper** — defer to separate PRD or include as P7 here? Default: separate. The CLI is for power users / CI, not part of the agent-ecosystem gate.

---

## References

- Existing MCP server: [apps/mcp/src/index.ts](../apps/mcp/src/index.ts), [apps/mcp/src/tools.ts](../apps/mcp/src/tools.ts)
- Existing API keys: [apps/server/src/lib/apiKeys.ts](../apps/server/src/lib/apiKeys.ts), [apps/server/src/routers/apiKeys/apiKeys.routes.ts](../apps/server/src/routers/apiKeys/apiKeys.routes.ts)
- Week 1 hardening audit: [mcp-week1-hardening-audit.md](mcp-week1-hardening-audit.md)
- Agent systems overview: referenced in `memory/project_agent_systems.md`
- MCP spec: <https://spec.modelcontextprotocol.io>
