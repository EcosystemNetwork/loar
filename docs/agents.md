# Agent Systems

LOAR supports two agent systems: **Talent Agents** (human representatives) and **AI Agent Pipelines** (autonomous AI agents), plus an **API key** system and **MCP server** for programmatic access.

---

## 1. Talent Agents

Human agents who discover creators, represent them, broker deals, and earn commissions.

### Registration

Register as a talent agent via `/agents/register` or:

```
POST /trpc/talentAgents.register
Authorization: Bearer <jwt>

{
  "agencyName": "Creative Universe Agency",
  "displayName": "Jane Agent",
  "bio": "Specializing in animation IP licensing",
  "specialties": ["animation", "licensing", "brand-deals"]
}
```

### Contract Flow

1. **Propose** — Agent or creator proposes a contract with commission rate (BPS), scope, and duration
2. **Accept** — Counterparty accepts, activating the contract
3. **Act on Behalf** — Agent uses `onBehalfOfUid` parameter in supported endpoints
4. **Commission** — Commissions are automatically tracked when deals close

### Supported `onBehalfOfUid` Endpoints

| Endpoint                   | Scope         |
| -------------------------- | ------------- |
| `collabs.propose`          | `collabs`     |
| `collabs.accept`           | `collabs`     |
| `licensing.createLicense`  | `licensing`   |
| `marketplace.submit`       | `marketplace` |
| `marketplace.licenseCanon` | `marketplace` |

### Contract Scopes

- `licensing` — IP licensing deals
- `collabs` — Cross-universe collaborations
- `marketplace` — Canon submissions and licensing
- `merch` — Merchandise management

### Firestore Collections

- `talentAgentProfiles/{uid}` — Agent profiles
- `agentContracts/{agentUid}-{creatorUid}` — Formal contracts
- `agentCommissions/{id}` — Commission ledger

---

## 2. AI Agent Pipelines

Autonomous AI agents with their own credit budgets, scoped permissions, and composable workflows.

### Agent Types

| Type                      | Description                          |
| ------------------------- | ------------------------------------ |
| `content_creator`         | Generates assets, images, videos     |
| `universe_manager`        | Manages entities, storylines, lore   |
| `moderator`               | Reviews and flags content            |
| `universe_representative` | Negotiates collabs, manages treasury |

### Permissions

| Permission          | Allowed Actions                                     |
| ------------------- | --------------------------------------------------- |
| `create_entities`   | Create/update entities                              |
| `generate_assets`   | Studio asset packs, image/video/voice/3D generation |
| `submit_canon`      | Submit to canon marketplace                         |
| `manage_storylines` | Create content and lore entries                     |
| `negotiate_collabs` | Propose cross-universe collabs                      |
| `moderate`          | Flag content within universe                        |

### Creating an AI Agent

```
POST /trpc/aiAgents.create
Authorization: Bearer <jwt>

{
  "name": "Universe Showrunner",
  "type": "universe_manager",
  "universeId": "0x...",
  "permissions": ["create_entities", "generate_assets", "submit_canon"],
  "creditBudgetPeriod": "monthly"
}
```

### Credit Budget

1. Owner allocates credits: `aiAgents.allocateBudget({ agentId, amount: 500 })`
2. Credits transfer from owner's balance to agent's isolated budget
3. Pipeline steps deduct from agent's budget
4. Budget exhaustion fails the step (configurable: abort, skip, retry)

### Pipeline Definition

Pipelines are composable multi-step workflows:

```json
{
  "name": "Character Pack Pipeline",
  "aiAgentId": "uuid-...",
  "steps": [
    {
      "stepId": "step_1",
      "action": "entities.create",
      "config": { "name": "New Character", "kind": "person", "description": "..." },
      "onFailure": "abort"
    },
    {
      "stepId": "step_2",
      "action": "studio.createEntityPack",
      "inputMapping": { "entityId": "step_1.id" },
      "config": { "capabilities": ["portrait", "voice", "lore_card"] },
      "onFailure": "skip"
    },
    {
      "stepId": "step_3",
      "action": "marketplace.submit",
      "inputMapping": { "title": "step_1.name" },
      "config": { "submissionType": "CHARACTER" },
      "onFailure": "abort"
    }
  ]
}
```

### Available Pipeline Actions

| Action                    | Credits        | Description              |
| ------------------------- | -------------- | ------------------------ |
| `entities.create`         | 0              | Create an entity         |
| `entities.update`         | 0              | Update an entity         |
| `studio.createEntityPack` | ~10/capability | Generate full asset pack |
| `generation.generate`     | ~15            | Generate video           |
| `image.generate`          | ~5             | Generate image           |
| `marketplace.submit`      | 0              | Submit to canon          |
| `collabs.propose`         | 0              | Propose collaboration    |
| `content.create`          | 0              | Create content           |
| `wiki.generate`           | 0              | Generate lore entry      |

### Firestore Collections

- `aiAgents/{agentId}` — Agent definitions
- `aiAgentCredits/{agentId}` — Isolated credit budgets
- `aiAgentPipelines/{pipelineId}` — Pipeline definitions
- `aiAgentPipelineRuns/{runId}` — Execution logs
- `universeAgentAssignments/{universeId}` — Universe → agent mappings

---

## 3. API Keys

Programmatic access for external integrations and AI agents.

### Authentication

Include the API key in the `X-API-Key` header:

```
X-API-Key: loar_<prefix>_<hex>
```

API keys can be used anywhere SIWE JWT auth is accepted. The key authenticates as the key owner's wallet address.

### Creating a Key

```
POST /trpc/apiKeys.create
Authorization: Bearer <jwt>

{
  "name": "Production Agent",
  "aiAgentId": "uuid-...",  // optional: link to AI agent
  "permissions": ["entities.create", "generation.generate", "marketplace.read"],
  "rateLimitPerMinute": 60,
  "expiresInDays": 90
}
```

Response includes `rawKey` — **save this immediately, it's shown only once**.

### Rate Limiting

- Per-key rate limits (configurable, default 60 req/min)
- In-memory sliding window
- Returns null auth on limit exceeded

### Usage Tracking

All API key requests are tracked in `apiKeyUsage` with endpoint and credit consumption.

### Firestore Collections

- `apiKeys/{id}` — Key records (hashed, never stored raw)
- `apiKeyUsage/{id}` — Request logs

---

## 4. MCP Server

LOAR exposes its platform as an MCP (Model Context Protocol) server, enabling any MCP-compatible AI to use LOAR natively.

### Setup

```bash
# Install dependencies
pnpm --filter mcp install

# Run the MCP server
LOAR_SERVER_URL=https://api.loar.fun LOAR_API_KEY=loar_... pnpm --filter mcp dev
```

### Claude Desktop Configuration

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

### Available Tools (25)

| Tool                          | Description                                   |
| ----------------------------- | --------------------------------------------- |
| `loar_create_entity`          | Create entity (character, place, thing, etc.) |
| `loar_list_entities`          | List entities in a universe                   |
| `loar_get_entity`             | Get entity details                            |
| `loar_generate_video`         | AI video generation with smart routing        |
| `loar_generate_image`         | AI image generation                           |
| `loar_create_asset_pack`      | Multi-modal entity asset pack                 |
| `loar_list_universes`         | List all universes                            |
| `loar_get_universe`           | Get universe details                          |
| `loar_submit_to_canon`        | Submit content for canon voting               |
| `loar_get_canon`              | Get accepted canon entries                    |
| `loar_propose_collab`         | Propose cross-universe collab                 |
| `loar_list_ai_agents`         | List AI agents for a universe                 |
| `loar_run_pipeline`           | Execute an AI agent pipeline                  |
| `loar_get_pipeline_run`       | Check pipeline execution status               |
| `loar_get_profile`            | Get user profile                              |
| `loar_discover_profiles`      | Search creator profiles                       |
| `loar_discover_talent_agents` | Browse talent agents                          |
| `loar_generate_voice`         | AI voice generation (TTS/cloning)             |
| `loar_generate_3d`            | AI 3D model generation                        |
| `loar_generate_sound_effect`  | AI sound effect generation                    |
| `loar_create_content`         | Create content entry                          |
| `loar_mint_content_nft`       | Mint content as NFT                           |
| `loar_create_listing`         | Create a marketplace listing                  |
| `loar_record_collab_episode`  | Record a collaboration episode                |
| `loar_get_credits`            | Check credit balance                          |

---

## Frontend Routes

| Route               | Description                                       |
| ------------------- | ------------------------------------------------- |
| `/agents`           | Talent agent discovery                            |
| `/agents/$uid`      | Agent public profile                              |
| `/agents/register`  | Register as talent agent                          |
| `/agents/dashboard` | Agent dashboard (clients, contracts, commissions) |

Universe-level agent management is available in the universe detail page via the `UniverseAgentPanel` component.
