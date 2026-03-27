# LOAR: Decentralized Narrative Control Suite

<div align="center">

![LOAR Banner](https://fungerbil.com/LOARLOGO.png)

### _AI-Powered Cinematic Universes with On-Chain Governance and Creator Monetization_

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![pnpm 9.15.0](https://img.shields.io/badge/pnpm-9.15.0-orange)](https://pnpm.io/)
[![Node 18+](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Sepolia Testnet](https://img.shields.io/badge/Network-Sepolia-blue)](https://sepolia.etherscan.io/)

</div>

## What is LOAR?

LOAR is a platform where creators build cinematic universes using AI video generation, govern them through on-chain voting, and monetize them through 10+ revenue streams — NFTs, subscriptions, licensing, ads, credits, and token trading.

Think **Naver Webtoons × TikTok × Web3**: communities consume AI-generated episodes, produce new storylines with accessible tooling, debate canon through governance, and speculate on universe tokens via Uniswap v4.

**Live at:** [loartech.xyz](https://loartech.xyz) (Sepolia testnet)

---

## Feature Status

### Shipped

| Feature                    | Description                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Universe Creation**      | Deploy a cinematic universe + governance token in a two-step wizard                                             |
| **Narrative Timeline**     | ReactFlow-based branching story editor with node linking and canonization                                       |
| **AI Video Generation**    | FAL AI integration (Veo3, Kling, Wan2.5, Sora) with 1–60s duration, multiple aspect ratios                      |
| **AI Image Generation**    | 4 FAL models (nano-banana, flux/dev, flux-pro, flux/schnell)                                                    |
| **AI Wiki Generation**     | Gemini-powered character profiles, storyline generation, video-to-wiki extraction                               |
| **On-Chain Governance**    | OpenZeppelin Governor — proposals, voting, execution via governance tokens                                      |
| **SIWE Authentication**    | Wallet login → Sign-In with Ethereum → JWT session tokens                                                       |
| **Decentralized Storage**  | Multi-provider (Walrus, IPFS/Pinata, Filecoin/Synapse, Firebase) with SHA-256 dedup and priority-based fallback |
| **NFT Marketplace**        | Episode and character NFT minting, listing, royalty tracking                                                    |
| **Canon Submissions**      | Community-submitted characters, plot arcs, locations, lore — with token-weighted voting                         |
| **Credit System**          | Purchase credits, spend on AI generation (image=1, video=5, story=2, spinoff=10, character=3, scene=8)          |
| **Subscriptions**          | Creator-configurable tiers (Free/Basic/Premium/VIP) with feature gating                                         |
| **Cross-Universe Collabs** | Proposals, acceptance, activation with revenue sharing                                                          |
| **IP Licensing**           | Streaming, merch, gaming, comic, audio licenses with royalty tracking                                           |
| **Programmatic Ads**       | Ad slot creation, bidding, acceptance, impression tracking                                                      |
| **Creator Profiles**       | Public portfolios with 5 themes, privacy controls, layout customization                                         |
| **Content Upload**         | IP classification (fun vs monetized), copyright declarations, license selection                                 |
| **Discovery**              | Creator and content search with classification and media type filters                                           |
| **Analytics**              | View/engagement tracking, trending computation, platform-wide stats                                             |
| **Blockchain Indexer**     | Ponder v0.15 indexing 14+ on-chain tables via GraphQL                                                           |
| **Uniswap v4 Integration** | Custom fee hooks, LP locking, token pool creation                                                               |

### Partial / In Progress

| Feature                 | Status                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| **Dashboard**           | Functional but uses placeholder universe data alongside live data   |
| **Merch Tab**           | UI shell exists in marketplace; backend routing present but minimal |
| **Coinbase CDP Wallet** | Referenced in code but `@coinbase/cdp-react` not yet installed      |

### Planned

| Feature                 | Target                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| **Mainnet Deployment**  | Contracts currently on Sepolia testnet only                               |
| **Bundle Optimization** | Large chunks (MetaMask SDK ~558KB, viem/wagmi ~1.8MB) need code splitting |
| **Fiat On-Ramp**        | Credit card purchases for credits and subscriptions                       |
| **Mobile App**          | Native mobile experience                                                  |

---

## Architecture

| App              | Stack                                                    | Port  | Description              |
| ---------------- | -------------------------------------------------------- | ----- | ------------------------ |
| `apps/web`       | React 18, Vite, TanStack Router/Query, wagmi, RainbowKit | 3001  | Frontend SPA             |
| `apps/server`    | Hono, tRPC, Firebase Admin (Firestore only)              | 3000  | API server               |
| `apps/indexer`   | Ponder v0.15, GraphQL (Sepolia)                          | 42069 | Blockchain indexer       |
| `apps/contracts` | Foundry, Solidity ^0.8.30                                | —     | Smart contracts          |
| `packages/abis`  | Auto-generated wagmi hooks                               | —     | Shared contract bindings |

### Auth Flow

```
Wallet Connect → SIWE Signature → Server JWT → Bearer Token → protectedProcedure
```

### Storage Flow

```
Upload → SHA-256 Hash → Dedup Check → Primary Provider → Manifest → Background Redundancy
```

Priority: Walrus → IPFS (Pinata) → Filecoin (Synapse) → Firebase (fallback)

---

## Quick Start

```bash
git clone <repo-url>
cd loar
bash setup.sh    # checks prereqs, copies .env.example → .env, installs deps
pnpm dev         # starts web + server + indexer
```

### Prerequisites

| Tool                 | Required | Notes                                                                                      |
| -------------------- | -------- | ------------------------------------------------------------------------------------------ |
| **Node.js** >= 18    | Yes      | [nodejs.org](https://nodejs.org/)                                                          |
| **pnpm** 9.15.0      | Yes      | Auto-installed via `corepack`                                                              |
| **Foundry**          | Optional | For smart contract dev. [Install](https://book.getfoundry.sh/getting-started/installation) |
| **Firebase project** | Yes      | Firestore for data storage                                                                 |

### Environment

All apps read from a single `.env` at the repo root. At minimum you need:

- `FIREBASE_SERVICE_ACCOUNT` — Firestore access
- `SIWE_JWT_SECRET` — JWT signing for wallet auth
- `FAL_KEY` — AI generation
- `PONDER_RPC_URL_2` — Sepolia RPC for indexer

See [docs/environment.md](docs/environment.md) for the full reference.

---

## Smart Contracts (Sepolia)

| Contract                  | Purpose                                                    |
| ------------------------- | ---------------------------------------------------------- |
| **UniverseManager**       | Factory for deploying universes + governance tokens        |
| **Universe**              | Narrative node graph — create, link, canonize story events |
| **GovernanceERC20**       | Voting-power tokens for universe governance                |
| **UniverseGovernor**      | On-chain proposals, voting, execution                      |
| **UniverseTokenDeployer** | Token + Governor + Uniswap pool deployment                 |
| **LoarHookStaticFee**     | Uniswap v4 fee collection hook                             |
| **LoarFeeLocker**         | Fee escrow and creator payouts                             |
| **LoarLpLockerMultiple**  | LP token locking (anti-rug)                                |

See [docs/contracts.md](docs/contracts.md) for development and deployment.

---

## Monetization Stack

LOAR has **10 revenue streams** implemented across the marketplace:

| Stream             | How It Works                                                  | Status  |
| ------------------ | ------------------------------------------------------------- | ------- |
| **Episode NFTs**   | Mint narrative events as NFTs with royalties                  | Shipped |
| **Character NFTs** | Mint AI-generated characters as tradeable assets              | Shipped |
| **Canon Market**   | Submit + vote on story contributions; license winning entries | Shipped |
| **Credits**        | Platform currency for AI generation (tiered pricing)          | Shipped |
| **Subscriptions**  | Creator-set tiers with gated features                         | Shipped |
| **Collabs**        | Cross-universe partnerships with revenue sharing              | Shipped |
| **IP Licensing**   | License universes for streaming, gaming, merch, etc.          | Shipped |
| **Ads**            | Programmatic ad slots with bidding                            | Shipped |
| **Token Trading**  | Universe tokens on Uniswap v4 with fee hooks                  | Shipped |
| **Merch**          | Merchandise orders linked to universes                        | Shell   |

---

## Server API

12 tRPC routers with 60+ procedures:

| Router               | Procedures                                                                 | Auth                |
| -------------------- | -------------------------------------------------------------------------- | ------------------- |
| `cinematicUniverses` | create, get, getAll, getByCreator                                          | Public + wallet sig |
| `fal`                | generateImage, generateVideo, editImage, analyzeCharacter, createCharacter | Protected           |
| `storage`            | upload, uploadDirect, resolve, uploadAsync, uploadStatus                   | Protected           |
| `profiles`           | me, upsert, discover, checkUsername, setVisibility                         | Mixed               |
| `content`            | create, update, delete, getFeed, getByCreator                              | Mixed               |
| `nft`                | createEpisodeListing, recordMint, createCharacterListing                   | Protected           |
| `marketplace`        | submit, vote, licenseSubmission, recordRoyalty                             | Protected           |
| `credits`            | getBalance, getTiers, purchase, spend, refund                              | Protected           |
| `subscriptions`      | configureTier, getTiers, subscribe, checkAccess                            | Mixed               |
| `collabs`            | propose, accept, activate, recordEpisode, getActive                        | Protected           |
| `licensing`          | createLicense, activateLicense, recordRoyalty                              | Protected           |
| `analytics`          | recordView, recordEngagement, getUniverseMetrics, getTrending              | Mixed               |
| `ads`                | createSlot, placeBid, acceptBid, recordImpression                          | Protected           |
| `wiki`               | characters, generateEventWikia, generateStoryline, generateFromVideo       | Mixed               |

---

## Documentation

| Document                                        | Description                                            |
| ----------------------------------------------- | ------------------------------------------------------ |
| [MVP Scope](docs/mvp.md)                        | What's in the MVP, what's deferred                     |
| [Roadmap](docs/roadmap.md)                      | Phase-by-phase delivery plan                           |
| [Creator Journey](docs/creator-journey.md)      | End-to-end flow from universe creation to monetization |
| [IP & Content Policy](docs/ip-policy.md)        | Copyright rules, licensing, compliance                 |
| [Analytics & Cost Spec](docs/analytics-spec.md) | KPIs, unit economics, cost model                       |
| [Architecture](docs/architecture.md)            | System design, auth flow, service connections          |
| [Environment](docs/environment.md)              | All env vars, Firebase setup guide                     |
| [API Reference](docs/api.md)                    | REST + tRPC + GraphQL endpoints                        |
| [Smart Contracts](docs/contracts.md)            | Contract guide, ABI generation                         |
| [Database](docs/database.md)                    | Firestore + Ponder schema reference                    |
| [Deployment](docs/deployment.md)                | Docker, CI/CD, manual deploy                           |
| [Troubleshooting](docs/troubleshooting.md)      | Common errors and fixes                                |

---

## Project Structure

```
loar/
├── apps/
│   ├── web/             # React 18 SPA (Vite + TanStack Router)
│   ├── server/          # Hono + tRPC API (12 routers, 60+ procedures)
│   ├── indexer/         # Ponder v0.15 blockchain indexer (14+ tables)
│   └── contracts/       # Foundry/Solidity (8 contracts on Sepolia)
├── packages/
│   └── abis/            # Generated wagmi hooks + contract ABIs
├── docs/                # Architecture, API, product docs
├── .env.example         # Environment variable template
├── setup.sh             # First-time setup script
├── Makefile             # Command shortcuts (make help)
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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
