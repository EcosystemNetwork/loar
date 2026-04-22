# API Reference

## Server (Hono + tRPC)

**Base URL:** `http://localhost:3000`

### REST Endpoints

| Method | Path                                      | Auth   | Description                                                                                  |
| ------ | ----------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `GET`  | `/`                                       | No     | Returns `"OK"` (simple health check)                                                         |
| `GET`  | `/health`                                 | No     | JSON health status: `{ status, checks, uptime, env }`                                        |
| `GET`  | `/metrics`                                | Bearer | Prometheus exposition. Bearer = `METRICS_AUTH_TOKEN` (or open if unset).                     |
| `GET`  | `/auth/nonce`                             | No     | Generate a fresh nonce for SIWE message construction                                         |
| `POST` | `/auth/verify`                            | No     | Verify signed SIWE message, returns JWT session token                                        |
| `POST` | `/auth/refresh`                           | Bearer | Refresh session — returns new JWT if current is valid                                        |
| `POST` | `/auth/revoke`                            | Bearer | Revoke the current session token (server-side logout)                                        |
| `POST` | `/api/upload`                             | Bearer | Direct file upload (multipart form, max 200MB)                                               |
| `POST` | `/api/stripe/webhook`                     | Stripe | Stripe webhook for `payment_intent.succeeded` events                                         |
| `POST` | `/api/paymaster/sponsorUserOp`            | Bearer | ERC-4337 sponsorship for a user operation (thirdweb/Pimlico/Biconomy).                       |
| `POST` | `/api/paymaster/getUserOperationGasPrice` | Bearer | UserOp gas-price oracle used during sponsorship.                                             |
| `POST` | `/api/paymaster/estimateUserOperationGas` | Bearer | UserOp gas estimation used during sponsorship.                                               |
| `GET`  | `/api/admin/cost/export.csv`              | Admin  | CSV cost-attribution export for accounting. Admin wallet header required.                    |
| `GET`  | `/api/content/:contentId/status`          | No     | Public content moderation status (`active`/`flagged`/`hidden`/...).                          |
| `POST` | `/api/takedown`                           | No     | Public DMCA takedown submission. Rate-limited.                                               |
| `POST` | `/api/ud/reverse`                         | No     | Resolve wallet → Unstoppable Domains handle (null when `UNSTOPPABLE_DOMAINS_API_KEY` unset). |
| `GET`  | `/api/job-status/:jobId`                  | Bearer | Poll async job state (used by sandbox + extract flows).                                      |
| `GET`  | `/images/*`                               | No     | Serve stored images                                                                          |
| `GET`  | `/api/filecoin/:pieceCid`                 | No     | Stream content from Filecoin by PieceCID                                                     |

### tRPC API

All tRPC procedures are accessed at `/trpc/<procedure>`. The web app uses a tRPC client (`apps/web/src/utils/trpc.ts`).

#### Authentication

Two authentication methods are supported:

**1. SIWE JWT** (wallet users):

```
Authorization: Bearer <siwe-session-token>
```

**2. API Key** (programmatic agents):

```
X-API-Key: loar_<prefix>_<hex>
```

Create API keys via `apiKeys.create`. See [docs/agents.md](agents.md) for details.

Procedures marked **[protected]** require either method.

#### healthCheck

- **Type:** query (public)
- **Returns:** `"OK"`

#### privateData

- **Type:** query [protected]
- **Returns:** `{ message: string, user: { uid: string, address: string } }`

---

### universes

> Router renamed from `cinematicUniverses` → `universes`. The Firestore
> collection name is still `cinematicUniverses` for data continuity.

#### universes.create

- **Type:** mutation (protected)
- **Input:**
  ```ts
  {
    address: string; // Universe contract address
    creator: string; // Creator wallet address
    tokenAddress: string; // ERC20 token address
    governanceAddress: string;
    imageUrl: string;
    description: string;
    signature: string; // Wallet signature
    message: string; // Signed message
    nonce: string; // Server-issued nonce (prevents replay)
  }
  ```
- **Returns:** Created universe document

#### universes.get

- **Type:** query
- **Input:** `{ id: string }`
- **Returns:** Universe document or throws `Universe not found` when the
  doc has `isHidden` or `isPrivate` set and the caller is not the creator.

#### universes.getAll

- **Type:** query
- **Input:** none
- **Returns:** Array of universe documents. Excludes `isHidden` docs
  entirely; excludes `isPrivate` docs unless the authenticated caller is
  the creator.

#### universes.getByCreator

- **Type:** query
- **Input:** `{ creator: string }` (0x address)
- **Returns:** Array of universes by creator. When the authenticated
  caller matches `creator`, private universes are included.

#### universes.setPrivate

- **Type:** mutation (protected, creator- or multi-sig-signer-only)
- **Input:** `{ universeId: string, isPrivate: boolean }`
- **Returns:** `{ id: string, isPrivate: boolean }`
- **Behavior:** Flips the owner-controlled `isPrivate` flag. When true,
  the universe + every content item linked by `universeId` (gallery,
  entities, lineage, featured, landing-page cards, search) is removed
  from every public endpoint. The owner retains full visibility of their
  own universe. Writes a `contentAuditLog` entry. See
  [moderation PRD §Universe-Level Visibility](prd-moderation-rights-ops.md).

#### universes.setHidden (admin-only)

- **Type:** mutation (`adminProcedure`)
- **Input:** `{ universeId: string, isHidden: boolean }`
- **Returns:** `{ id: string, isHidden: boolean }`
- **Behavior:** Admin moderation toggle. Same public-removal effect as
  `setPrivate` but intended for takedowns / abuse enforcement. Writes a
  `contentAuditLog` entry.

---

### fal (AI Generation)

#### fal.generateImage

- **Type:** mutation
- **Input:**
  ```ts
  {
    prompt: string
    model?: string
    negativePrompt?: string
    imageSize?: string
    // ... additional Fal AI options
  }
  ```
- **Returns:** Generated image result

#### fal.generateVideo

- **Type:** mutation
- **Input:**
  ```ts
  {
    prompt: string
    model?: string        // veo3.1, sora-2, kling-v2.5, wan25, ltx-video, etc.
    imageUrl?: string     // Image-to-video source
    duration?: number
    aspectRatio?: string
  }
  ```
- **Returns:** `{ id, status, videoUrl, error? }`

#### fal.generateCharacter

- **Type:** mutation
- **Input:** `{ name: string, description: string, style?: string, saveToDatabase?: boolean }`
- **Returns:** Generated character data

---

### wiki

#### wiki.characters

- **Type:** query
- **Returns:**
  ```ts
  {
    metadata: {
      (version, created_at, total_characters, last_updated);
    }
    characters: Array<{
      id;
      character_name;
      collection;
      token_id;
      traits;
      rarity_rank;
      rarity_percentage;
      image_url;
      description;
      created_at;
    }>;
  }
  ```

#### wiki.character

- **Type:** query
- **Input:** `{ id: string }`
- **Returns:** Single character object

#### wiki.generateEventWikia

- **Type:** mutation
- **Input:**
  ```ts
  {
    nodeId: number
    title: string
    description: string
    videoUrl: string
    previousNodes?: Array<{ title: string, plot: string }>
    nextNodes?: Array<{ title: string, plot: string }>
  }
  ```
- **Returns:** Generated wikia entry (uses OpenAI)

#### wiki.generateStoryline

- **Type:** mutation
- **Input:**
  ```ts
  {
    prompt: string                    // Min 1 character
    characters?: string[]
    previousEvents?: Array<{ title: string, description: string }>
  }
  ```
- **Returns:** Generated storyline

#### wiki.generateFromVideo

- **Type:** mutation
- **Input:**
  ```ts
  {
    universeId: string
    eventId: string
    videoUrl: string
    title: string
    description: string
    characterIds?: string[]
    characters?: Array<{
      name: string
      userDescription: string
      visualDescription?: string
    }>
    previousEvents?: Array<{ title: string, description: string }>
  }
  ```
- **Returns:** `{ success, wikiId, wikiData, metadata }` — Saves to Firestore `eventWikis` collection. Uses Gemini 2.5 Pro.

#### wiki.getWiki

- **Type:** query
- **Input:** `{ universeId: string, eventId: string }`
- **Returns:** Wiki document or null

#### wiki.getUniverseWikis

- **Type:** query
- **Input:** `{ universeId: string }`
- **Returns:** Array of wiki documents, ordered by `generatedAt`

#### wiki.improveVideoPrompt

- **Type:** mutation
- **Input:**
  ```ts
  {
    userPrompt: string
    characterContext?: Array<{ name: string, description: string }>
    previousEventContext?: {
      title: string
      summary: string
      plot?: string
    }
  }
  ```
- **Returns:** Improved prompt (uses Gemini)

---

### video

#### video.generateWithProvider

- **Type:** mutation
- **Input:**
  ```ts
  {
    provider: 'fal'               // Currently only 'fal' supported
    prompt: string
    duration?: '5s' | '10s'
    imageUrl?: string             // URL for image-to-video
  }
  ```
- **Returns:** `{ id, status: 'completed'|'dreaming'|'failed'|'pending', videoUrl, failureReason? }`

---

### minio (Firebase Storage)

_Note: Named "minio" for historical reasons. Actually uses Firebase Storage._

#### minio.uploadFromUrl

- **Type:** mutation
- **Input:** `{ url: string, filename?: string }`
- **Returns:** `{ key: string, url: string }`

#### minio.download

- **Type:** query
- **Input:** `{ key: string }`
- **Returns:** `{ data: string (base64), key, originalSize, encodedSize }` (max 5MB)

#### minio.getPublicUrl

- **Type:** query
- **Input:** `{ key: string }`
- **Returns:** `{ url: string }`

---

### synapse (Filecoin)

#### synapse.uploadFromUrl

- **Type:** mutation
- **Input:** `{ url: string }`
- **Returns:** Synapse upload result (includes PieceCID)

#### synapse.download

- **Type:** query
- **Input:** `{ pieceCid: string }`
- **Returns:** `{ data: string (base64), pieceCid, originalSize, encodedSize }` (max 5MB)

#### synapse.getHttpUrl

- **Type:** query
- **Input:** `{ pieceCid: string }`
- **Returns:** `{ url: string }` — HTTP gateway URL for the content

---

---

### talentAgents

See [docs/agents.md](agents.md) for full documentation.

| Procedure                         | Type     | Auth      | Description                      |
| --------------------------------- | -------- | --------- | -------------------------------- |
| `talentAgents.register`           | mutation | protected | Register as talent agent         |
| `talentAgents.updateProfile`      | mutation | protected | Update agent profile             |
| `talentAgents.getProfile`         | query    | public    | Get agent profile by UID         |
| `talentAgents.myProfile`          | query    | protected | Get current user's agent profile |
| `talentAgents.discover`           | query    | public    | Browse agents with filters       |
| `talentAgents.proposeContract`    | mutation | protected | Propose agent-creator contract   |
| `talentAgents.acceptContract`     | mutation | protected | Accept contract proposal         |
| `talentAgents.terminateContract`  | mutation | protected | Terminate contract               |
| `talentAgents.getContract`        | query    | public    | Get contract details             |
| `talentAgents.myContracts`        | query    | protected | List all contracts               |
| `talentAgents.getClients`         | query    | protected | List active clients              |
| `talentAgents.getCommissions`     | query    | protected | Commission history               |
| `talentAgents.getCommissionStats` | query    | protected | Commission summary stats         |

---

### aiAgents

| Procedure                         | Type     | Auth      | Description                     |
| --------------------------------- | -------- | --------- | ------------------------------- |
| `aiAgents.create`                 | mutation | protected | Create AI agent                 |
| `aiAgents.update`                 | mutation | protected | Update agent config             |
| `aiAgents.pause`                  | mutation | protected | Pause agent                     |
| `aiAgents.resume`                 | mutation | protected | Resume agent                    |
| `aiAgents.delete`                 | mutation | protected | Disable agent                   |
| `aiAgents.get`                    | query    | public    | Get agent details               |
| `aiAgents.listByUniverse`         | query    | public    | List agents for universe        |
| `aiAgents.listByOwner`            | query    | protected | List user's agents              |
| `aiAgents.allocateBudget`         | mutation | protected | Transfer credits to agent       |
| `aiAgents.getUsage`               | query    | protected | Get agent credit stats          |
| `aiAgents.getUniverseAssignments` | query    | public    | Get universe agent assignments  |
| `aiAgents.assignTalentAgent`      | mutation | protected | Assign talent agent to universe |

---

### aiPipelines

| Procedure                 | Type     | Auth      | Description              |
| ------------------------- | -------- | --------- | ------------------------ |
| `aiPipelines.create`      | mutation | protected | Define a pipeline        |
| `aiPipelines.update`      | mutation | protected | Edit pipeline            |
| `aiPipelines.delete`      | mutation | protected | Remove pipeline          |
| `aiPipelines.get`         | query    | public    | Get pipeline definition  |
| `aiPipelines.listByAgent` | query    | public    | List pipelines for agent |
| `aiPipelines.run`         | mutation | protected | Execute pipeline         |
| `aiPipelines.getRun`      | query    | protected | Get execution status     |
| `aiPipelines.listRuns`    | query    | protected | Run history              |

---

### apiKeys

| Procedure                      | Type     | Auth      | Description                |
| ------------------------------ | -------- | --------- | -------------------------- |
| `apiKeys.create`               | mutation | protected | Generate new API key       |
| `apiKeys.list`                 | query    | protected | List user's keys           |
| `apiKeys.revoke`               | mutation | protected | Revoke a key               |
| `apiKeys.getUsage`             | query    | protected | Key usage history          |
| `apiKeys.availablePermissions` | query    | protected | List available permissions |

### admin.cost

Admin-only cost attribution. All procedures require the caller's wallet to match `ADMIN_ADDRESSES` (or legacy `ADMIN_WALLET`).

| Procedure                        | Type     | Auth  | Description                                                              |
| -------------------------------- | -------- | ----- | ------------------------------------------------------------------------ |
| `admin.cost.summary`             | query    | admin | Period summary: total cost, revenue, margin, breach flags.               |
| `admin.cost.byModel`             | query    | admin | Cost vs. revenue per model; surfaces negative-margin models.             |
| `admin.cost.trend`               | query    | admin | Daily cost + margin time series for dashboard chart.                     |
| `admin.cost.comparison`          | query    | admin | Cost-per-output comparison across providers for the same modality.       |
| `admin.cost.topMovers`           | query    | admin | Biggest week-over-week cost shifts by provider/model.                    |
| `admin.cost.ledger`              | query    | admin | Recent cost-tracker ledger rows, paginated.                              |
| `admin.cost.controls.get`        | query    | admin | Current controls: daily cap, margin target.                              |
| `admin.cost.controls.update`     | mutation | admin | Adjust daily cap / margin target; invalidates controls cache.            |
| `admin.cost.controls.invalidate` | mutation | admin | Force-refresh the controls cache across replicas.                        |
| `admin.cost.alerts.list`         | query    | admin | Recent alert fires (margin breach, cap breach).                          |
| `admin.cost.alerts.acknowledge`  | mutation | admin | Mark an alert acknowledged — suppresses repeats for its cooldown window. |
| `admin.cost.alerts.runNow`       | mutation | admin | Force an immediate alert-sweep pass (bypasses schedule).                 |

See also the REST CSV export: `GET /api/admin/cost/export.csv`.

### jobs

Universal job status polling used by the sandbox, VLM extract flow, and mobile download UI. Wraps the per-kind BullMQ queues behind a single normalized shape.

| Procedure     | Type     | Auth      | Description                                                            |
| ------------- | -------- | --------- | ---------------------------------------------------------------------- |
| `jobs.status` | query    | protected | Normalized status: `{status, progress, resultUrl, resultUrls, error}`. |
| `jobs.cancel` | mutation | protected | Cancel an in-flight job the caller owns.                               |

### vlm

Vision-Language Model pipeline. See [docs/prd-vlm-subsystem.md](prd-vlm-subsystem.md).

| Sub-router                                                                 | Purpose                                                                             |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `vlm.extract.{start, status, get}`                                         | Async extraction of scenes/entities from video/image into `vlmExtractions`.         |
| `vlm.proposals.{list, accept, reject, merge}`                              | Review queue for auto-proposed entities before they become canonical.               |
| `vlm.canon.{check, getConflicts}`                                          | Pre-publish canon consistency check; surfaces block/warn/info conflicts.            |
| `vlm.moderation.{riskScore, batchRiskScores, requeue, overrideAutoAction}` | Content risk scoring, feeds the flags + audit-log pipeline.                         |
| `vlm.search.query`                                                         | Multimodal search across `sceneIndex` (lexical + optional embeddings).              |
| `vlm.copilot.{improvePrompt, extractStyleBible, scoreOutput}`              | Prompt coaching, style-bible extraction, output-quality scoring.                    |
| `vlm.recap.generate`                                                       | Chapters, trailer beats, social cuts, SEO title/description, thumbnail suggestions. |
| `vlm.governance.{draftProposal, listDrafts}`                               | Grounded canon proposal drafts for on-chain voting.                                 |

### moderation (public + admin)

| Procedure                     | Type     | Auth      | Description                                                     |
| ----------------------------- | -------- | --------- | --------------------------------------------------------------- |
| `moderation.flag`             | mutation | protected | User flags a piece of content; writes a `flags` doc.            |
| `moderation.getStatus`        | query    | public    | Current `contentStatus` for a content ID.                       |
| `admin.moderation.queue`      | query    | admin     | Pending review queue.                                           |
| `admin.moderation.decide`     | mutation | admin     | Accept/reject a flag; writes immutable `contentAuditLog` entry. |
| `admin.moderation.takedown.*` | multiple | admin     | DMCA intake, counter-notice, putback workflow.                  |

---

## Indexer GraphQL API

**URL:** `http://localhost:42069` (Ponder serves GraphQL at root)

### Example Queries

#### Get all universes

```graphql
{
  universes {
    items {
      id
      creator
      name
      description
      imageURL
      tokenAddress
      governorAddress
      nodeCount
    }
  }
}
```

#### Get universe with nodes

```graphql
{
  universe(id: "0x...") {
    id
    name
    creator
    nodes {
      items {
        nodeId
        previousNodeId
        creator
        createdAt
      }
    }
  }
}
```

#### Get token holders

```graphql
{
  tokenHolders(where: { tokenAddress: "0x..." }, orderBy: "balance", orderDirection: "desc") {
    items {
      holderAddress
      balance
    }
  }
}
```

#### Get governance proposals

```graphql
{
  proposals(where: { governorAddress: "0x..." }) {
    items {
      id
      proposer
      description
      startBlock
      endBlock
      executed
      cancelled
      votes {
        items {
          voter
          support
          weight
        }
      }
    }
  }
}
```

#### Get recent swaps for a pool

```graphql
{
  swaps(where: { poolId: "0x..." }, orderBy: "timestamp", orderDirection: "desc", limit: 20) {
    items {
      sender
      amount0
      amount1
      tick
      timestamp
    }
  }
}
```

### Available Tables

See [docs/database.md](database.md) for the full schema of all indexed tables.
