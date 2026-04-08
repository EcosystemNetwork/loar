# LOAR: Decentralized Narrative Control Suite

<div align="center">

![LOAR Banner](https://fungerbil.com/LOARLOGO.png)

### _Create AI-powered cinematic universes. Own them on-chain. Monetize them._

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![pnpm 9.15.0](https://img.shields.io/badge/pnpm-9.15.0-orange)](https://pnpm.io/)
[![Node 18+](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Sepolia Testnet](https://img.shields.io/badge/Network-Sepolia-blue)](https://sepolia.etherscan.io/)
[![Base Sepolia](https://img.shields.io/badge/Network-Base%20Sepolia-blue)](https://sepolia.basescan.org/)

</div>

---

## What is LOAR?

LOAR is a platform where creators deploy cinematic universes as smart contracts, generate AI video/image content, build branching narratives, and set up multiple revenue streams — all governed by token holders.

**One-liner:** "YouTube meets DAO meets AI studio" — creators own the IP, communities govern the canon, tokens capture the value.

**Live testnet demo:** [loar.fun](https://loar.fun) (Sepolia)

---

## Honest Feature Status

We classify every feature by what actually works end-to-end today, not what has backend code or UI shells.

### LIVE (Working end-to-end)

| Feature                        | What Works Today                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| **Wallet Auth (SIWE)**         | CDP Embedded Wallet (Google/Apple/passkeys/email) → SIWE signature → JWT. Full social login, no seed phrase required |
| **Universe Creation**          | Two-step wizard: deploy Universe contract + governance token + Uniswap v4 pool                                       |
| **Narrative Timeline Editor**  | ReactFlow-based visual story builder. Create, link, and branch narrative nodes                                       |
| **AI Video Generation**        | 4 providers (Veo3, Kling, Wan2.5, Sora) via FAL AI. 1-60s duration, configurable                                     |
| **AI Image Generation**        | 4 models (Nano Banana, Flux/dev, Flux-pro, Flux/schnell) via FAL AI                                                  |
| **Model Routing (Smart Auto)** | Auto-selects best model by quality/speed/cost. Manual override available. 14 models, cost tracked per generation     |
| **Quest & Affiliate System**   | Earn $LOAR tokens for onboarding, engagement, social, and power-user actions. Referral tracking with rewards         |
| **AI Wiki Generation**         | Gemini-powered character analysis, storyline generation, video-to-wiki extraction                                    |
| **On-Chain Node Storage**      | Content hashes + plot hashes stored in Universe contract, indexed by Ponder                                          |
| **Decentralized Storage**      | Multi-provider fallback: Pinata > Lighthouse/Filecoin > Storacha > Firebase                                          |
| **Creator Profiles**           | Username, bio, themes (5 options), social links, privacy controls, public portfolios                                 |
| **Content Upload**             | IP classification (Fan vs Creator-Owned vs Rights-Cleared), copyright declarations, license selection                |
| **Content Discovery**          | Search/filter by classification, media type, tags. Creator gallery + content feed                                    |
| **Character Wiki**             | Browse, search, filter characters by collection/traits. Individual character pages                                   |
| **Blockchain Indexer**         | Ponder v0.15 indexing all contract events into 37+ GraphQL tables                                                    |
| **ETH Purchase Flow**          | Product detail page sends real ETH on-chain to seller via wagmi `sendTransaction` before recording the order         |

### PARTIAL (Backend + contracts exist, frontend not fully wired)

These have working smart contracts deployed on Sepolia AND fully implemented backend APIs (tRPC), but the marketplace frontend is informational UI — it shows stats and explains how things work, without interactive buy/sell/bid transaction flows.

| Feature                   | What Exists                                                                                                                                              | What's Missing                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Episode NFTs**          | Contract: ERC721 + ERC2981 royalties. API: listing + mint recording. UI: product detail + ETH buy button                                                 | No creator mint form. Purchases record in Firestore; on-chain contract not yet deployed                  |
| **Character NFTs**        | Contract: ownership + appearance royalties. API: full CRUD                                                                                               | No frontend mint flow. Marketplace tab is explainer text only                                            |
| **Canon Marketplace**     | Contract: submit/vote/finalize/license. API: all operations. Full submit form + For/Against voting UI                                                    | On-chain finalize/license call not yet wired from frontend                                               |
| **Credit System**         | API: balance, tiers, purchase, spend, history. CreditStore UI with package selection. On-chain ETH + $LOAR payment verification (Sepolia + Base Sepolia) | Card tab has no Stripe integration                                                                       |
| **Subscriptions**         | API: configure tiers, subscribe, check access. 4-tier model                                                                                              | Tab UI exists but no subscribe/payment flow                                                              |
| **Collabs**               | API: propose, accept, activate, record episodes, complete                                                                                                | Tab UI placeholder only                                                                                  |
| **Ad Marketplace**        | Contract: slots, bidding, impressions. API: full CRUD                                                                                                    | Tab UI placeholder only                                                                                  |
| **IP Licensing**          | Contract: 6 license types, royalty tracking. API: full CRUD + merch                                                                                      | Tab UI placeholder only                                                                                  |
| **On-Chain Governance**   | Contract: OpenZeppelin Governor. Ponder indexes proposals/votes                                                                                          | Governance sidebar shows token info, but voting UI is incomplete                                         |
| **Token Trading**         | Uniswap v4 pool created at universe deployment. Fee hooks + LP locking live                                                                              | No swap UI. Users must use Uniswap directly                                                              |
| **Analytics**             | API: views, engagement, trending, platform stats                                                                                                         | Market page queries real stats. No per-universe analytics dashboard                                      |
| **Dashboard**             | AI generation tools + universe list wired to live tRPC API                                                                                               | No per-universe analytics breakdown                                                                      |
| **Rights Classification** | Backend enum updated: `fan` / `original` / `licensed`. Licensed content has `licensingProof` + `reviewStatus`                                            | Frontend still uses old `fun`/`monetized` labels. UI badges not yet migrated                             |
| **Worldbuilding Studio**  | `/create` hub + per-kind forms. Wiki at `/wiki` with tabbed entity browsing + detail pages (`/wiki/entity/$id`)                                          | No `/wiki/$kind` filter routes                                                                           |
| **Content Moderation**    | Flag system, admin review queue, DMCA intake (`/dmca`), immutable audit log. `contentStatus` gates commercial transactions                               | Admin UI at `/admin/moderation`. No auto-flag threshold, no counter-notice workflow (manual review only) |
| **Mobile App**            | Expo 52 / React Native (iOS + Android). Portfolio, tokens, earnings, collections, profile tabs. CDP wallet auth                                          | Beta — not yet published to App Store / Play Store                                                       |

### PLANNED (Not implemented)

| Feature                | Notes                                                                      |
| ---------------------- | -------------------------------------------------------------------------- |
| **Mainnet Deployment** | All contracts on Sepolia + Base Sepolia testnets. Needs audit first        |
| **Fiat On-Ramp**       | No credit card payments. Card tab in CreditStore has no Stripe integration |
| **Social Features**    | No follows, comments, activity feed, or notifications                      |
| **Merch Fulfillment**  | Backend shell exists. No fulfillment partner, no real orders               |
| **Creator Analytics**  | No per-universe P&L, subscriber funnels, or retention data                 |

---

## Architecture

```
                 ┌─────────────────────────────────────────────────┐
                 │                    Frontend                      │
                 │  React 18 + Vite + TanStack Router + wagmi      │
                 │  Port 3001                                       │
                 └──────────┬──────────────────┬───────────────────┘
                            │ tRPC              │ wagmi
                            ▼                   ▼
              ┌─────────────────────┐  ┌──────────────────────┐
              │   API Server        │  │  Sepolia + Base      │
              │   Hono + tRPC       │  │  Sepolia Contracts   │
              │   25+ routers       │  │  8 core + per-       │
              │   150+ procedures   │  │  universe children   │
              │   Port 3000         │  └──────────┬───────────┘
              │   Port 3000         │             │ events
              └──────────┬──────────┘             ▼
                         │               ┌──────────────────┐
                         ▼               │  Ponder Indexer   │
              ┌──────────────────┐       │  37+ tables       │
              │  Firestore       │       │  GraphQL API      │
              │  (user data,     │       │  Port 42069       │
              │   content meta,  │       └──────────────────┘
              │   analytics)     │
              └──────────────────┘
```

| App              | Stack                                                    | Description                               |
| ---------------- | -------------------------------------------------------- | ----------------------------------------- |
| `apps/web`       | React 18, Vite, TanStack Router/Query, wagmi, RainbowKit | Frontend SPA                              |
| `apps/server`    | Hono, tRPC, Firebase Admin (Firestore)                   | API server (25+ routers, 150+ procedures) |
| `apps/indexer`   | Ponder v0.15, GraphQL                                    | Blockchain event indexer (37+ tables)     |
| `apps/contracts` | Foundry, Solidity ^0.8.30                                | Smart contracts (Sepolia + Base Sepolia)  |
| `apps/mobile`    | Expo 52, React Native, NativeWind                        | iOS + Android app (CDP wallet auth)       |
| `packages/abis`  | Auto-generated wagmi hooks                               | Shared contract bindings                  |

### Key Flows

**Auth:** CDP Embedded Wallet (Google/Apple/passkeys/email) > SIWE Signature > Server JWT > Bearer Token > protectedProcedure

**Content Creation:** AI Generate > Decentralized Storage (SHA-256 dedup) > On-Chain Hash > Ponder Index

**Universe Deployment:** UniverseManager.createUniverse() > Deploy GovernanceERC20 + Governor > Initialize Uniswap v4 Pool > Lock LP

---

## Smart Contracts (Sepolia + Base Sepolia)

| Contract                  | Address         | Purpose                             |
| ------------------------- | --------------- | ----------------------------------- |
| **UniverseManager**       | `0x7af1...8114` | Factory: deploys universes + tokens |
| **UniverseTokenDeployer** | `0xE34D...8d8B` | Token + Governor + pool deployment  |
| **LoarFeeLocker**         | `0xEB2B...38f`  | Fee escrow and creator payouts      |
| **LoarLpLockerMultiple**  | `0x3E66...ca6`  | LP token locking (anti-rug)         |
| **LoarHookStaticFee**     | `0xa664...A8cC` | Uniswap v4 fee collection hook      |

Plus per-universe: Universe, GovernanceERC20, UniverseGovernor contracts.

Revenue contracts (not yet deployed separately — logic in backend + planned for on-chain):
EpisodeNFT, CharacterNFT, CanonMarketplace, CreditManager, SubscriptionManager, CollabManager, AdPlacement, LicensingRegistry

---

## How to Run Locally

### Prerequisites

| Tool              | Required | Notes                                  |
| ----------------- | -------- | -------------------------------------- |
| **Node.js** >= 18 | Yes      | [nodejs.org](https://nodejs.org/)      |
| **pnpm** 9.15.0   | Yes      | Auto-installed via `corepack`          |
| **Foundry**       | Optional | For smart contract dev                 |
| **Docker**        | Optional | Only for production-like local testing |

### Quick Start

```bash
git clone <repo-url>
cd loar
bash setup.sh          # checks prereqs, copies .env.example → .env, installs deps
# Edit .env — at minimum set SIWE_JWT_SECRET and FIREBASE_SERVICE_ACCOUNT
pnpm dev               # starts web (3001) + server (3000) + indexer (42069)
```

### Environment

All apps read from a single `.env` at the repo root. Copy `.env.example` and fill in values.

**Required for server:**

- `SIWE_JWT_SECRET` — JWT signing (`openssl rand -hex 32`)
- `FIREBASE_SERVICE_ACCOUNT` — Firestore access (JSON string or file path)

**Required for indexer:**

- `PONDER_RPC_URL_2` — Sepolia RPC endpoint

**Optional (server starts without these):**

- `FAL_KEY` — AI generation
- `GOOGLE_API_KEY` — Gemini wiki generation
- `OPENAI_API_KEY` — GPT-4o-mini storyline generation

See [docs/environment.md](docs/environment.md) for the full reference.

### Individual Services

```bash
pnpm dev:web           # web only (port 3001)
pnpm dev:server        # server only (port 3000)
pnpm -F indexer dev    # indexer only (port 42069)
```

---

## How to Deploy

### Architecture

```
                    ┌─────────────────┐
                    │   Vercel (CDN)   │  ← apps/web (static SPA)
                    │    loar.fun      │
                    └────────┬────────┘
                             │ HTTPS
        ┌────────────────────┼────────────────────┐
        │                    │                     │
┌───────▼────────┐   ┌──────▼───────┐   ┌────────▼────────┐
│  loar-server   │   │ loar-indexer │   │    Firebase      │
│  Railway :3000 │   │ Railway:42069│   │    Firestore     │
│  Hono + tRPC   │   │ Ponder v0.15 │   │   (data store)   │
└───────┬────────┘   └──────┬───────┘   └─────────────────┘
        │                    │
  Storage providers   Sepolia / Base RPC
```

| Service              | Deployed To             | Trigger                                 |
| -------------------- | ----------------------- | --------------------------------------- |
| **Web**              | Vercel                  | Push to `main` (Vercel Git integration) |
| **Server + Indexer** | Railway or VPS (Docker) | Push to `main`                          |
| **Mobile**           | Expo (iOS + Android)    | `eas build` / `eas submit`              |

### Web → Vercel

1. Connect the repo to Vercel
2. Set env vars in Vercel dashboard: `VITE_SERVER_URL`, `VITE_PONDER_URL`
3. Build config is in `vercel.json` — SPA rewrites included

### Server + Indexer → Railway (recommended)

1. Create a Railway project and connect your GitHub repo
2. Add two services from the same repo:
   - **loar-server** — root directory: `apps/server` (picks up `railway.toml`)
   - **loar-indexer** — root directory: `apps/indexer` (picks up `railway.toml`)
3. Set env vars in each service's Railway dashboard (see [deployment docs](docs/deployment.md))
4. Add custom domains: `api.loar.fun` → server, `idx.loar.fun` → indexer
5. Update Vercel env vars: `VITE_SERVER_URL` and `VITE_PONDER_URL` to your Railway URLs

### Server + Indexer → VPS (Docker, alternative)

```bash
# On the VPS:
git clone <repo-url> && cd loar
cp .env.example .env   # fill in production values (CORS_ORIGIN = your Vercel URL)
docker compose build
docker compose up -d
```

**CI/CD:** `deploy.yml` SSHs to VPS on push to `main` and runs `docker compose build && up -d`.
Required GitHub secrets: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY`, `WORK_DIR`.

### Health Checks

| Service | Endpoint      | Response                                        |
| ------- | ------------- | ----------------------------------------------- |
| Server  | `GET /health` | `{ status, checks: { firebase }, uptime, env }` |
| Indexer | `GET /health` | Ponder built-in                                 |

---

## Documentation

| Document                                     | Description                                          |
| -------------------------------------------- | ---------------------------------------------------- |
| [MVP Scope](docs/mvp.md)                     | What's in the MVP, what's deferred, success criteria |
| [Roadmap](docs/roadmap.md)                   | 3 milestones with concrete deliverables              |
| [Creator Journey](docs/creator-journey.md)   | Step-by-step from wallet connect to revenue          |
| [IP & Content Policy](docs/ip-policy.md)     | Copyright rules, licensing, compliance               |
| [Monetization Map](docs/monetization-map.md) | How money flows, who pays, what's owned              |
| [Product Loops](docs/product-loops.md)       | Core loops with status assessment                    |
| [Architecture](docs/architecture.md)         | System design, auth flow, service connections        |
| [Environment](docs/environment.md)           | All env vars, Firebase setup guide                   |
| [API Reference](docs/api.md)                 | REST + tRPC + GraphQL endpoints                      |
| [Smart Contracts](docs/contracts.md)         | Contract guide, ABI generation                       |
| [Database](docs/database.md)                 | Firestore + Ponder schema reference                  |
| [Deployment](docs/deployment.md)             | Docker, CI/CD, manual deploy                         |

---

## Project Structure

```
loar/
├── apps/
│   ├── web/             # React 18 SPA (Vite + TanStack Router)
│   ├── server/          # Hono + tRPC API (25+ routers, 150+ procedures)
│   ├── indexer/         # Ponder v0.15 blockchain indexer (37+ tables)
│   ├── mobile/          # Expo 52 / React Native (iOS + Android)
│   └── contracts/       # Foundry/Solidity (8 core contracts, Sepolia + Base Sepolia)
├── packages/
│   └── abis/            # Generated wagmi hooks + contract ABIs
├── docs/                # Product + technical documentation
├── .env.example         # Environment variable template
├── setup.sh             # First-time setup script
├── Makefile             # Command shortcuts
└── turbo.json           # Turbo build config
```

## Common Commands

| Command           | Description                                 |
| ----------------- | ------------------------------------------- |
| `make dev`        | Start all services (web + server + indexer) |
| `make dev-web`    | Start web app only (port 3001)              |
| `make dev-server` | Start server only (port 3000)               |
| `make build`      | Build all apps                              |
| `make test`       | Run smart contract tests                    |
| `make codegen`    | Generate wagmi hooks from ABIs              |

## License

MIT
