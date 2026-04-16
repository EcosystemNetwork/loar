# Architecture

## System Overview

```mermaid
graph TD
    subgraph Frontend
        WEB[Web App<br/>React 18 + Vite<br/>:3001]
    end

    subgraph Backend
        SERVER[API Server<br/>Hono + tRPC<br/>:3000]
        INDEXER[Blockchain Indexer<br/>Ponder v0.15<br/>:42069]
        MCP[MCP Server<br/>AI Agent Gateway<br/>stdio]
    end

    subgraph External Services
        FIREBASE[(Firebase<br/>Firestore Only)]
        FAL[Fal AI<br/>Video/Image Generation]
        BYTEDANCE[ByteDance ModelArk<br/>Seedance 2.0 Video]
        GEMINI[Google Gemini<br/>Wiki Generation]
        OPENAI[OpenAI<br/>Storyline Generation]
        PINATA[Pinata<br/>Hot Storage]
        LIGHTHOUSE[Lighthouse<br/>Filecoin/IPFS]
    end

    subgraph Blockchain
        SEPOLIA[Sepolia Testnet<br/>Smart Contracts]
        BASE[Base L2<br/>Target Mainnet]
    end

    WEB -->|tRPC over HTTP| SERVER
    WEB -->|GraphQL| INDEXER
    WEB -->|wagmi + thirdweb| SEPOLIA

    SERVER --> FIREBASE
    SERVER --> FAL
    SERVER --> BYTEDANCE
    SERVER --> GEMINI
    SERVER --> OPENAI
    SERVER --> PINATA
    SERVER --> LIGHTHOUSE
    INDEXER -->|RPC polling| SEPOLIA

    MCP -->|X-API-Key| SERVER
```

### Agent Systems

LOAR supports two agent systems with programmatic access:

| System                 | Type       | Description                                           |
| ---------------------- | ---------- | ----------------------------------------------------- |
| **Talent Agents**      | Human      | Represent creators, broker deals, earn commissions    |
| **AI Agent Pipelines** | Autonomous | Multi-step content creation and universe management   |
| **API Keys**           | Auth       | Programmatic access via `X-API-Key` header            |
| **MCP Server**         | Gateway    | Exposes LOAR as 20 tools for MCP-compatible AI agents |

See [docs/agents.md](agents.md) for full documentation.

## Authentication Flow

```mermaid
sequenceDiagram
    participant User
    participant Web as Web App
    participant Wallet as thirdweb Wallet
    participant Server as API Server

    User->>Web: Connect wallet (MetaMask, WalletConnect, etc.)
    Web->>Wallet: Connect via thirdweb
    Wallet-->>Web: Wallet address (0x...)
    Web->>Wallet: Sign SIWE message
    Wallet-->>Web: Signature

    Web->>Server: POST /auth/verify { message, signature }
    Server->>Server: Verify SIWE signature, issue JWT
    Server-->>Web: { token (JWT), address, chain: "evm" }
    Web->>Web: Store token in localStorage

    Note over Web,Server: On each tRPC request:
    Web->>Server: tRPC request + Authorization: Bearer <session-token>
    Server->>Server: verifySessionToken(token) → { sub: address }
    Server->>Server: ctx.user = { uid: address, address }
    Server-->>Web: Response
```

### Key Auth Files

| File                              | Role                                                    |
| --------------------------------- | ------------------------------------------------------- |
| `apps/web/src/lib/wallet-auth.ts` | `useWalletAuth()` hook — SIWE sign-in/sign-out          |
| `apps/web/src/utils/trpc.ts`      | Attaches Bearer token to tRPC requests                  |
| `apps/server/src/lib/siwe.ts`     | SIWE message verification, JWT signing/verification     |
| `apps/server/src/lib/auth.ts`     | `verifyAuth()` — supports SIWE JWT + API key auth       |
| `apps/server/src/lib/apiKeys.ts`  | API key generation, verification, rate limiting         |
| `apps/server/src/lib/context.ts`  | `createContext()` — sets `ctx.user` from verified token |
| `apps/server/src/lib/firebase.ts` | Firebase Admin SDK init (exports `db` — Firestore only) |
| `apps/server/src/lib/trpc.ts`     | Defines `publicProcedure` and `protectedProcedure`      |

### Access Control

- **`publicProcedure`** — No authentication required. Used for read-only queries.
- **`protectedProcedure`** — Requires SIWE JWT or valid API key. Rejects with UNAUTHORIZED if `ctx.user` is null.
- **API Key auth** — `X-API-Key: loar_...` header. Keys are SHA-256 hashed, rate-limited, and scoped with permissions. See `apps/server/src/lib/apiKeys.ts`.

## Server Architecture

**Entry point:** `apps/server/src/index.ts`

The server uses [Hono](https://hono.dev/) as the HTTP framework with middleware:

1. **Logger** — Request/response logging
2. **CORS** — Origin restricted to `CORS_ORIGIN` env var
3. **Image routes** — `GET /images/*` serves stored images
4. **Filecoin route** — `GET /api/filecoin/:pieceCid` streams content from Filecoin/Synapse
5. **tRPC** — `POST /trpc/*` handles all tRPC procedures
6. **Health** — `GET /` returns "OK", `GET /health` returns JSON status

### tRPC Router Tree

```
appRouter (45+ routers, 150+ procedures)
├── healthCheck              (query, public)
├── privateData              (query, protected)
├── universes                (sub-router) — CRUD, team, treasury
├── content                  (sub-router) — user content, wiki/lore generation
├── generation               (sub-router) — AI video with smart routing + billing
├── image                    (sub-router) — image generation with history
├── voice                    (sub-router) — TTS, sound effects, voice cloning
├── threed                   (sub-router) — 3D generation (Meshy)
├── studio                   (sub-router) — entity asset pack orchestrator
├── fal                      (sub-router) — FAL AI integration
├── video                    (sub-router) — video generation with provider selection
├── wiki                     (sub-router) — characters, wikia, storylines
├── marketplace              (sub-router) — canon submissions, voting
├── nft                      (sub-router) — NFT minting and metadata
├── listings                 (sub-router) — content listings
├── credits                  (sub-router) — credit packages and balances
├── subscriptions            (sub-router) — universe subscription tiers
├── analytics                (sub-router) — views, engagement, trending
├── ads                      (sub-router) — ad slots and sponsorships
├── licensing                (sub-router) — IP licensing and royalties
├── storage                  (sub-router) — Firebase Storage, Filecoin Synapse
├── profiles                 (sub-router) — user profiles and discovery
├── entities                 (sub-router) — characters, locations, items (10+ kinds)
├── quests                   (sub-router) — quest system, daily check-ins, affiliates
├── sandbox                  (sub-router) — draft creations
├── collabs                  (sub-router) — cross-universe collaborations
├── universeTeam             (sub-router) — universe team management
├── universeTreasury         (sub-router) — treasury operations
├── governance               (sub-router) — governance queries
├── revenue                  (sub-router) — revenue tracking and splits
├── tokenGates               (sub-router) — token-gated content
├── social                   (sub-router) — social features
├── feed                     (sub-router) — content feed
├── lora                     (sub-router) — LoRA model training
├── talentAgents             (sub-router) — AI talent agent management
├── apiKeys                  (sub-router) — API key management
├── portfolio                (sub-router) — user portfolio
├── media                    (sub-router) — media management
├── moderation               (sub-router) — content moderation
├── admin                    (sub-router) — platform configuration
├── minio                    (sub-router) — Firebase Storage (legacy name)
├── synapse                  (sub-router) — Filecoin/Synapse storage
└── aiPipelines              (sub-router) — AI agent pipeline execution
```

### Services

| Service | File                  | External API          | Purpose                             |
| ------- | --------------------- | --------------------- | ----------------------------------- |
| Fal AI  | `services/fal.ts`     | fal.ai                | Image and video generation          |
| Gemini  | `services/gemini.ts`  | Google Gemini 2.5 Pro | Wiki generation from video analysis |
| MinIO\* | `services/minio.ts`   | Firebase Storage      | File upload/download                |
| Synapse | `services/synapse.ts` | Filecoin/Synapse      | Decentralized video storage         |
| Wikia   | `services/wikia.ts`   | OpenAI                | Storyline generation                |

_Note: `minio.ts` uses Firebase Storage (migrated from MinIO, filename preserved)._

## Web Architecture

**Entry point:** `apps/web/src/main.tsx`

| Layer         | Technology               | Purpose                                 |
| ------------- | ------------------------ | --------------------------------------- |
| Bundler       | Vite                     | Dev server (port 3001), build           |
| Routing       | TanStack Router          | File-based routing (`src/routes/`)      |
| Data Fetching | TanStack Query + tRPC    | Server state management                 |
| Web3          | wagmi + thirdweb         | Wallet connection, contract interaction |
| Auth          | thirdweb + SIWE          | Wallet-based authentication             |
| UI            | Tailwind CSS + shadcn/ui | Component library                       |
| Flow Editor   | ReactFlow                | Narrative node visualization            |

### Route Map

| Route                        | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `/`                          | Home / landing page                                  |
| `/login`                     | Authentication (wallet connect)                      |
| `/dashboard`                 | User dashboard (universes, AI gen, LP yield, quests) |
| `/market`                    | Token marketplace                                    |
| `/create`                    | Create hub (universe, entities)                      |
| `/create/$kind`              | Per-kind creation form                               |
| `/cinematicUniverseCreate`   | Full universe creation wizard                        |
| `/universe/$id`              | Universe detail view                                 |
| `/universe/$id/deploy-token` | Deploy token for existing universe                   |
| `/universe/$id/gen-config`   | AI generation configuration                          |
| `/universe/$id/gallery`      | Universe gallery                                     |
| `/governance/$universeId`    | Governance voting (proposals, timelock)              |
| `/treasury/$universeId`      | Treasury management                                  |
| `/play/$universeId`          | Narrative gameplay                                   |
| `/wiki`                      | Worldbuilding encyclopedia                           |
| `/wiki/entity/$id`           | Entity detail page                                   |
| `/wiki/character/$id`        | Character detail page                                |
| `/tokens/`                   | Token dashboard                                      |
| `/tokens/$address`           | Token details                                        |
| `/tokens/portfolio`          | Token portfolio                                      |
| `/staking`                   | $LOAR staking                                        |
| `/credits`                   | Credit balance and purchase                          |
| `/sell/`                     | Content selling hub                                  |
| `/licensing/`                | IP licensing hub                                     |
| `/collabs/`                  | Collaboration hub                                    |
| `/ads/`                      | Ad management                                        |
| `/canon/$universeId`         | Canon marketplace                                    |
| `/bounties/`                 | Bounty hub                                           |
| `/agents/`                   | AI agent marketplace                                 |
| `/profile/$username`         | User profiles                                        |
| `/admin/moderation`          | Content moderation queue                             |
| `/dmca`                      | DMCA takedown form                                   |
| `/event.$universe.$event`    | Event detail within universe                         |

### Environment Variable Loading

The web app reads env vars from the root `.env` file via Vite's `envDir` config in `vite.config.ts`. Only variables prefixed with `VITE_` are exposed to the browser.

## Indexer Architecture

**Framework:** [Ponder v0.15](https://ponder.sh/)

The indexer watches Sepolia blockchain events and builds a queryable GraphQL API.

### Factory Pattern

The indexer uses Ponder's factory pattern:

1. **UniverseManager** is the root contract (fixed address)
2. When `UniverseCreated` fires, Ponder dynamically tracks the new **Universe** contract
3. When `TokenCreated` fires, Ponder tracks the new **GovernanceERC20** and **UniverseGovernor** contracts

### Indexed Data

- **Universes** — Creator, name, description, image, token/governor addresses
- **Nodes** — Narrative nodes forming a tree (previousNodeId links)
- **Tokens** — ERC20 governance tokens, transfers, holders, balances
- **Pools** — Uniswap v4 pools, swaps
- **Proposals** — Governance proposals, votes, executions, cancellations

### GraphQL API

Available at `http://localhost:42069/graphql` during development. See [docs/api.md](api.md) for query examples.
