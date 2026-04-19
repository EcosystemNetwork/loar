# Changelog

All notable changes to `@loar/mcp-server`.

## 0.2.0 — 2026-04-19

First public release. Production-hardened from the hackathon stdio prototype.

### Added

- **SSE transport** — `LOAR_MCP_TRANSPORT=sse` runs an HTTP server with `GET /sse`, `POST /messages?sessionId=<id>`, and `GET /health`. One MCP session per connection, session-scoped Server instances.
- **MCP resources** — `resources/list` and `resources/read` proxy to `mcp.resources.*` on the LOAR server. URI scheme: `loar://universe/{address}`, `loar://entity/{id}`, `loar://creation/{genId}`, `loar://profile/{address}`, `loar://credits`.
- **Progress streaming** — tool calls that include `_meta.progressToken` poll `jobs.status` every 2s and emit `notifications/progress` until the job reaches a terminal state. Max 10-minute budget.
- **Unified status + cancel tools** — `loar_get_job_status` and `loar_cancel_generation` work across all 5 async generation backends (video, image, voice, 3D, studio packs).
- **Structured error codes** — `_meta.errorCode` on every failed tool response: `INSUFFICIENT_CREDITS`, `RATE_LIMITED`, `MODERATION_BLOCKED`, `INVALID_INPUT`, `UPSTREAM_TIMEOUT`, `NOT_FOUND`, `FORBIDDEN`, `UNKNOWN_TOOL`, `INTERNAL_ERROR`. SKILL.md uses these for branching without string-matching.

### Changed

- **Bearer auth** — client now sends `Authorization: Bearer loar_<...>`. The LOAR server accepts both `Authorization: Bearer` and legacy `X-API-Key` for the same key, so existing integrations keep working.
- **Permission enforcement moved server-side** — removed `LOAR_MCP_PERMISSION_LEVEL` and `TOOL_PERMISSIONS`. The API key's scopes are the single source of truth; `FORBIDDEN` relays as a structured error code.
- **Local rate limit removed** — LOAR server enforces per-key rate limits (300/min for `mcp_server`-scoped keys, 60/min for others). 429 from upstream surfaces as `RATE_LIMITED`.

### Published surface

`bin: loar-mcp-server` — installable via `npx @loar/mcp-server`.

### Requires

- Node ≥ 18
- A LOAR API key with the `mcp_server` scope (generate at https://loar.fun Settings → API Keys)
- `@modelcontextprotocol/sdk@^0.5.0` (bundled as dependency)

### Server-side companion changes

This release pairs with server-side additions documented in [`docs/prd-mcp-integration.md`](../../docs/prd-mcp-integration.md):

- `mcp_server` meta-scope with scope inheritance
- `clientToken` idempotency across `generation.generate`, `image.generate`, `voice.synthesize`, `voice.soundEffect`, `threed.textTo3DPreview`, `threed.imageTo3D`, `studio.createEntityPack`
- `webhookUrl` signed-POST delivery (HMAC-SHA256) on job terminal state
- Unified `jobs.status` + `jobs.cancel` tRPC procedures
- `mcp.resources.list` + `mcp.resources.read` navigation surface
- `X-Loar-End-User-Address` passthrough for MCP relays

## 0.1.0 — 2026-03-xx (internal)

Hackathon prototype. Stdio transport only, X-API-Key auth, no resources, no
progress, no cancellation, no idempotency, no webhooks. Not published to npm.
