# LOAR: Narrative Control Suite

<div align="center">

![LOAR Banner](apps/web/public/loarIconTextLogo.png)

### _Create AI-powered cinematic universes. Own them on-chain. Monetize them._

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![pnpm 9.15.0](https://img.shields.io/badge/pnpm-9.15.0-orange)](https://pnpm.io/)
[![Node 18+](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Sepolia + Base Sepolia](https://img.shields.io/badge/Network-Sepolia%20%2B%20Base%20Sepolia-blue)](https://sepolia.etherscan.io/)
[![Base L2](https://img.shields.io/badge/Target-Base%20L2-0052FF)](https://basescan.org/)

</div>

> **Last updated:** April 19, 2026 | **Status:** Testnet Alpha (Sepolia + Base Sepolia)

---

## What is LOAR?

LOAR is a platform where creators deploy cinematic universes as smart contracts, generate AI video/image content, build branching narratives, and set up multiple revenue streams — all governed by token holders.

**One-liner:** "YouTube meets DAO meets AI studio" — creators own the IP, communities govern the canon, tokens capture the value.

**Live testnet demo:** [loar.fun](https://loar.fun) (Sepolia + Base Sepolia)

### Hybrid Architecture — What's On-Chain vs Off-Chain

LOAR uses a **hybrid architecture** by design. Here's what lives where and why:

| Layer                                      | Where                                 | Why                                                               |
| ------------------------------------------ | ------------------------------------- | ----------------------------------------------------------------- |
| **Universe ownership, governance, tokens** | On-chain (EVM)                        | Immutable ownership, trustless governance, permissionless trading |
| **NFTs, royalties, payments, licensing**   | On-chain (EVM)                        | Enforceable revenue splits, transparent fee flows                 |
| **Content bytes (video, images, audio)**   | Pinata (IPFS) + Lighthouse (Filecoin) | Content-addressed, redundant, accessible via gateway              |
| **Content hashes**                         | On-chain (Universe contract)          | Proof of existence, tamper detection                              |
| **User profiles, analytics, moderation**   | Firestore (cloud)                     | Fast reads, complex queries, mutable by design                    |
| **AI generation orchestration**            | Cloud server (Hono/tRPC)              | API key management, model routing, rate limiting                  |

**What this means in practice:**

- If LOAR the platform disappears, your universe contracts, tokens, and NFTs continue to exist on-chain. Content is retrievable via IPFS/Filecoin CIDs.
- The discovery layer (wiki, search, analytics, moderation) is centralized and would need to be rebuilt or replaced by the community.
- We chose this tradeoff intentionally: fully on-chain content storage is cost-prohibitive for video, and centralized metadata enables the UX creators need (search, moderation, real-time collaboration).
- The long-term goal is progressive decentralization — universe content is editable and lives in the cloud until creators commit it on-chain, at which point it becomes permanent and verifiable.

---

## Honest Feature Status

We classify every feature by what actually works end-to-end today, not what has backend code or UI shells.

### LIVE (Working end-to-end)

| Feature                             | What Works Today                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Wallet Auth (SIWE)**              | thirdweb wallet connection (EVM) → SIWE signature → JWT. Connect any Ethereum wallet, no seed phrase required                                                                                                                                                                                                                   |
| **Universe Creation**               | Atomic single-tx `createUniverseWithToken()` or two-step: Universe contract → token + Uniswap v4 pool. Supports multi-chain (Sepolia, Base Sepolia, Base Mainnet) with chain selector UI                                                                                                                                        |
| **Token Deployment**                | Deploy governance token for existing universes via `/universe/$id/deploy-token`. Custom token symbol, configurable allocation splits (LP/creator/treasury/community), multi-recipient LP fee distribution                                                                                                                       |
| **LP Yield & Fee Management**       | On-chain fee collection from Uniswap v4 pools, multi-recipient BPS splits, claim UI in dashboard via `LPYieldManager` component. Anyone can trigger fee harvest; recipients claim their share                                                                                                                                   |
| **Narrative Timeline Editor**       | ReactFlow-based visual story builder with MiniMap, node search (Ctrl+K), undo/redo (Ctrl+Z), auto-layout, keyboard shortcuts, fullscreen mode, edge labels (Canon/Branch), and zoom controls. Tree layout positions nodes by depth and subtree size                                                                             |
| **AI Video Generation**             | 10+ providers (Veo 3.1, Kling 3.0, Wan 2.7, Sora 2, Seedance 2.0, LTX, HunYuan, CogVideoX, PixVerse V6, Runway Gen-3) via FAL AI + ModelArk. 44 model variants, 1-60s duration                                                                                                                                                  |
| **AI Image Generation**             | 21 models (FLUX Schnell/Dev/Pro/2 Pro/Kontext, Nano Banana/2/Pro, Recraft V4, Ideogram V3, Seedream 5.0, GPT Image, and more) via FAL AI                                                                                                                                                                                        |
| **Model Routing (Smart Auto)**      | Auto-selects best model by quality/speed/cost. Manual override available. 65 models (44 video + 21 image), cost tracked per generation                                                                                                                                                                                          |
| **Quest & Affiliate System**        | Earn $LOAR tokens for onboarding, engagement, social, and power-user actions. Referral tracking with rewards                                                                                                                                                                                                                    |
| **AI Wiki Generation**              | Gemini-powered character analysis, storyline generation, video-to-wiki extraction                                                                                                                                                                                                                                               |
| **On-Chain Node Storage**           | Content hashes + plot hashes stored in Universe contract, indexed by Ponder                                                                                                                                                                                                                                                     |
| **Decentralized Storage**           | Multi-provider fallback: Pinata > Lighthouse/Filecoin > Firebase                                                                                                                                                                                                                                                                |
| **Credit System (On-Chain)**        | ETH + $LOAR payment on-chain (Sepolia + Base Sepolia). Dual-margin pricing (35% card/ETH, 25% LOAR). CreditStore UI with package selection. Stripe card payments when `STRIPE_SECRET_KEY` is set                                                                                                                                |
| **Creator Profiles**                | Username, bio, themes (5 options), social links, privacy controls, public portfolios                                                                                                                                                                                                                                            |
| **Content Upload**                  | IP classification (Fan vs Creator-Owned vs Rights-Cleared), copyright declarations, license selection                                                                                                                                                                                                                           |
| **Content Discovery**               | Search/filter by classification, media type, tags. Creator gallery + content feed                                                                                                                                                                                                                                               |
| **Character Wiki**                  | Browse, search, filter characters by collection/traits. Individual character pages                                                                                                                                                                                                                                              |
| **Blockchain Indexer**              | Ponder v0.15 indexing all contract events into 29 GraphQL tables                                                                                                                                                                                                                                                                |
| **ETH Purchase Flow**               | Product detail page sends real ETH on-chain to seller via wagmi `sendTransaction` before recording the order                                                                                                                                                                                                                    |
| **Identity NFTs**                   | Minted by UniverseManager per universe creator. Tracks co-creators and multi-sig signers                                                                                                                                                                                                                                        |
| **TimelockController Governance**   | `UniverseTimelockGovernor` with 24-hour execution delay for major proposals. Per-universe Governor with configurable voting delay/period/quorum                                                                                                                                                                                 |
| **Multi-Sig Support**               | Gnosis Safe addresses as universe owners for shared team governance                                                                                                                                                                                                                                                             |
| **AI Audio Generation**             | Music generation, voice TTS, voice cloning (ElevenLabs), sound effects, lip-sync video generation                                                                                                                                                                                                                               |
| **AI 3D Asset Generation**          | Text-to-3D and image-to-3D via Meshy                                                                                                                                                                                                                                                                                            |
| **Scene Controls**                  | Per-node camera presets (16 types), style presets (12 types), VFX overlays (14 types), cast member assignment, motion brush masking, keyframe handoff between nodes                                                                                                                                                             |
| **Image-to-Video & Talking Scenes** | `talkingScene.create` combo endpoint (image → motion → lipsync/TTS), motion presets, Animate + Talking tabs in the editor, generation lineage refs (`parentGenerationId`, `sourceImageUrl`) so derived clips link back to their source                                                                                          |
| **Cast Management**                 | Universe-wide cast member registry with reference images for character consistency across scenes                                                                                                                                                                                                                                |
| **Worldbuilding Studio**            | `/create` hub with per-kind forms (person, place, thing, faction, event, lore, species, vehicle, technology, organization). Tabbed wiki encyclopedia at `/wiki`                                                                                                                                                                 |
| **Social Features**                 | Follow/unfollow, activity feed (Following + Global tabs), notification center, like system, threaded comments on episodes/universes/content, token-gated discussions                                                                                                                                                            |
| **AI Agent System**                 | AI agent creation with budget allocation, multi-step pipelines, API key management, MCP server with 25 tools for external AI agents                                                                                                                                                                                             |
| **Private Creator's Room**          | Per-universe private workspace: plot notes, lore vault, draft workspace. Token-gated access                                                                                                                                                                                                                                     |
| **Narrative Player**                | Interactive branching narrative playback with choice overlays, player controls, and branch stats                                                                                                                                                                                                                                |
| **Error Toast Notifications**       | Real-time toast feedback on all mutation successes and failures via Sonner                                                                                                                                                                                                                                                      |
| **VLM Subsystem**                   | Gemini 2.5 Pro extraction: scenes, entities, canon conflicts, moderation risk, prompt coaching, style-bible, recap/trailer, grounded governance drafts. Multimodal search over `sceneIndex`. See [docs/prd-vlm-subsystem.md](docs/prd-vlm-subsystem.md)                                                                         |
| **Cost Tracker (Admin)**            | Per-provider USD cost attribution, gross-margin gauges, daily platform cap, top movers, cost-vs-revenue by model, CSV export. Alert sweep Slacks margin/cap breaches. Dashboard at `/admin/cost`                                                                                                                                |
| **Advanced Creator Analytics**      | Wallet-based conversion funnel (viewed → engaged → minted) with 30/90/180-day windows, weekly cohort retention matrix with 4/6/8-week windows. Creator-gated via `analytics.getFunnel` + `analytics.getCohorts`. Surfaced on `/analytics/$universeId`                                                                           |
| **ERC-4337 Paymaster**              | Gas sponsorship for mint/vote/universe-create via thirdweb, Pimlico, or Biconomy. Frontend falls back to user-paid gas when sponsorship is unavailable                                                                                                                                                                          |
| **CSAM Fingerprinting**             | Every image publish scanned via local pHash + PhotoDNA + Hive AI before IPFS pinning. Hit → block upload + audit-log entry                                                                                                                                                                                                      |
| **Outbound Webhooks**               | HMAC-signed webhook delivery via BullMQ worker, retry with exponential backoff. 5-minute replay window                                                                                                                                                                                                                          |
| **Product Analytics (PostHog)**     | Autocapture + custom events across web, mobile, server. Session replay (inputs masked), funnels, retention. Privacy: wallet-address identity only, DNT respected. See [docs/analytics.md](docs/analytics.md)                                                                                                                    |
| **Sandbox Workspace**               | Tabbed multi-modal draft surface: image / video / voice / audio / 3D / talking. Inline image edits (upscale, relight, outpaint, remove-bg), video edits, bring-your-own-video, style presets, seed, ref upload, keyboard shortcuts                                                                                              |
| **Universe Privacy (Owner)**        | Toggle `isPrivate` from Access Settings to hide a universe + every linked content item (gallery, landing page, search, wiki, lineage, entities) from the public. Owner still sees everything. Enforced server-side via a single `getExcludedUniverseIds` chokepoint; orthogonal to admin `isHidden`. Audit log entry per toggle |

### PARTIAL (Working but with gaps)

These features have working smart contracts, backend APIs, AND frontend UIs, but some interactive flows need completion.

| Feature                   | What Works                                                                                                                                                                                                                                                                                                                                                                                   | What's Missing                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Episode NFTs**          | Contract: ERC721 + ERC2981 royalties. API: listing + mint recording + atomic `batchCreateEpisodeListing`. MintContentDialog: pin to IPFS + on-chain mint. BuyNFTDialog: purchase with revenue splits. BatchMintEpisodesDialog in RevenuePanel for multi-row listings (up to 50 per batch)                                                                                                    | —                                                                                   |
| **Character NFTs**        | Contract: ownership + appearance royalties. API: full CRUD. MintContentDialog supports character minting. Dedicated gallery at `/characters/$universeId` with appearance/royalty chips, sort by top/newest/royalties, and per-universe totals                                                                                                                                                | —                                                                                   |
| **Canon Marketplace**     | Contract: submit/vote/finalize/license. API: all operations including `onChainSubmissionId` + `finalizeTxHash` for audit. Full submit form + For/Against voting UI. On-chain finalize button appears after the voting deadline (CanonMarketplace.finalize) with Firestore mirror. License dialog accepts ETH amount and calls `CanonMarketplace.licenseCanon` with PaymentRouter routing     | —                                                                                   |
| **Credit System**         | API: balance, tiers, purchase, spend, history. CreditStore UI with package selection. On-chain ETH + $LOAR payment verification (Sepolia + Base Sepolia). Stripe PaymentIntent creation + server-side verification                                                                                                                                                                           | Card payments require `STRIPE_SECRET_KEY` env var. Without it, card tab is disabled |
| **Subscriptions**         | API: configure tiers, subscribe, check access. 4-tier model. SubscribeDialog: tier selection + on-chain ETH payment. `/subscriptions` management page with cancel                                                                                                                                                                                                                            | No renewal reminders or tier downgrade UI                                           |
| **Collabs**               | API: propose, accept, activate, record episodes, complete. `/collabs` hub with Active/Proposals/History tabs. `/collabs/new` creation form                                                                                                                                                                                                                                                   | No episode-level collab tracking in universe editor                                 |
| **Ad Marketplace**        | Contract: slots, bidding, impressions. API: full CRUD. `/ads` hub with Browse & Campaigns tabs. `/ads/new` creation. `/ads/$slotId` detail + bidding. **Seed Dance**: `/ads/seeds` hub with Browse/My Seeds/My Gigs tabs, `/ads/seeds/new` creation wizard, `/ads/seeds/$seedId` detail + placement submissions                                                                              | No ad impression rendering during episode playback                                  |
| **IP Licensing**          | Contract: 6 license types, royalty tracking. API: full CRUD + merch. `/licensing` hub with Licenses + Merch tabs. `/licensing/new` creation                                                                                                                                                                                                                                                  | No merch fulfillment dashboard                                                      |
| **On-Chain Governance**   | Contract: OpenZeppelin Governor + TimelockController. Ponder indexes proposals/votes. Governance page at `/governance/$universeId`. Proposal creation awaits the tx receipt and parses the `ProposalCreated` event to record the real `proposalId`. Vote casting awaits on-chain confirmation and reads `hasVoted` so the UI never double-submits or shows a false-success toast             | —                                                                                   |
| **Token Trading**         | Uniswap v4 pool created at universe deployment. Fee hooks + LP locking live. LP yield dashboard. TokenSwapWidget with bonding curve + LP pool support, quick buy amounts. Per-token recent trades on `/tokens/$address`. User-scoped swap history on `/tokens/portfolio` backed by Ponder's indexed `swap` table                                                                             | —                                                                                   |
| **Social Features**       | Follow/unfollow, activity feed (Following + Global tabs), notification center, NotificationBell dropdown, like system, token comments with threads, general comments on episodes/universes/content                                                                                                                                                                                           | No push notifications to mobile devices yet                                         |
| **Analytics**             | API: views, engagement, trending, platform stats, per-episode metrics, export. Creator analytics dashboard at `/analytics/$universeId`. Market page queries real stats                                                                                                                                                                                                                       | No subscriber funnels or cohort analysis                                            |
| **Dashboard**             | AI generation tools + universe list wired to live tRPC API. LP Yield Manager panel, quests panel, daily check-in, monetization overview, upload form, NFT gallery. Per-universe cards now show views / mints / subs / votes / revenue chips sourced from `analytics.getUniverseMetrics`, with a "Details" link into `/analytics/$universeId`                                                 | —                                                                                   |
| **Rights Classification** | Backend enum is `fan` / `original` / `licensed`; licensed content has `licensingProof` + `reviewStatus`. Content feed on `/discover` now filters across all three lanes and renders `<ContentLaneBadge />` (including pending/approved/rejected review states) instead of the old fun / monetized pill. `content.feed` exposes `reviewStatus` so badges can render the correct lane variant  | —                                                                                   |
| **Worldbuilding Studio**  | `/create` hub + per-kind forms. Wiki at `/wiki` with tabbed entity browsing + detail pages (`/wiki/entity/$id`). Kind filter at `/wiki/$kind` (person, place, thing, etc.)                                                                                                                                                                                                                   | —                                                                                   |
| **Content Moderation**    | Flag system, admin review queue, DMCA intake (`/dmca`), immutable audit log. `contentStatus` gates commercial transactions. Admin UI at `/admin/moderation`                                                                                                                                                                                                                                  | No auto-flag threshold, no counter-notice workflow (manual review only)             |
| **Mobile App**            | Expo 52 / React Native (iOS + Android). Portfolio, tokens, earnings, collections, profile tabs. thirdweb wallet auth (inAppWallet: google/apple/passkey/email + external wallets). Production Hermes bytecode builds end-to-end (~16.6MB `.hbc`, 7083 modules). `@sentry/react-native` scaffold initialized in `app/_layout.tsx` (JS-layer crashes; native capture requires `expo prebuild`) | Beta — not yet published to App Store / Play Store                                  |

### PLANNED (Not implemented)

| Feature                         | Notes                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Mainnet Deployment**          | Contracts on Sepolia + Base Sepolia. Needs security audit before Base Mainnet. See [launch audit](docs/pre-launch-checklist.md) |
| **Fiat On-Ramp**                | Stripe integration exists but requires `STRIPE_SECRET_KEY`. No other fiat on-ramp                                               |
| **Merch Fulfillment**           | Backend CRUD exists. No fulfillment partner integration, no order management dashboard                                          |
| **Mobile App Store Publishing** | Expo 52 app exists (iOS + Android). Not yet submitted to App Store / Play Store                                                 |

---

## Architecture

```
                 ┌─────────────────────────────────────────────────┐
                 │                    Frontend                      │
                 │  React 18 + Vite + TanStack Router + wagmi       │
                 │  Port 3001                                       │
                 └──────────┬──────────────────┬───────────────────┘
                            │ tRPC              │ wagmi
                            ▼                   ▼
              ┌─────────────────────┐  ┌──────────────────────┐
              │   API Server        │  │  Sepolia/Base (EVM)  │
              │   Hono + tRPC       │  │  69 contracts        │
              │   60+ routers       │  │  (proxied +          │
              │   400+ procedures   │  │  upgradeable)        │
              │   Port 3000         │  └──────────┬───────────┘
              │                     │             │ events
              └──────────┬──────────┘             ▼
                         │               ┌──────────────────┐
                         ▼               │  Ponder Indexer   │
              ┌──────────────────┐       │  29 tables        │
              │  Firestore       │       │  GraphQL API      │
              │  (user data,     │       │  Port 42069       │
              │   content meta,  │       └──────────────────┘
              │   analytics)     │
              └──────────────────┘
```

| App              | Stack                                                  | Description                                              |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| `apps/web`       | React 18, Vite, TanStack Router/Query, wagmi, thirdweb | Frontend SPA (65 routes)                                 |
| `apps/server`    | Hono, tRPC, Firebase Admin (Firestore)                 | API server (60+ routers, 400+ procedures)                |
| `apps/indexer`   | Ponder v0.15, GraphQL                                  | Blockchain event indexer (29 tables)                     |
| `apps/contracts` | Foundry, Solidity ^0.8.30                              | EVM smart contracts (Sepolia/Base Sepolia, 69 contracts) |
| `apps/mcp`       | MCP Server                                             | AI agent gateway (25 tools for MCP-compatible agents)    |
| `apps/mobile`    | Expo 52, React Native, NativeWind                      | iOS + Android app                                        |
| `packages/abis`  | Auto-generated wagmi hooks                             | Shared contract bindings                                 |

### Key Flows

**Auth:** thirdweb Wallet (EVM) > SIWE Signature > Server JWT > Bearer Token > protectedProcedure

**Content Creation:** AI Generate > Decentralized Storage (SHA-256 dedup) > On-Chain Hash > Ponder Index

**Universe Deployment (Atomic):** UniverseManager.createUniverseWithToken() > Deploy GovernanceERC20 + Governor + TimelockController > Initialize Uniswap v4 Pool > Lock LP > Mint IdentityNFT (single tx)

**Universe Deployment (Two-Step):** createUniverse() (pays mint fee) > deployUniverseToken() (deploys token, pool, locker — mint fee WETH seeds the LP)

**LP Yield:** Uniswap v4 Swaps > LoarHookStaticFee (collects fees) > LoarLpLockerMultiple (distributes by BPS splits) > LoarFeeLocker (recipients claim ETH)

---

## Smart Contracts (Sepolia)

69 EVM contracts are deployed on **Sepolia testnet** (chain ID 11155111) with multi-chain support for **Base Sepolia** (84532) and **Base Mainnet** (8453). Revenue contracts use an upgradeable proxy pattern: **UUPS** for singletons and **Beacon Proxy** for per-universe NFTs.

**Target chain:** Base L2 (chain 8453). Contracts are currently deployed on Sepolia testnet and Base Sepolia for testing.

### Core Protocol

| Contract                 | Address                                      | Purpose                             |
| ------------------------ | -------------------------------------------- | ----------------------------------- |
| **UniverseManager**      | `0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce` | Factory: deploys universes + tokens |
| **LoarHookStaticFee**    | `0x9A53B31b8B4F76Bb617D6B9aAd62731f8033A8Cc` | Uniswap v4 fee collection hook      |
| **LoarLpLockerMultiple** | `0xc00225D9463C15280748dC2E21D8D8625982Ad54` | LP token locking (anti-rug)         |
| **LoarFeeLocker**        | `0x1E10b62bd2817d0C2414909027E1E63653fcCd8e` | Fee escrow and creator payouts      |

Plus per-universe: Universe, GovernanceERC20, UniverseGovernor, UniverseTimelockGovernor, IdentityNFT contracts.

### Additional Contracts

| Contract                     | Purpose                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| **IdentityNFT**              | Creator identity proof, minted per universe. Tracks co-creators                       |
| **UniverseTimelockGovernor** | 24-hour timelock on governance execution for safer proposals                          |
| **UniverseTokenDeployerV2**  | Enhanced token deployer with allocation config (LP/creator/treasury/community splits) |
| **PaymentRouter**            | Unified payment processing across ETH, ERC-20, and stablecoins                        |
| **ContentLicensing**         | BUY/RENT/LICENSE deals with royalty tracking                                          |
| **StoryBounties**            | Bounty creation for content creation tasks                                            |
| **SlopMarket**               | Secondary market for digital assets                                                   |
| **LaunchpadStaking**         | Stake $LOAR tokens, per-universe staking pools                                        |
| **TokenVesting**             | Token vesting schedules for team/investor allocations                                 |
| **LoarSwapRouter**           | DEX routing for $LOAR token swaps                                                     |

### Revenue Infrastructure (UUPS Proxies)

These are upgradeable singleton contracts behind ERC1967 proxies. Upgrade via `proxy.upgradeToAndCall(newImpl, "")`.

| Contract                | Proxy Address                                | Purpose                                  |
| ----------------------- | -------------------------------------------- | ---------------------------------------- |
| **PaymentRouter**       | `0x920e9A9bac991554AEE2AB7c76c521e5FB3113b6` | Fee splits & treasury routing            |
| **RightsRegistry**      | `0x3A14A746990498d5a4eCe867db10a197f91856Bc` | Content rights & ownership tracking      |
| **CanonMarketplace**    | `0xDc5998C5e334345Ac3Aa9a9c6e141f471e929c81` | Canon submission, voting & licensing     |
| **CreditManager**       | `0x5110FCCaf50316D8F874F22428dC1a832F591639` | AI generation credits & tiers            |
| **AdPlacement**         | `0x972bD30323B0Fb5f2466E39593cCdE1e8ae3F8C1` | Ad slot bidding & impressions            |
| **SubscriptionManager** | `0x53542bA1e3445804D9a225C967E2677F017D1d47` | Creator subscription tiers               |
| **LicensingRegistry**   | `0xbF0Fed6125b1e05aA3Dc52B72B5cd7703990627C` | IP licensing (6 types) & royalty splits  |
| **CollabManager**       | `0xE981454B4149BEa3a9018fa2ab77482F388ba01f` | Multi-creator collaboration management   |
| **AnalyticsRegistry**   | `0xB86539C4bf30036B6bd1513320cF38Bc839c7922` | On-chain analytics & engagement tracking |

### NFT Beacons & Factory

Per-universe NFT instances are deployed as **Beacon Proxies**. Upgrading a beacon upgrades ALL universe instances of that NFT type simultaneously.

| Contract                  | Address                                      | Purpose                                   |
| ------------------------- | -------------------------------------------- | ----------------------------------------- |
| **RevenueModuleFactory**  | `0x6D5CEf09F044224A51bd59EB841769255070e5dA` | Deploys all 5 NFT proxies per universe    |
| **EpisodeEdition Beacon** | `0x14742D6BB8eeE513D0D70a235d8B4d801F19F9ed` | ERC1155 episode editions (mint + royalty) |
| **Character Beacon**      | `0x0BEcc54417e9AaC9289C748eb72ECBb55292756f` | ERC721 character NFTs (appearance fees)   |
| **Entity Beacon**         | `0xF951065C7d4d28805188F60a3F8bd398B7776EC8` | ERC721 entity NFTs (world objects)        |
| **EntityEdition Beacon**  | `0xb3D7889c393b710edF2e087Cd2b7148a2556f47b` | ERC1155 entity editions                   |
| **EpisodeNFT Beacon**     | `0x3ebb4FFd384Fc971F445AA950055203916b749a5` | ERC721 episode NFTs (per-episode mint)    |

### Upgradeability

- **UUPS Singletons**: Deploy new implementation, call `proxy.upgradeToAndCall(newImpl, "")`. Only the contract owner can upgrade.
- **Beacon NFTs**: Deploy new implementation, call `beacon.upgradeTo(newImpl)`. All universe instances upgrade at once.
- All contracts use OpenZeppelin Upgradeable v5.0.2 with `Initializable` + `ReentrancyGuardUpgradeable`.

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

**Required for payments (testnet):**

- `TREASURY_ADDRESS` — Wallet address that receives ETH/$LOAR payments
- `LOAR_TOKEN_ADDRESS` — $LOAR ERC-20 contract address
- `RPC_URL` — Sepolia RPC for on-chain payment verification

**Optional (server starts without these):**

- `FAL_KEY` — AI generation
- `GOOGLE_API_KEY` — Gemini wiki generation + VLM subsystem
- `OPENAI_API_KEY` — GPT-4o-mini storyline generation
- `STRIPE_SECRET_KEY` — Enables card payments (card tab disabled without this)
- `REDIS_URL` — Distributed rate limiting (in-memory if unset, fine for single-instance)
- `THIRDWEB_SECRET_KEY` / `PIMLICO_API_KEY` / `BICONOMY_API_KEY` — ERC-4337 paymaster (gas sponsorship)
- `PHOTODNA_*` / `HIVE_API_KEY` — CSAM moderation (required in production)
- `POSTHOG_API_KEY`, `VITE_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_KEY` — product analytics
- `WEBHOOK_SIGNING_SECRET` — outbound webhook delivery (HMAC signing)

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

| Document                                                                 | Description                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| [MVP Scope](docs/mvp.md)                                                 | What's in the MVP, what's deferred, success criteria |
| [Roadmap](docs/roadmap.md)                                               | 3 milestones with concrete deliverables              |
| [Creator Journey](docs/creator-journey.md)                               | Step-by-step from wallet connect to revenue          |
| [IP & Content Policy](docs/ip-policy.md)                                 | Copyright rules, licensing, compliance               |
| [Monetization Map](docs/monetization-map.md)                             | How money flows, who pays, what's owned              |
| [Product Loops](docs/product-loops.md)                                   | Core loops with status assessment                    |
| [Architecture](docs/architecture.md)                                     | System design, auth flow, service connections        |
| [Trust Model](docs/trust-model.md)                                       | Contract ownership, admin powers, security model     |
| [Environment](docs/environment.md)                                       | All env vars, Firebase setup guide                   |
| [API Reference](docs/api.md)                                             | REST + tRPC + GraphQL endpoints                      |
| [Smart Contracts](docs/contracts.md)                                     | Contract guide, ABI generation                       |
| [Database](docs/database.md)                                             | Firestore + Ponder schema reference                  |
| [Deployment](docs/deployment.md)                                         | Docker, CI/CD, manual deploy                         |
| [Agents & MCP](docs/agents.md)                                           | AI agent pipelines, API keys, MCP server             |
| [Troubleshooting](docs/troubleshooting.md)                               | Common issues and fixes                              |
| [GTM Strategy](docs/gtm-prd.md)                                          | Go-to-market positioning and phased rollout          |
| [Analytics Spec](docs/analytics-spec.md)                                 | Analytics events and tracking specification          |
| [Rights Classification UI](docs/rights-classification-ui.md)             | Three-lane model, badge system, data migration       |
| [Moderation & Rights](docs/prd-moderation-rights-ops.md)                 | Content flagging, DMCA, admin review, audit log      |
| [Worldbuilding Studio](docs/prd-worldbuilding-studio.md)                 | Entity kinds, wiki, create hub                       |
| [Likeness Marketplace](docs/prd-likeness-marketplace.md)                 | Verified likeness KYC + consent (deferred to V2)     |
| [Alpha 01: Brand Unification](docs/prd-alpha-01-brand-unification.md)    | Brand consistency and UI unification PRD             |
| [Alpha 02: Revenue Loop](docs/prd-alpha-02-revenue-loop.md)              | Closing the revenue loop for alpha launch            |
| [Mobile: Portfolio & Wallet](docs/prd-mobile-portfolio-wallet-assets.md) | Mobile portfolio, wallet, and assets PRD             |
| [Mobile: Consumer Feed](docs/prd-mobile-consumer-feed-create.md)         | Mobile consumer feed and creation PRD                |
| [Mobile: Market & Shop](docs/prd-mobile-market-shop-seller.md)           | Mobile marketplace and seller PRD                    |
| [Security](docs/security.md)                                             | Security architecture and threat model               |
| [Pre-Launch Checklist](docs/pre-launch-checklist.md)                     | Validation checklist before launch                   |
| [Product Analytics (PostHog)](docs/analytics.md)                         | Event catalogue, privacy posture, query recipes      |
| [VLM Subsystem](docs/prd-vlm-subsystem.md)                               | Vision-Language Model pipeline spec                  |
| [Gas Abstraction](docs/gas-abstraction.md)                               | ERC-4337 paymaster architecture                      |
| [Social Graph](docs/prd-social-graph.md)                                 | Follow graph + activity feed spec                    |
| [KYC / AML Compliance](docs/compliance-kyc-aml.md)                       | KYC/AML posture for creator payouts                  |
| [Tax Reporting](docs/compliance-tax-reporting.md)                        | 1099-K and international reporting                   |
| [Mobile Store Submission](docs/mobile-store-submission.md)               | App Store + Play Store submission playbook           |

---

## Web App Routes (65 pages)

### Core

| Route        | Description                                                                          |
| ------------ | ------------------------------------------------------------------------------------ |
| `/`          | Landing page                                                                         |
| `/login`     | Wallet authentication                                                                |
| `/dashboard` | User dashboard — universes, AI generation, LP yield, quests, daily check-in, uploads |
| `/discover`  | Explore creators and universes                                                       |

### Universe & Creation

| Route                        | Description                                                               |
| ---------------------------- | ------------------------------------------------------------------------- |
| `/cinematicUniverseCreate`   | Full universe creation wizard (atomic or two-step)                        |
| `/universe/$id`              | Universe detail view                                                      |
| `/universe/$id/deploy-token` | Deploy governance token + LP pool for existing universe                   |
| `/universe/$id/gen-config`   | AI generation configuration                                               |
| `/universe/$id/gallery`      | Universe gallery                                                          |
| `/create`                    | Create hub (entities, characters, places, etc.)                           |
| `/create/$kind`              | Per-kind creation form (person, place, thing, faction, event, lore, etc.) |
| `/play/$universeId`          | Narrative gameplay/exploration                                            |

### Marketplace & Commerce

| Route               | Description                        |
| ------------------- | ---------------------------------- |
| `/market`           | Primary marketplace with stats     |
| `/shop/$universeId` | Universe shop                      |
| `/product/$id`      | Product detail with ETH buy button |
| `/checkout`         | Purchase checkout                  |
| `/pricing`          | Credit pricing tiers               |
| `/credits`          | Credit balance and purchase        |
| `/sell/`            | Content selling hub                |
| `/sell/new`         | Create sale listing                |
| `/sell/earnings`    | View earnings                      |

### Tokens & DeFi

| Route                      | Description                                               |
| -------------------------- | --------------------------------------------------------- |
| `/tokens/`                 | Token dashboard                                           |
| `/tokens/$address`         | Token details                                             |
| `/tokens/creator.$address` | Creator token info                                        |
| `/tokens/portfolio`        | Token portfolio                                           |
| `/tokens/swap`             | Token swap widget                                         |
| `/staking`                 | $LOAR staking interface                                   |
| `/governance/$universeId`  | Governance voting (proposals, votes, timelock)            |
| `/treasury/$universeId`    | Treasury management                                       |
| `/analytics/$universeId`   | Creator analytics dashboard (views, mints, subs, revenue) |

### Content & Wiki

| Route                     | Description                                        |
| ------------------------- | -------------------------------------------------- |
| `/wiki`                   | Worldbuilding encyclopedia (tabbed by entity kind) |
| `/wiki/$kind`             | Entity list filtered by kind (person, place, etc.) |
| `/wiki/entity/$id`        | Entity detail page                                 |
| `/wiki/character/$id`     | Character detail page                              |
| `/my-works`               | View created content                               |
| `/upload`                 | Upload media files                                 |
| `/sandbox`                | Draft workspace                                    |
| `/videos`                 | Video gallery                                      |
| `/gallery`                | Image gallery                                      |
| `/event/$universe/$event` | Event detail within universe                       |

### Social & Community

| Route                 | Description          |
| --------------------- | -------------------- |
| `/profile/$username`  | User profiles        |
| `/profile/edit`       | Edit profile         |
| `/activity`           | Activity feed        |
| `/notifications`      | Notification center  |
| `/subscriptions`      | Manage subscriptions |
| `/agents/`            | AI agent marketplace |
| `/agents/$uid`        | Agent detail         |
| `/agents/register`    | Register new agent   |
| `/agents/dashboard`   | Agent dashboard      |
| `/bounties/`          | Bounty hub           |
| `/bounties/$bountyId` | Bounty detail        |
| `/bounties/mine`      | My bounties          |

### Revenue & Licensing

| Route                | Description                                |
| -------------------- | ------------------------------------------ |
| `/licensing/`        | IP licensing hub                           |
| `/licensing/new`     | Create license agreement                   |
| `/collabs/`          | Collaboration hub                          |
| `/collabs/new`       | Create collaboration                       |
| `/ads/`              | Ad management                              |
| `/ads/new`           | Create ad placement                        |
| `/ads/$slotId`       | Ad detail + bidding                        |
| `/ads/seeds/`        | Seed Dance hub (browse, my seeds, my gigs) |
| `/ads/seeds/new`     | Plant a new ad seed                        |
| `/ads/seeds/$seedId` | Seed detail + submit/approve placements    |
| `/canon/$universeId` | Canon marketplace (submit, vote)           |
| `/order/$id`         | Order details                              |

### Admin & Legal

| Route               | Description              |
| ------------------- | ------------------------ |
| `/admin/moderation` | Content moderation queue |
| `/dmca`             | DMCA takedown form       |
| `/docs`             | Documentation            |
| `/terms`            | Terms of service         |
| `/privacy`          | Privacy policy           |
| `/faucet`           | Testnet token faucet     |
| `/coming-soon`      | Coming soon placeholder  |

---

## Project Structure

```
loar/
├── apps/
│   ├── web/             # React 18 SPA (Vite + TanStack Router, 65 routes)
│   ├── server/          # Hono + tRPC API (60+ routers, 400+ procedures)
│   ├── indexer/         # Ponder v0.15 blockchain indexer (29 tables)
│   ├── contracts/       # Foundry/Solidity EVM (69 contracts, upgradeable, Sepolia/Base)
│   ├── mcp/             # MCP server — AI agent gateway (25 tools)
│   └── mobile/          # Expo 52 / React Native (iOS + Android)
├── packages/
│   └── abis/            # Generated wagmi hooks + contract ABIs + addresses
├── docs/                # Product + technical documentation (50+ docs)
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
