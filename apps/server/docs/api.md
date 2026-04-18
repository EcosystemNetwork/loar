# LOAR Server API Reference

All endpoints are tRPC procedures served at `/trpc/*`.
Auth is SIWE JWT via `Authorization: Bearer <token>` header.

## Domain Map

| Domain            | Router Key         | Auth              | Description                                                       |
| ----------------- | ------------------ | ----------------- | ----------------------------------------------------------------- |
| **Universes**     | `universes`        | public/wallet-sig | Universe CRUD                                                     |
|                   | `collabs`          | protected         | Cross-universe collaborations                                     |
|                   | `universeTeam`     | protected         | Team membership management                                        |
|                   | `universeTreasury` | protected         | Shared credit pool funding                                        |
| **Content**       | `content`          | mixed             | User content CRUD (fan/original/licensed)                         |
|                   | `wiki`             | mixed             | Character wikis, lore generation, Gemini analysis                 |
|                   | `entities`         | mixed             | Universe entities (characters, locations, items)                  |
| **Generation**    | `generation`       | protected         | Unified video gen with smart routing + credits                    |
|                   | `image`            | protected         | Image gen, editing, character creation                            |
|                   | ~~`fal`~~          | protected         | **Deprecated** — use `generation.*` + `image.*`                   |
| **Marketplace**   | `marketplace`      | mixed             | Canon submissions, voting                                         |
|                   | `nft`              | mixed             | Episode & character NFT management                                |
| **Credits**       | `credits`          | mixed             | Credit packages, balance, spend/purchase                          |
| **Subscriptions** | `subscriptions`    | mixed             | Per-universe subscription tiers                                   |
| **Analytics**     | `analytics`        | mixed             | Views, engagement, trending                                       |
| **Ads**           | `ads`              | mixed             | Ad slots, sponsorships, bidding                                   |
| **Licensing**     | `licensing`        | mixed             | IP licenses, merch, royalties                                     |
| **Storage**       | `storage`          | mixed             | Unified decentralized storage (Pinata/IPFS, Lighthouse, Firebase) |
|                   | `firebaseStorage`  | mixed             | Direct Firebase Storage operations                                |
|                   | `synapse`          | mixed             | Direct Filecoin Synapse operations                                |
| **Profiles**      | `profiles`         | mixed             | User profiles, discovery                                          |
| **Quests**        | `quests`           | mixed             | Quest system, affiliates, daily check-ins                         |
| **Sandbox**       | `sandbox`          | protected         | Draft creations                                                   |
| **Admin**         | `admin`            | admin             | Platform config, fee management                                   |

## Auth Matrix

- **public**: No auth required
- **protected**: Requires SIWE JWT
- **admin**: Requires SIWE JWT + ADMIN_WALLET match
- **wallet-sig**: Requires wallet signature in input (for on-chain verification)

---

## Universes Domain

### `universes.create` (mutation, wallet-sig)

Create a new universe with on-chain verification.

```ts
// Input
{
  address: "0x...",        // Timeline contract address
  creator: "0x...",        // Creator wallet
  tokenAddress: "0x...",   // ERC-20 token
  governanceAddress: "0x...",
  imageUrl: "https://...",
  description: "My universe",
  signature: "0x...",      // Wallet signature
  message: "Create universe at 1711234567",
  onChainUniverseId?: "1",
  mintTxHash?: "0x..."
}

// Response
{
  success: true,
  data: { id, address, creator, ... },
  message: "Universe created successfully",
  mintCreditsAwarded: 5000
}
```

### `universes.get` (query, public)

### `universes.getAll` (query, public)

### `universes.getByCreator` (query, public)

### `collabs.propose` (mutation, protected)

```ts
// Input
{
  universeA: "0x...",
  universeB: "0x...",
  revenueShareBps: 5000,  // 50%
  durationDays: 30,
  title: "Epic Crossover",
  description: "..."
}
```

### `collabs.accept` / `collabs.activate` / `collabs.complete` / `collabs.cancel`

### `collabs.getByUniverse` / `collabs.getCollab` / `collabs.getEpisodes` / `collabs.myCollabs`

### `universeTeam.addMember` / `removeMember` / `updateMember` / `getMembers` / `getMyUniverses` / `isMember`

### `universeTreasury.getPool` / `fundPool` / `getTransactions`

---

## Content Domain

### `content.create` (mutation, protected)

```ts
// Input
{
  title: "My Video",
  mediaUrl: "https://...",
  mediaType: "ai-video",
  classification: "fan" | "original" | "licensed",
  ipDeclaration: { isOriginal: true, usesCopyrightedMaterial: false, license: "all-rights-reserved" },
  licensingProof?: { ... },  // Required for "licensed" classification
  tags: ["sci-fi"],
  visibility: "public"
}
```

### `content.update` / `content.delete` / `content.get` / `content.getByCreator` / `content.myContent` / `content.feed`

### `wiki.characters` (query, public)

Returns all characters with metadata.

### `wiki.character` (query, public)

Get a single character by ID.

### `wiki.generateFromVideo` (mutation, protected)

Generate wiki content from video using Gemini AI.

```ts
// Input
{
  universeId: "0x...",
  eventId: "42",
  videoUrl: "https://...",
  title: "Episode 1",
  description: "The beginning",
  characterIds?: ["char-1"],
  previousEvents?: [{ title: "...", description: "..." }]
}

// Response
{
  success: true,
  wikiId: "0x...-42",
  wikiData: { ... },
  metadata: { generatedBy: "gemini-2.5-pro", tokensUsed: 1234, costUsd: 0.05 }
}
```

### `wiki.generateEventWikia` / `wiki.generateStoryline` / `wiki.getWiki` / `wiki.getUniverseWikis` / `wiki.improveVideoPrompt`

---

## Generation Domain

### `generation.generate` (mutation, protected)

Unified video generation with smart auto-routing and credit deduction.

```ts
// Input
{
  prompt: "A dragon flying over mountains",
  mode: "text_to_video" | "image_to_video",
  imageUrl?: "https://...",        // Required for image_to_video
  durationSec: 5,
  resolution: "720p",
  aspectRatio: "16:9",
  routingMode: "auto" | "manual",
  selectedModelId?: "veo3_fast",   // Required for manual
  qualityTarget?: "premium",       // For auto routing
  costBudget?: "medium",
  universeId?: "0x..."
}

// Response
{
  generationId: "uuid",
  status: "completed",
  videoUrl: "https://...",
  modelUsed: "veo3_fast",
  modelDisplayName: "Veo 3.1 Fast",
  routingMode: "auto",
  reasonCode: "quality_match",
  creditsCharged: 50,
  fiatPriceUsd: 0.75,
  wasFallback: false
}
```

### `generation.listModels` (query, public)

### `generation.estimateCost` (query, public)

### `generation.getRecord` / `generation.history` (query, protected)

### `generation.adminListModels` / `adminUpdateModel` / `adminAnalytics` (admin)

### `image.generateImage` (mutation, protected)

```ts
// Input
{
  prompt: "A cyberpunk cityscape",
  model?: "fal-ai/nano-banana",
  imageSize?: "landscape_16_9",
  numImages?: 1
}

// Response
{ status: "completed", imageUrl: "https://...", seed: 12345 }
```

### `image.editImage` / `image.imageToImage` / `image.generateCharacter` / `image.analyzeCharacter` / `image.saveCharacter`

---

## Marketplace Domain

### `marketplace.submit` (mutation, protected)

Submit content for universe canon voting.

```ts
// Input
{
  universeId: "0x...",
  contentHash: "0x...",
  title: "Episode 5",
  description: "...",
  mediaUrl: "https://..."
}
```

### `marketplace.vote` / `marketplace.finalize` / `marketplace.getByUniverse` / `marketplace.getCanon` / `marketplace.licenseCanon` / `marketplace.mySubmissions`

### `nft.createEpisodeListing` / `nft.recordMint` / `nft.getEpisodesByUniverse` / `nft.deactivateEpisode`

### `nft.createCharacterNFT` / `nft.recordAppearance` / `nft.getCharactersByUniverse` / `nft.getMyNFTs`

---

## Credits Domain

### `credits.getBalance` (query, protected)

```ts
// Response
{ balance: 5000, totalPurchased: 10000, totalSpent: 5000, totalBonusReceived: 500 }
```

### `credits.purchase` (mutation, protected)

```ts
// Input
{
  packageId: "starter",
  paymentMethod: "card" | "eth" | "crypto" | "loar",
  txHash?: "0x..."
}
```

### `credits.spend` / `credits.getTiers` / `credits.getCosts` / `credits.getHistory` / `credits.grant`

---

## Analytics Domain

### `analytics.recordView` (mutation, public)

### `analytics.recordEngagement` (mutation, public)

### `analytics.getUniverseMetrics` / `analytics.getEpisodeMetrics` / `analytics.getTrending` / `analytics.getPlatformStats` (query, public)

### `analytics.exportUniverseData` (query, protected)

---

## Storage Domain

### `storage.upload` (mutation, protected)

Upload from URL via unified StorageManager.

```ts
// Input
{ url: "https://...", filename?: "video.mp4" }

// Response (StorageManifest)
{
  contentHash: "sha256:abc...",
  providers: { pinata: { cid: "..." }, firebase: { key: "..." } },
  primaryUrl: "https://..."
}
```

### `storage.uploadDirect` / `storage.resolve` / `storage.getManifest`

### `storage.uploadAsync` / `storage.uploadStatus` / `storage.activeUploads` / `storage.recentUploads` / `storage.retryUpload`

---

## Deprecated Endpoints

| Old Path                     | New Path                                     | Notes                                    |
| ---------------------------- | -------------------------------------------- | ---------------------------------------- |
| `cinematicUniverses.*`       | `universes.*`                                | Same endpoints, renamed                  |
| `fal.generateImage`          | `image.generateImage`                        | Same functionality                       |
| `fal.generateVideo`          | `generation.generate`                        | New unified interface with smart routing |
| `fal.klingVideo`             | `generation.generate` with `selectedModelId` | Manual model selection                   |
| `video.generateWithProvider` | `generation.generate`                        | Removed inline router                    |

The deprecated `fal` and `cinematicUniverses` router keys are kept as aliases for backward compatibility. They will be removed in a future release.

---

## Error Format

All errors follow the tRPC error envelope:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human-readable description",
    "data": {
      "code": "BAD_REQUEST",
      "httpStatus": 400
    }
  }
}
```

Error codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `PAYLOAD_TOO_LARGE`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`

## Hono REST Endpoints

| Method | Path                      | Auth | Description                               |
| ------ | ------------------------- | ---- | ----------------------------------------- |
| GET    | `/health`                 | none | Health check with dependency status       |
| POST   | `/auth/siwe/nonce`        | none | Get SIWE nonce                            |
| POST   | `/auth/siwe/verify`       | none | Verify SIWE signature, get JWT            |
| GET    | `/images/:key`            | none | Serve stored images                       |
| GET    | `/api/filecoin/:pieceCid` | JWT  | Serve Filecoin content                    |
| POST   | `/api/upload`             | JWT  | Direct file upload (multipart, max 200MB) |
