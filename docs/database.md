# Database Schema

## Overview

LOAR uses two data stores:

1. **Firebase Firestore** — Server-side document database for application data
2. **Ponder** — Indexed blockchain data from Sepolia (read-only, auto-populated)

## Firestore Collections

### `characters`

Individual character entries for cinematic universes.

| Field                         | Type           | Description                              |
| ----------------------------- | -------------- | ---------------------------------------- |
| `character_name`              | string         | Character display name                   |
| `collection`                  | string         | Collection name (e.g., "Nano Banana AI") |
| `token_id`                    | string         | Associated token ID                      |
| `traits`                      | map            | `{ style, generated_with, seed, ... }`   |
| `rarity_rank`                 | number         | Rarity ranking                           |
| `rarity_percentage`           | number \| null | Rarity as percentage                     |
| `image_url`                   | string         | Character image URL                      |
| `description`                 | string         | Character description                    |
| `detailed_visual_description` | string \| null | Detailed visual description              |
| `created_at`                  | timestamp      | Creation time                            |
| `updated_at`                  | timestamp      | Last update time                         |

**Document ID:** Auto-generated (e.g., `nano-<timestamp>-<random>`)

### `eventWikis`

AI-generated wiki entries for events within a universe.

| Field              | Type             | Description                              |
| ------------------ | ---------------- | ---------------------------------------- |
| `universeId`       | string           | Parent universe ID                       |
| `eventId`          | string           | Event identifier                         |
| `wikiData`         | map              | Generated wiki content (structured data) |
| `videoUrl`         | string           | Source video URL                         |
| `eventTitle`       | string           | Event title                              |
| `eventDescription` | string           | Event description                        |
| `characterIds`     | string[] \| null | Referenced character IDs                 |
| `generatedBy`      | string           | AI model used (e.g., "gemini-2.5-pro")   |
| `tokensUsed`       | number           | Total tokens consumed                    |
| `inputTokens`      | number           | Input tokens                             |
| `outputTokens`     | number           | Output tokens                            |
| `costUsd`          | string           | Estimated cost in USD                    |
| `generatedAt`      | timestamp        | Generation time                          |
| `updatedAt`        | timestamp        | Last update time                         |

**Document ID:** `{universeId}-{eventId}`

### `cinematicUniverses`

Cinematic universe metadata (off-chain supplement to on-chain data).

| Field                    | Type      | Description                                                                                                                                                                                                                 |
| ------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `address`                | string    | Universe contract address                                                                                                                                                                                                   |
| `creator`                | string    | Creator wallet address (0x), or Safe address when multi-sig                                                                                                                                                                 |
| `tokenAddress`           | string    | Governance token address                                                                                                                                                                                                    |
| `governanceAddress`      | string    | Governor contract address                                                                                                                                                                                                   |
| `image_url`              | string    | Universe cover image URL                                                                                                                                                                                                    |
| `portrait_image_url`     | string?   | Optional portrait variant for tall cards                                                                                                                                                                                    |
| `description`            | string    | Universe description                                                                                                                                                                                                        |
| `onChainUniverseId`      | string?   | UniverseManager integer id (null until confirmed)                                                                                                                                                                           |
| `mintTxHash`             | string?   | Tx hash of the original universe-mint tx                                                                                                                                                                                    |
| `chainId`                | number?   | Chain the universe was deployed on (11155111 Sepolia, 84532 Base Sepolia, 8453 Base)                                                                                                                                        |
| `unstoppableDomain`      | string?   | Optional UD name linked to the universe                                                                                                                                                                                     |
| `hasPrivateSection`      | boolean   | Whether Creator's Room is enabled (default true)                                                                                                                                                                            |
| `accessModel`            | string    | `open` / `subscription` / `token_gate` / `both` — gates Creator's Room + paid tiers                                                                                                                                         |
| `universeType`           | string    | `fun` (no monetization) / `monetized` (revenue-bearing)                                                                                                                                                                     |
| `isMultiSig`             | boolean   | True when `creator` is a Gnosis Safe                                                                                                                                                                                        |
| `multiSigAddress`        | string?   | Safe address when `isMultiSig`                                                                                                                                                                                              |
| `isHidden`               | boolean   | **Admin-set** soft-delete. Removes universe + content from public surfaces. See PRD-10                                                                                                                                      |
| `isPrivate`              | boolean   | **Owner-set** visibility toggle. Same public-removal effect as `isHidden`, but the owner retains full access to their own universe + content. See [moderation PRD §Universe-Level Visibility](prd-moderation-rights-ops.md) |
| `canonStylePackEntityId` | string?   | Pointer to the canon style_pack entity, if declared                                                                                                                                                                         |
| `created_at`             | timestamp | Creation time                                                                                                                                                                                                               |
| `updated_at`             | timestamp | Last update time                                                                                                                                                                                                            |

**Document ID:** Lowercase universe contract address.

**Visibility enforcement:** Every public listing/read endpoint (`universes.*`, `gallery.*`, `entities.*`) calls `getExcludedUniverseIds({ viewerAddress })` once and filters results whose `universeId` is in the excluded set. A universe is excluded if `isHidden === true` OR (`isPrivate === true` AND viewer ≠ creator). `isHidden` is orthogonal to `isPrivate` — either one is enough to hide a universe. Both toggles write a `contentAuditLog` entry.

---

## Ponder Schema (On-Chain Data)

Defined in `apps/indexer/ponder.schema.ts`. This data is indexed from Sepolia blockchain events and is read-only.

### `universe`

| Column            | Type      | Description               |
| ----------------- | --------- | ------------------------- |
| `id`              | text (PK) | Universe contract address |
| `universeId`      | integer   | ID from UniverseManager   |
| `creator`         | hex       | Creator wallet address    |
| `createdAt`       | integer   | Block timestamp           |
| `name`            | text      | Universe name             |
| `description`     | text      | Universe description      |
| `imageURL`        | text      | Universe image URL        |
| `tokenAddress`    | hex       | Governance token address  |
| `governorAddress` | hex       | Governor contract address |
| `nodeCount`       | integer   | Number of narrative nodes |

**Indexes:** `creator`

### `token`

| Column            | Type      | Description                     |
| ----------------- | --------- | ------------------------------- |
| `id`              | text (PK) | Token contract address          |
| `universeAddress` | hex       | Parent universe address         |
| `deployer`        | hex       | Deployer address                |
| `tokenAdmin`      | hex       | Admin address                   |
| `name`            | text      | Token name                      |
| `symbol`          | text      | Token symbol                    |
| `imageURL`        | text      | Token image                     |
| `metadata`        | text      | Token metadata                  |
| `context`         | text      | Token context                   |
| `startingTick`    | text      | Starting tick (int24 as string) |
| `poolHook`        | hex       | Associated pool hook address    |
| `poolId`          | hex       | Uniswap pool ID                 |
| `pairedToken`     | hex       | Paired token address            |
| `locker`          | hex       | LP locker address               |
| `createdAt`       | integer   | Block timestamp                 |

**Indexes:** `deployer`, `universeAddress`

### `node`

| Column            | Type      | Description                  |
| ----------------- | --------- | ---------------------------- |
| `id`              | text (PK) | `{universeAddress}:{nodeId}` |
| `universeAddress` | hex       | Parent universe              |
| `nodeId`          | integer   | Node ID within universe      |
| `previousNodeId`  | integer   | Parent node (tree structure) |
| `creator`         | hex       | Node creator                 |
| `createdAt`       | integer   | Block timestamp              |

**Indexes:** `universeAddress`, `creator`

### `nodeContent`

| Column      | Type      | Description                  |
| ----------- | --------- | ---------------------------- |
| `id`        | text (PK) | `{universeAddress}:{nodeId}` |
| `videoLink` | text      | Video URL for this node      |
| `plot`      | text      | Plot/storyline text          |

### `nodeCanonization`

| Column            | Type      | Description       |
| ----------------- | --------- | ----------------- |
| `id`              | text (PK) | Unique ID         |
| `universeAddress` | hex       | Universe address  |
| `nodeId`          | integer   | Canonized node ID |
| `canonizer`       | hex       | Who canonized it  |
| `timestamp`       | integer   | Block timestamp   |

**Indexes:** `universeAddress`

### `tokenTransfer`

| Column         | Type      | Description               |
| -------------- | --------- | ------------------------- |
| `id`           | text (PK) | Unique ID                 |
| `tokenAddress` | hex       | Token contract            |
| `from`         | hex       | Sender address            |
| `to`           | hex       | Receiver address          |
| `value`        | text      | Amount (bigint as string) |
| `timestamp`    | integer   | Block timestamp           |
| `blockNumber`  | integer   | Block number              |

**Indexes:** `tokenAddress`, `from`, `to`

### `tokenHolder`

| Column          | Type      | Description                        |
| --------------- | --------- | ---------------------------------- |
| `id`            | text (PK) | `{tokenAddress}:{holderAddress}`   |
| `tokenAddress`  | hex       | Token contract                     |
| `holderAddress` | hex       | Holder wallet                      |
| `balance`       | text      | Current balance (bigint as string) |

**Indexes:** `tokenAddress`, `holderAddress`

### `pool`

| Column          | Type     | Description            |
| --------------- | -------- | ---------------------- |
| `poolId`        | hex (PK) | Uniswap v4 pool ID     |
| `currency0`     | hex      | First token address    |
| `currency1`     | hex      | Second token address   |
| `fee`           | integer  | Pool fee               |
| `tickSpacing`   | integer  | Tick spacing           |
| `hooks`         | hex      | Hook contract address  |
| `sqrtPriceX96`  | text     | Current price (bigint) |
| `tick`          | integer  | Current tick           |
| `creationBlock` | integer  | Creation block number  |

**Indexes:** `currency0`, `currency1`, `hooks`

### `swap`

| Column         | Type      | Description            |
| -------------- | --------- | ---------------------- |
| `id`           | text (PK) | Unique ID              |
| `poolId`       | hex       | Pool ID                |
| `sender`       | hex       | Swapper address        |
| `amount0`      | text      | Token0 amount (bigint) |
| `amount1`      | text      | Token1 amount (bigint) |
| `sqrtPriceX96` | text      | Price after swap       |
| `liquidity`    | text      | Pool liquidity         |
| `tick`         | integer   | Tick after swap        |
| `timestamp`    | integer   | Block timestamp        |
| `blockNumber`  | integer   | Block number           |

**Indexes:** `poolId`, `sender`, `blockNumber`

### `proposal`

| Column            | Type      | Description                    |
| ----------------- | --------- | ------------------------------ |
| `id`              | text (PK) | Proposal ID                    |
| `governorAddress` | hex       | Governor contract              |
| `universeAddress` | hex       | Associated universe            |
| `proposer`        | hex       | Proposer address               |
| `targets`         | text      | JSON array of target addresses |
| `values`          | text      | JSON array of ETH values       |
| `calldatas`       | text      | JSON array of calldata         |
| `description`     | text      | Proposal description           |
| `startBlock`      | integer   | Voting start block             |
| `endBlock`        | integer   | Voting end block               |
| `executed`        | boolean   | Whether executed               |
| `cancelled`       | boolean   | Whether cancelled              |
| `createdAt`       | integer   | Block timestamp                |

**Indexes:** `governorAddress`, `proposerAddress`, `universeAddress`

### `proposalExecution`

| Column            | Type      | Description          |
| ----------------- | --------- | -------------------- |
| `id`              | text (PK) | Unique ID            |
| `proposalId`      | text      | Executed proposal ID |
| `governorAddress` | hex       | Governor contract    |
| `timestamp`       | integer   | Execution timestamp  |

**Indexes:** `proposalId`

### `proposalCancellation`

| Column            | Type      | Description            |
| ----------------- | --------- | ---------------------- |
| `id`              | text (PK) | Unique ID              |
| `proposalId`      | text      | Cancelled proposal ID  |
| `governorAddress` | hex       | Governor contract      |
| `timestamp`       | integer   | Cancellation timestamp |

**Indexes:** `proposalId`

### `vote`

| Column            | Type         | Description                       |
| ----------------- | ------------ | --------------------------------- |
| `id`              | text (PK)    | `{proposalId}:{voter}`            |
| `proposalId`      | text         | Proposal being voted on           |
| `governorAddress` | hex          | Governor contract                 |
| `voter`           | hex          | Voter address                     |
| `support`         | integer      | 0 = against, 1 = for, 2 = abstain |
| `weight`          | text         | Vote weight (bigint as string)    |
| `reason`          | text \| null | Vote reason (optional)            |
| `timestamp`       | integer      | Block timestamp                   |

**Indexes:** `proposalId`, `voter`

### `hookEvent`

| Column         | Type      | Description             |
| -------------- | --------- | ----------------------- |
| `id`           | text (PK) | Unique ID               |
| `timestamp`    | integer   | Block timestamp         |
| `hook_address` | hex       | Hook contract address   |
| `enabled`      | boolean   | Whether hook is enabled |

## Relations

```
universe ──┬── token (one, via tokenAddress)
           ├── nodes (many, via universeAddress)
           └── proposals (many, via universeAddress)

token ──── universe (one, via universeAddress)

node ──── universe (one, via universeAddress)

proposal ──┬── universe (one, via universeAddress)
           ├── votes (many, via proposalId)
           ├── execution (one, via proposalId)
           └── cancellation (one, via proposalId)

vote ──── proposal (one, via proposalId)
```

## Querying Ponder Data from the Frontend

The web app uses a GraphQL helper in `apps/web/src/utils/ponder-api.ts`:

```typescript
import { ponderGql } from '../utils/ponder-api';

const data = await ponderGql(`{
  universes {
    items {
      id
      name
      creator
      nodeCount
    }
  }
}`);
```

The Ponder URL is configured via `VITE_PONDER_URL` (default: `http://localhost:42069`).
