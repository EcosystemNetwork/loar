# API Reference

## Server (Hono + tRPC)

**Base URL:** `http://localhost:3000`

### REST Endpoints

| Method | Path                      | Description                                 |
| ------ | ------------------------- | ------------------------------------------- |
| `GET`  | `/`                       | Returns `"OK"` (simple health check)        |
| `GET`  | `/health`                 | JSON health status: `{ status, timestamp }` |
| `GET`  | `/images/*`               | Serve stored images                         |
| `GET`  | `/api/filecoin/:pieceCid` | Stream content from Filecoin by PieceCID    |

### tRPC API

All tRPC procedures are accessed at `/trpc/<procedure>`. The web app uses a tRPC client (`apps/web/src/utils/trpc.ts`).

#### Authentication

Procedures marked **[protected]** require a SIWE session JWT:

```
Authorization: Bearer <siwe-session-token>
```

#### healthCheck

- **Type:** query (public)
- **Returns:** `"OK"`

#### privateData

- **Type:** query [protected]
- **Returns:** `{ message: string, user: { uid: string, address: string } }`

---

### cinematicUniverses

#### cinematicUniverses.createcu

- **Type:** mutation
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
  }
  ```
- **Returns:** Created universe document

#### cinematicUniverses.get

- **Type:** query
- **Input:** `{ id: string }`
- **Returns:** Universe document or null

#### cinematicUniverses.getAll

- **Type:** query
- **Input:** none
- **Returns:** Array of all universe documents

#### cinematicUniverses.getByCreator

- **Type:** query
- **Input:** `{ creator: string }` (0x address)
- **Returns:** Array of universes by creator

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
