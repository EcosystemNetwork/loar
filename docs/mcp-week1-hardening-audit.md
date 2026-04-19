# MCP Server — Week 1 Hardening Audit

> Companion to [prd-mcp-integration.md](prd-mcp-integration.md).
> Scope: existing [apps/mcp/](../apps/mcp/) — what's there, what's missing, in what order to fix it.
> Audit date: 2026-04-18
> Audited against: [apps/mcp/src/index.ts](../apps/mcp/src/index.ts), [apps/mcp/src/tools.ts](../apps/mcp/src/tools.ts), [apps/mcp/src/loar-client.ts](../apps/mcp/src/loar-client.ts), [apps/mcp/package.json](../apps/mcp/package.json)

The existing server works for Claude Desktop (stdio) and was adequate for the hackathon. It is **not** production-ready for OpenClaw / Hermes distribution or hosted SSE. This audit identifies 14 gaps grouped by severity.

---

## Summary

| Severity | Count |
| -------- | ----- |
| Blocker  | 5     |
| High     | 4     |
| Medium   | 3     |
| Low      | 2     |

Blockers must land before publishing to ClawHub or Hermes Skills Hub. Highs must land before a public hosted SSE endpoint. Mediums and lows can ship post-launch.

---

## Blockers (5)

### B-1. stdio-only transport

**Where:** [apps/mcp/src/index.ts:264](../apps/mcp/src/index.ts#L264) instantiates `StdioServerTransport`; `StreamableHTTPServerTransport` is never imported.

**Why it's a blocker:** Hosted MCP at `https://mcp.loar.fun/sse` needs HTTP/SSE. The OpenClaw one-click connector flow requires it. Stdio is local-install-only.

**Fix:** Add dual transport. Select via env:

```ts
const TRANSPORT = process.env.LOAR_MCP_TRANSPORT ?? 'stdio';
const transport =
  TRANSPORT === 'http'
    ? new StreamableHTTPServerTransport({
        port: PORT,
        sessionIdGenerator: () => crypto.randomUUID(),
      })
    : new StdioServerTransport();
```

MCP SDK 0.5.0 ships both. No new dependency.

---

### B-2. No progress notifications on long-running tools

**Where:** Every generation tool in [tools.ts](../apps/mcp/src/tools.ts) — `loar_generate_video`, `loar_generate_image`, `loar_create_asset_pack`, `loar_generate_voice`, `loar_generate_3d`, `loar_generate_sound_effect`. Each returns whatever the tRPC mutation returned (usually `{ jobId, status: "queued" }`) and hands back to the agent immediately.

**Why it's a blocker:** A 3-minute video render looks like a timeout to the agent. There is no way for the chat to reflect progress. SKILL.md says "don't block the chat" but there's no mechanism to push updates either.

**Fix pattern:** Wrap long-running tools so they:

1. Call the tRPC mutation, receive `jobId`.
2. Return the jobId immediately in the tool result **and** start an async poll.
3. On each poll (every 2s, up to 10 min), if status changed, emit `notifications/progress`:

```ts
await server.notification({
  method: 'notifications/progress',
  params: { progressToken: jobId, progress: percent, total: 100, message: statusText },
});
```

4. On terminal state, emit a final progress notification with `status: "completed" | "failed"`.

Requires the `apps/server` job status endpoint to return a normalized `{ status, progress, resultUrl, errorCode }` shape — see §5 of the PRD.

---

### B-3. No idempotency (`clientToken`)

**Where:** [tools.ts](../apps/mcp/src/tools.ts) tool schemas never mention `clientToken`. [loar-client.ts](../apps/mcp/src/loar-client.ts) forwards args verbatim.

**Why it's a blocker:** MCP clients retry on transport error. A video render costs 50+ credits. A retry without idempotency double-charges the user. This is a direct credit-loss bug in production.

**Fix:** Add `clientToken` to every mutation's `inputSchema` as optional. Generate a default in the MCP wrapper if the agent didn't provide one (`crypto.randomUUID()`). Forward to tRPC. Server-side idempotency in §2 of the PRD.

---

### B-4. No `notifications/cancelled` handler

**Where:** [apps/mcp/src/index.ts](../apps/mcp/src/index.ts) only registers `ListToolsRequestSchema` and `CallToolRequestSchema` handlers. Cancellation is silently dropped.

**Why it's a blocker:** User says "cancel" mid-render. MCP sends `notifications/cancelled`. Server ignores it. The render runs to completion and the user is charged anyway.

**Fix:** Register a notification handler:

```ts
server.setNotificationHandler(CancelledNotificationSchema, async ({ params }) => {
  const { requestId, reason } = params;
  await client.mutate('generation.cancel', { jobId: requestIdToJobId.get(requestId), reason });
});
```

Requires a `generation.cancel` tRPC procedure if one doesn't already exist.

---

### B-5. No structured error codes

**Where:** [apps/mcp/src/index.ts:252-257](../apps/mcp/src/index.ts#L252-L257) catches errors and returns them as freeform `text` content with `isError: true`. No `_meta.errorCode`.

**Why it's a blocker:** SKILL.md branches on `INSUFFICIENT_CREDITS`, `RATE_LIMITED`, `MODERATION_BLOCKED`, `INVALID_INPUT`, `UPSTREAM_TIMEOUT`. Without structured codes, the agent reads the error string and guesses. Guesses lead to retry loops on `INSUFFICIENT_CREDITS` (the exact failure mode the policy tells the agent to avoid).

**Fix:** Map tRPC errors to structured MCP errors:

```ts
try { ... }
catch (err) {
  const code = classifyError(err); // maps TRPCError codes + HTTP status to our taxonomy
  return {
    content: [{ type: 'text', text: err.message }],
    isError: true,
    _meta: { errorCode: code },
  };
}
```

`classifyError` table:

| Source                                  | `errorCode`            |
| --------------------------------------- | ---------------------- |
| TRPC `TOO_MANY_REQUESTS` or HTTP 429    | `RATE_LIMITED`         |
| TRPC `FORBIDDEN` + message "credit"     | `INSUFFICIENT_CREDITS` |
| TRPC `FORBIDDEN` + message "moderation" | `MODERATION_BLOCKED`   |
| TRPC `BAD_REQUEST` or Zod failure       | `INVALID_INPUT`        |
| Fetch timeout or HTTP 5xx               | `UPSTREAM_TIMEOUT`     |
| Anything else                           | `INTERNAL_ERROR`       |

---

## Highs (4)

### H-1. No `resources/list` / `resources/read` implementation

**Where:** Server capabilities at [apps/mcp/src/index.ts:143-153](../apps/mcp/src/index.ts#L143-L153) declares `{ tools: {} }` only. Resources capability never registered.

**Fix:** Register `resources` in capabilities, add `ListResourcesRequestSchema` and `ReadResourceRequestSchema` handlers, wire to `mcp.resources.*` tRPC procedures from §5 of the PRD. See PRD for URI scheme (`loar://universe/*`, `loar://entity/*`, etc.).

---

### H-2. Auth header is legacy `X-API-Key`, not `Authorization: Bearer`

**Where:** [apps/mcp/src/loar-client.ts:35, 57](../apps/mcp/src/loar-client.ts#L35). Every request uses `X-API-Key`.

**Fix:** Migrate to `Authorization: Bearer <key>`. Dual-accept on server for 90 days (already dual-accept-compatible if [apps/server/src/lib/auth.ts](../apps/server/src/lib/auth.ts) checks both headers). Update setup.sh (already does — it probes `Authorization` first, falls back to `X-API-Key` with a warning).

---

### H-3. Three competing permission/scope vocabularies

**Where:**

- [apps/mcp/src/index.ts:53-84](../apps/mcp/src/index.ts#L53-L84) — three-tier `read | write | admin` `TOOL_PERMISSIONS`.
- [apps/server/src/lib/apiKeys.ts:21-48](../apps/server/src/lib/apiKeys.ts#L21-L48) — 18 fine-grained scopes (`API_KEY_SCOPES`).
- [apps/server/src/routers/apiKeys/apiKeys.routes.ts:9-29](../apps/server/src/routers/apiKeys/apiKeys.routes.ts#L9-L29) — a third list (`API_KEY_PERMISSIONS`) that overlaps but doesn't match.

**Why:** The MCP server enforces one scheme (`LOAR_MCP_PERMISSION_LEVEL=read|write|admin`); the key itself has fine-grained scopes from a different vocabulary; the UI for key creation shows yet a third list.

**Fix:**

1. Delete `API_KEY_PERMISSIONS` in `apiKeys.routes.ts`; re-export from `lib/apiKeys.ts`.
2. Delete `LOAR_MCP_PERMISSION_LEVEL` and `TOOL_PERMISSIONS` in MCP server. Replace with: "trust the key's scopes." If a tool requires `generation.video` and the key doesn't have it, the server returns `FORBIDDEN` which the MCP wrapper maps to `INVALID_INPUT`.
3. Add the `mcp_server` meta-scope from §1 of the PRD.

This eliminates one full layer of bookkeeping.

---

### H-4. Rate limit is in-memory, per-process, write-only

**Where:** [apps/mcp/src/index.ts:98-116](../apps/mcp/src/index.ts#L98-L116). Single in-process array of timestamps.

**Why it's a problem:**

- Restart resets the window — bursts across restarts.
- Multi-instance hosted SSE (Week 4) has no shared state.
- Only rate-limits writes, but reads can also be expensive (e.g., `discover_profiles` at scale).

**Fix:** Delete local rate limiting entirely. Rely on server-side rate limiting (already in [apps/server/src/lib/apiKeys.ts:208-220](../apps/server/src/lib/apiKeys.ts#L208-L220), per-key `rateLimitPerMinute`). When server returns 429, MCP wrapper surfaces `RATE_LIMITED` per B-5. One source of truth.

---

## Mediums (3)

### M-1. Input validation is ad-hoc

**Where:** [apps/mcp/src/index.ts:224-239](../apps/mcp/src/index.ts#L224-L239) hardcodes ETH address regex check for fields named `universeAddress | address | walletAddress`.

**Fix:** Move validation into Zod schemas in `tools.ts`. Expose schemas to MCP's `inputSchema` via `zod-to-json-schema`. Single source of truth per tool.

---

### M-2. Input size limits duplicate what MCP already enforces

**Where:** [apps/mcp/src/index.ts:119-134](../apps/mcp/src/index.ts#L119-L134) — 50KB total, 10KB per string field.

**Fix:** Keep as defense-in-depth but move the numbers to named constants and document in the README. MCP SDK also enforces its own limits; make sure these don't conflict.

---

### M-3. Package metadata blocks publishing

**Where:** [apps/mcp/package.json](../apps/mcp/package.json) — `"name": "mcp"`, `"private": true`, no `bin`, no `files`, no `description`.

**Fix:** For Week 3 distribution:

```json
{
  "name": "@loar/mcp-server",
  "version": "0.2.0",
  "description": "LOAR platform MCP server — AI agent tools for tokenized story universes",
  "private": false,
  "type": "module",
  "bin": { "loar-mcp-server": "dist/src/index.js" },
  "files": ["dist/", "README.md"],
  "repository": { "type": "git", "url": "https://github.com/loar-fun/loar" },
  "keywords": ["mcp", "claude", "openclaw", "hermes", "loar", "ai-video"]
}
```

---

## Lows (2)

### L-1. `console.error` for operational logging

**Where:** [apps/mcp/src/index.ts:43-46, 266, 270](../apps/mcp/src/index.ts#L43-L46). Raw stderr for startup + fatal errors.

**Fix:** Fine for stdio transport (stderr doesn't conflict with stdout protocol). For HTTP transport, wire a structured logger (pino or equivalent) so hosted logs are parseable.

---

### L-2. Tool count claim drift

**Where:** [apps/mcp/README.md:43](../apps/mcp/README.md#L43) says "Available Tools (25)". [apps/mcp/src/tools.ts:556-592](../apps/mcp/src/tools.ts#L556-L592) `ALL_TOOLS` array has 25 entries (verified). README count is correct; some section headers ("Media Generation (Extended)") list tools that also appear in other sections, causing confusion.

**Fix:** Reorganize README sections so each tool appears exactly once. Auto-generate the list from `ALL_TOOLS` to prevent future drift.

---

## Execution order

Suggested sequence for Week 1 work. Each step is independently shippable and testable.

1. **H-3** — Consolidate scope vocabularies. Easiest to do first; reduces surface area.
2. **B-5** — Structured error codes. Small change; unblocks SKILL.md branching.
3. **B-3** — `clientToken` idempotency. Server-side work in §2 of PRD; MCP-side is just schema + forward.
4. **B-2** — Progress notifications. Requires server-side normalized job status; medium effort.
5. **B-4** — Cancellation handler. Small; piggy-backs on B-2's job-tracking map.
6. **H-2** — Bearer auth migration.
7. **H-1** — Resources (requires §5 backend from PRD).
8. **B-1** — HTTP/SSE transport. Last because it's the biggest; all other fixes should land on stdio first so we can verify them.
9. **H-4** — Delete local rate limiting. Trivial once server-side is trusted.
10. **M-1, M-2** — Input validation cleanup.
11. **M-3** — Publish metadata. Immediately before Week 3 release.
12. **L-1, L-2** — Post-launch.

Total estimated effort: ~2.5 eng-weeks. Parallelizable to fit in a calendar week with two engineers.

---

## Out of scope for this audit

- Server-side additions (`mcp_server` scope, `clientToken` storage, webhook delivery, `mcp.resources` router) — covered in [prd-mcp-integration.md](prd-mcp-integration.md) §1, §2, §4, §5.
- SKILL.md content — covered in [skills/loar-video/SKILL.md](../skills/loar-video/SKILL.md) and [skills/loar-universe/SKILL.md](../skills/loar-universe/SKILL.md).
- OAuth 2.1 flow for hosted SSE — Week 4 in the PRD.
- CLI wrapper — separate PRD.
