# LOAR — Product Roadmap

## Current State (March 2026)

The platform has strong infrastructure — smart contracts deployed, backend fully implemented, AI generation working, timeline editor functional. The critical gap is **closing the monetization loop on the frontend** and **proving the product works for one external creator**.

---

## Milestone 1: Revenue Loop Closed (Target: 2-3 weeks)

**Goal:** One creator can earn real (testnet) revenue from one fan transaction.

**Why this matters:** Every investor will ask "can I see someone buy something?" Right now the answer is no, despite the backend being ready.

### Deliverables

- [ ] **Wire NFT Minting** — Add mint/buy buttons in Episode NFT and Character NFT marketplace tabs, connected to smart contracts via wagmi
- [ ] **Wire Credit Purchases** — Credits tab purchase flow connected to `credits.purchase` tRPC mutation
- [ ] **Wire Canon Voting** — Submission form + token-weighted voting UI in Canon marketplace tab
- [ ] **Fix Dashboard** — Replace dummy data with real `cinematicUniverses.getByCreator()` data
- [ ] **Basic Governance Voting** — Complete GovernanceSidebar with proposal creation and vote casting
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
- [ ] **Content Moderation** — Review queue, flagging, DMCA takedown process
- [ ] **KYC/AML** — For high-value transactions (licensing, large NFT sales)
- [ ] **Social Layer** — Follows, comments, activity feed, notifications
- [ ] **Mainnet Deployment** — Ethereum L2 (Base or Arbitrum) for lower gas costs
- [ ] **Creator SDK / API** — Third-party apps can read universe data, embed episodes
- [ ] **Recommendation Engine** — Personalized universe suggestions

### Success Signal

First fiat payment processed. 100+ DAU. Platform passes security audit. One licensing deal signed.

---

## What We're NOT Building (And Why)

| Feature                        | Why Not                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------- |
| **Mobile App**                 | Web-first validates faster. Mobile is a growth investment, not a validation tool |
| **Multi-Chain**                | Complexity without validation signal. One chain is enough to prove the model     |
| **AI Model Training**          | We use third-party models (FAL, Gemini, OpenAI). Training our own is a $10M+ bet |
| **Physical Merch Fulfillment** | Requires logistics infrastructure. Partner with print-on-demand later            |
| **Live Events / Premieres**    | Cool feature, zero validation signal at this stage                               |
| **Cross-Platform Syndication** | YouTube/TikTok export is a growth play, not a core loop                          |

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
