# LOAR MCP Server

Model Context Protocol server that exposes the LOAR platform as tools for AI agents.

## Quick Start

```bash
# From monorepo root
pnpm --filter mcp install

# Run with API key
LOAR_SERVER_URL=https://api.loar.fun \
LOAR_API_KEY=loar_... \
pnpm --filter mcp dev
```

## Environment Variables

| Variable             | Required | Default                 | Description                                                     |
| -------------------- | -------- | ----------------------- | --------------------------------------------------------------- |
| `LOAR_API_KEY`       | Yes      | —                       | API key for authentication (prefix `loar_`).                    |
| `LOAR_SERVER_URL`    | No       | `http://localhost:3000` | LOAR tRPC server URL.                                           |
| `LOAR_MCP_TRANSPORT` | No       | `stdio`                 | `stdio` for local MCP hosts, `sse` for hosted HTTP deployments. |
| `LOAR_MCP_PORT`      | No       | `3333`                  | Listen port (SSE mode only).                                    |
| `LOAR_MCP_HOST`      | No       | `127.0.0.1`             | Bind host (SSE mode only). Use `0.0.0.0` for public listeners.  |

## Transports

### stdio (default)

For Claude Desktop, Cursor, Claude Code, and any local MCP host. The agent
spawns the process and communicates over stdin/stdout.

```bash
LOAR_API_KEY=loar_... npx @loar/mcp-server
```

### SSE (Server-Sent Events over HTTP)

For hosted deployments (OpenClaw remote connector, Hermes Skills Hub, custom
web agents). One MCP session per `GET /sse` request, routed by `sessionId`
on subsequent POSTs.

```bash
LOAR_MCP_TRANSPORT=sse \
LOAR_MCP_PORT=3333 \
LOAR_MCP_HOST=0.0.0.0 \
LOAR_API_KEY=loar_... \
npx @loar/mcp-server
```

Endpoints:

| Method + Path               | Purpose                                               |
| --------------------------- | ----------------------------------------------------- |
| `GET /sse`                  | Open a new MCP session (response is an SSE stream).   |
| `POST /messages?sessionId=` | Send a JSON-RPC message to an existing session.       |
| `GET /health`               | Liveness check — returns `{ ok, sessions, version }`. |

> **Authentication model:** the `LOAR_API_KEY` in the server's environment
> is used for ALL inbound sessions. Multi-tenant SSE (one key per end-user
> via OAuth 2.1) is tracked in Week 4 of the MCP integration PRD.

## Claude Desktop Setup

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "loar": {
      "command": "npx",
      "args": ["tsx", "/path/to/loar/apps/mcp/src/index.ts"],
      "env": {
        "LOAR_SERVER_URL": "https://api.loar.fun",
        "LOAR_API_KEY": "loar_..."
      }
    }
  }
}
```

## Available Tools (25)

### Entities

- `loar_create_entity` — Create character, place, thing, faction, etc.
- `loar_list_entities` — List entities in a universe
- `loar_get_entity` — Get entity details

### Generation

- `loar_generate_video` — AI video generation with smart routing
- `loar_generate_image` — AI image generation
- `loar_create_asset_pack` — Multi-modal entity asset pack

### Universes

- `loar_list_universes` — List all universes
- `loar_get_universe` — Get universe details

### Marketplace

- `loar_submit_to_canon` — Submit content for canon voting
- `loar_get_canon` — Get accepted canon entries

### Collaborations

- `loar_propose_collab` — Propose cross-universe collab

### AI Agents

- `loar_list_ai_agents` — List AI agents for a universe
- `loar_run_pipeline` — Execute an AI agent pipeline
- `loar_get_pipeline_run` — Check pipeline execution status

### Profiles & Discovery

- `loar_get_profile` — Get user profile
- `loar_discover_profiles` — Search creator profiles
- `loar_discover_talent_agents` — Browse talent agents

### Media Generation (Extended)

- `loar_generate_voice` — AI voice generation (TTS/cloning)
- `loar_generate_3d` — AI 3D model generation
- `loar_generate_sound_effect` — AI sound effect generation

### Content & Commerce

- `loar_create_content` — Create content entry
- `loar_mint_content_nft` — Mint content as NFT
- `loar_create_listing` — Create a marketplace listing
- `loar_record_collab_episode` — Record a collaboration episode

### Credits

- `loar_get_credits` — Check credit balance

## Getting an API Key

1. Connect your wallet at [loar.fun](https://loar.fun)
2. Go to Settings → API Keys
3. Create a key with the permissions you need
4. Copy the key (shown only once)

Or via tRPC:

```typescript
const { rawKey } = await trpc.apiKeys.create.mutate({
  name: 'my-mcp-key',
  permissions: ['entities.create', 'generation.generate', 'marketplace.read'],
});
```
