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

| Variable          | Required | Default                 | Description                |
| ----------------- | -------- | ----------------------- | -------------------------- |
| `LOAR_API_KEY`    | Yes      | —                       | API key for authentication |
| `LOAR_SERVER_URL` | No       | `http://localhost:3000` | LOAR server URL            |

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
