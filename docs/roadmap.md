# LOAR — Product Roadmap

## Current State (April 2026)

The platform has strong infrastructure — 30+ smart contracts deployed (Sepolia + Base), 45+ tRPC routers, 60+ web routes, 5 AI video providers (incl. ByteDance Seedance 2.0), LP yield management, TimelockController governance, Identity NFTs, multi-chain support, and on-chain credit purchases. The critical gap is **closing the remaining monetization UI loops** (NFT minting, subscriptions, collabs) and **proving the product works for one external creator**.

---

## Milestone 1: Revenue Loop Closed (Target: 2-3 weeks)

**Goal:** One creator can earn real (testnet) revenue from one fan transaction.

**Why this matters:** Every investor will ask "can I see someone buy something?" Right now the answer is no, despite the backend being ready.

### Deliverables

- [x] ~~**Fix Dashboard**~~ — Real universe data via `universes.getByCreator()`, LP yield panel, quests, daily check-in, monetization overview
- [x] ~~**Wire Credit Purchases**~~ — On-chain ETH/$LOAR payment verification live (Sepolia + Base Sepolia)
- [x] ~~**Basic Governance**~~ — TimelockController governance with configurable voting parameters, Ponder indexing proposals/votes
- [x] ~~**Token Deployment**~~ — Standalone `/universe/$id/deploy-token` route with chain selection, custom symbols, allocation splits
- [x] ~~**LP Yield Management**~~ — Fee collection, multi-recipient distribution, claim UI in dashboard
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
- [ ] **Collab + Ad + Licensing UI** — Wire remaining marketplace tabs to backend mutations
- [ ] **Mobile-Responsive Layouts** — Market page, timeline editor, profiles work on mobile
- [ ] **Onboarding Flow** — Guided first-universe creation with tooltips
- [ ] **Swap UI for Universe Tokens** — Embed Uniswap widget or build simple swap interface
- [ ] **Creator Earnings Page** — Show consolidated revenue across all streams
- [ ] **Bundle Optimization** — Code-split MetaMask SDK (~558KB) and viem/wagmi (~1.8MB)
- [ ] **Rate Limiting Tuning** — Validate 100 concurrent users without degradation

### Success Signal

50 beta creators can use the platform independently. Average session > 10 minutes. At least 3 monetization paths see real transactions.

---

## Milestone 3: Mainnet-Ready (Target: 3-4 months after M2)

**Goal:** Real money can flow through the platform safely.

### Deliverables

- [ ] **Smart Contract Audit** — Third-party audit of all deployed contracts
- [ ] **Fiat On-Ramp** — Stripe or MoonPay integration for credit/subscription purchases
- [x] ~~**Content Moderation**~~ — Review queue, flagging, DMCA takedown process (implemented: `/admin/moderation`, `/dmca`, content status gates)
- [ ] **KYC/AML** — For high-value transactions (licensing, large NFT sales)
- [ ] **Social Layer** — Follows, comments, activity feed, notifications
- [ ] **Mainnet Deployment** — Base L2 (decided, multi-chain support already implemented)
- [ ] **Creator SDK / API** — Third-party apps can read universe data, embed episodes
- [ ] **Recommendation Engine** — Personalized universe suggestions

### Success Signal

First fiat payment processed. 100+ DAU. Platform passes security audit. One licensing deal signed.

---

## What We're NOT Building (And Why)

| Feature                        | Why Not                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **Mobile App**                 | Web-first validates faster. Mobile is a growth investment, not a validation tool (Expo app exists for beta) |
| **AI Model Training**          | We use third-party models (FAL, Gemini, OpenAI). Training our own is a $10M+ bet                            |
| **Physical Merch Fulfillment** | Requires logistics infrastructure. Partner with print-on-demand later                                       |
| **Live Events / Premieres**    | Cool feature, zero validation signal at this stage                                                          |
| **Cross-Platform Syndication** | YouTube/TikTok export is a growth play, not a core loop                                                     |

---

## Key Milestones Timeline

| Milestone                     | Target | Signal                           |
| ----------------------------- | ------ | -------------------------------- |
| First external NFT mint       | M1     | Revenue loop works               |
| 10 external creators          | M2     | Product works beyond team        |
| 50 DAU on testnet             | M2     | Retention loop working           |
| Smart contract audit complete | M3     | Ready for real money             |
| First fiat payment            | M3     | Non-crypto users can participate |
| Mainnet launch                | M3     | Real economic activity           |
