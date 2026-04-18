# LOAR — Product Roadmap

> **Last updated:** April 17, 2026

## Current State (April 2026)

The platform has strong infrastructure — 69 smart contracts deployed (Sepolia + Base Sepolia), 44+ tRPC routers (400+ procedures), 65 web routes, 65 AI models (44 video + 21 image), audio/3D generation, LP yield management, TimelockController governance, Identity NFTs, multi-chain support, on-chain credit purchases, social features (follows, comments, activity feed, notifications), AI agent system with MCP server, worldbuilding studio, scene controls (camera/style/VFX/cast/motion brush), and interactive narrative player.

The critical gap is **closing the remaining monetization UI loops** (NFT minting, subscriptions, collabs) and **proving the product works for one external creator**.

---

## Milestone 1: Revenue Loop Closed

**Goal:** One creator can earn real (testnet) revenue from one fan transaction.

**Why this matters:** Every investor will ask "can I see someone buy something?" Right now the answer is no, despite the backend being ready.

### Deliverables

- [x] **Fix Dashboard** — Real universe data via `universes.getByCreator()`, LP yield panel, quests, daily check-in, monetization overview
- [x] **Wire Credit Purchases** — On-chain ETH/$LOAR payment verification live (Sepolia + Base Sepolia)
- [x] **Basic Governance** — TimelockController governance with configurable voting parameters, Ponder indexing proposals/votes
- [x] **Token Deployment** — Standalone `/universe/$id/deploy-token` route with chain selection, custom symbols, allocation splits
- [x] **LP Yield Management** — Fee collection, multi-recipient distribution, claim UI in dashboard
- [x] **Social Layer** — Follow/unfollow, activity feed, notifications, likes, threaded comments, token-gated discussions
- [x] **Worldbuilding Studio** — `/create` hub with 10 entity kinds, tabbed wiki at `/wiki` with entity detail pages
- [x] **Scene Controls & Cast** — Camera presets, style presets, VFX, cast management, motion brush, keyframe handoff
- [x] **AI Agent System** — Agent creation, pipelines, API key management, MCP server with 25 tools
- [x] **Enhanced Timeline Editor** — MiniMap, node search, undo/redo, auto-layout, keyboard shortcuts, fullscreen mode, edge labels
- [ ] **Wire NFT Minting** — Add mint/buy buttons in Episode NFT and Character NFT marketplace tabs, connected to smart contracts via wagmi
- [ ] **Wire Canon Voting** — Submission form + token-weighted voting UI in Canon marketplace tab (backend + contract ready, frontend finalize/license calls not wired)
- [ ] **Wire Subscriptions** — Subscribe button connected to `subscriptions.subscribe()` mutation
- [ ] **End-to-End Smoke Test** — One full creator journey: wallet > universe > content > list NFT > fan mints

### Success Signal

A non-team wallet can: create a universe, generate AI content, list an episode NFT, and another wallet can mint it.

---

## Milestone 2: Demo-Ready Product (Target: 4-6 weeks after M1)

**Goal:** The platform can sustain a 30-minute investor demo or a 50-person creator beta without embarrassment.

### Deliverables

- [ ] **Loading & Error States** — Skeleton loaders, error boundaries, retry logic on all routes
- [ ] **Per-Universe Analytics Dashboard** — Visualize views, mints, subscribers, revenue per universe
- [x] **Seed Dance (Ad Bounties)** — `/ads/seeds` hub with Browse/My Seeds/My Gigs tabs. Brands plant ad seeds (creative + bounty budget), filmmakers earn $LOAR by placing ads in their films. Full advertiser approve/reject flow
- [ ] **Collab + Ad + Licensing UI** — Wire remaining marketplace tabs to backend mutations
- [ ] **Mobile-Responsive Layouts** — Market page, timeline editor, profiles work on mobile
- [ ] **Onboarding Flow** — Guided first-universe creation with tooltips
- [ ] **Swap UI for Universe Tokens** — Embed Uniswap widget or build simple swap interface
- [ ] **Creator Earnings Page** — Show consolidated revenue across all streams
- [ ] **Bundle Optimization** — Code-split MetaMask SDK (~558KB) and viem/wagmi (~1.8MB)
- [ ] **Rate Limiting Tuning** — Validate 100 concurrent users without degradation
- [ ] **Mobile App Store Submission** — Publish Expo app to App Store and Play Store

### Success Signal

50 beta creators can use the platform independently. Average session > 10 minutes. At least 3 monetization paths see real transactions.

---

## Milestone 3: Mainnet-Ready (Target: 3-4 months after M2)

**Goal:** Real money can flow through the platform safely.

### Deliverables

- [ ] **Smart Contract Audit** — Third-party audit of all 69 deployed contracts (critical: 3.65% test coverage, see [launch audit](pre-launch-checklist.md))
- [ ] **Fiat On-Ramp** — Stripe or MoonPay integration for credit/subscription purchases
- [x] ~~**Content Moderation**~~ — Review queue, flagging, DMCA takedown process (implemented: `/admin/moderation`, `/dmca`, content status gates)
- [ ] **KYC/AML** — For high-value transactions (licensing, large NFT sales)
- [x] ~~**Social Layer**~~ — Follows, comments, activity feed, notifications (fully implemented)
- [ ] **Mainnet Deployment** — Base L2 (decided, multi-chain support already implemented)
- [ ] **Multi-Sig Governance Migration** — Transfer contract ownership from single EOA to Gnosis Safe + timelock
- [ ] **Pausable Guards** — Add Pausable to 14 revenue-handling contracts (currently missing)
- [ ] **Creator SDK / API** — Third-party apps can read universe data, embed episodes
- [ ] **Recommendation Engine** — Personalized universe suggestions

### Success Signal

First fiat payment processed. 100+ DAU. Platform passes security audit. One licensing deal signed.

---

## What We're NOT Building (And Why)

| Feature                        | Why Not                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| **AI Model Training**          | We use third-party models (FAL, Gemini, OpenAI). Training our own is a $10M+ bet |
| **Physical Merch Fulfillment** | Requires logistics infrastructure. Partner with print-on-demand later            |
| **Live Events / Premieres**    | Cool feature, zero validation signal at this stage                               |
| **Cross-Platform Syndication** | YouTube/TikTok export is a growth play, not a core loop                          |

---

## Key Milestones Timeline

| Milestone                     | Target | Signal                           | Status      |
| ----------------------------- | ------ | -------------------------------- | ----------- |
| First external NFT mint       | M1     | Revenue loop works               | In progress |
| 10 external creators          | M2     | Product works beyond team        | Not started |
| 50 DAU on testnet             | M2     | Retention loop working           | Not started |
| Smart contract audit complete | M3     | Ready for real money             | Not started |
| First fiat payment            | M3     | Non-crypto users can participate | Not started |
| Mainnet launch                | M3     | Real economic activity           | Not started |

---

## What's Been Built (Feature Inventory)

For a full accounting of every feature, route, API endpoint, and smart contract, see the [README](../README.md). Key numbers as of April 17, 2026:

| Metric             | Count |
| ------------------ | ----- |
| Web routes         | 65    |
| tRPC routers       | 44    |
| tRPC procedures    | 400+  |
| Solidity contracts | 69    |
| AI models (video)  | 44    |
| AI models (image)  | 21    |
| Ponder tables      | 29    |
| Custom React hooks | 42    |
| MCP tools          | 25    |
| Component files    | 122+  |
