# LOAR — MVP Scope Definition

## What "MVP" Means for LOAR

The MVP is the smallest feature set that lets a creator go from zero to a monetizable cinematic universe. A creator should be able to: create a universe, generate AI content, publish episodes, attract an audience, and earn revenue — all on-chain.

---

## MVP Features (Shipped)

### Core Loop

| Step | Feature              | Route                                                              |
| ---- | -------------------- | ------------------------------------------------------------------ |
| 1    | **Wallet Login**     | `/login` — SIWE authentication via RainbowKit                      |
| 2    | **Create Universe**  | `/cinematicUniverseCreate` — Deploy contract + governance token    |
| 3    | **Build Timeline**   | `/universe/$id` — ReactFlow editor, add/branch narrative nodes     |
| 4    | **Generate Content** | In-editor — AI video (4 providers) and image (4 models) generation |
| 5    | **Publish Episodes** | On-chain node creation with content hash + decentralized storage   |
| 6    | **Attract Audience** | `/discover` — Content and creator discovery with filters           |
| 7    | **Earn Revenue**     | `/market` — NFTs, credits, subscriptions, licensing, ads           |

### Supporting Systems

| System         | What's Built                                                    |
| -------------- | --------------------------------------------------------------- |
| **Auth**       | SIWE wallet login → JWT sessions, replay attack protection      |
| **Storage**    | Multi-provider with dedup (Walrus → IPFS → Filecoin → Firebase) |
| **Indexer**    | Real-time GraphQL API for all on-chain data (14+ tables)        |
| **Governance** | OpenZeppelin Governor — proposals, token-weighted voting        |
| **Analytics**  | View/engagement tracking, trending algorithm, platform stats    |
| **Profiles**   | Public creator portfolios with customizable themes              |
| **IP System**  | Fun vs monetized classification, copyright declarations         |
| **Wiki**       | AI-generated character profiles and storyline summaries         |

### Monetization (All Shipped)

| Stream             | Implementation                                         |
| ------------------ | ------------------------------------------------------ |
| **Credits**        | Buy credits → spend on AI generation (6 cost tiers)    |
| **Episode NFTs**   | Mint episodes, set price/royalties/supply              |
| **Character NFTs** | Mint AI characters as tradeable assets                 |
| **Subscriptions**  | 4 tiers (Free/Basic/Premium/VIP), feature gating       |
| **Canon Market**   | Submit contributions, token-weighted voting, licensing |
| **Collabs**        | Cross-universe partnerships with revenue splits        |
| **IP Licensing**   | 6 license types with royalty tracking                  |
| **Ads**            | 4 slot types with competitive bidding                  |
| **Token Trading**  | Uniswap v4 pools with fee hooks                        |

---

## Not in MVP (Deferred)

| Feature                         | Why Deferred                                                 |
| ------------------------------- | ------------------------------------------------------------ |
| **Mainnet deployment**          | Testnet validates mechanics; mainnet requires audit          |
| **Fiat on-ramp**                | Credit card → credits requires payment processor integration |
| **Mobile app**                  | Web-first; mobile is a growth play                           |
| **Bundle optimization**         | Functional but large; optimize after product-market fit      |
| **Merch fulfillment**           | Backend shell exists; needs physical logistics partner       |
| **Social features**             | Comments, follows, sharing — important but not core loop     |
| **Notification system**         | Email/push for governance events, mints, new episodes        |
| **Creator analytics dashboard** | Per-universe P&L, subscriber funnels                         |
| **Moderation tools**            | Content review queue, flagging, appeals                      |
| **Multi-chain**                 | Sepolia-only for now; multi-chain adds complexity            |

---

## MVP Success Criteria

1. A creator can deploy a universe and governance token in under 5 minutes
2. AI content generation works end-to-end (prompt → video → on-chain)
3. At least 3 monetization paths are functional (NFTs, credits, subscriptions)
4. Governance proposals can be created and voted on
5. Content is stored across 2+ decentralized providers
6. Discovery surfaces trending universes and creators
7. The platform can support 100 concurrent users without degradation

---

## What's Experimental

These features are shipped but may change significantly:

- **AI model selection** — Current models (FAL, Gemini) may be swapped based on cost/quality
- **Credit pricing** — Generation costs (image=1, video=5, etc.) are initial estimates
- **Storage priorities** — Provider ordering (Walrus first) may shift based on reliability data
- **Governance parameters** — Voting periods, quorum thresholds, proposal thresholds need tuning
- **Canon voting mechanics** — Token-weighted vs equal-weight voting is a design decision in flux
