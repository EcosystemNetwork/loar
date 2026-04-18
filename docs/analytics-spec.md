# LOAR — Analytics & Cost Instrumentation Spec

## Core KPIs

### Creator Funnel

| KPI                         | Definition                                              | Source                                                    |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| **Universe Creation Rate**  | New universes deployed per day/week                     | `cinematicUniverses.create` + Ponder `universe` table     |
| **Content Generation Rate** | AI generations per universe per day                     | `fal.generateImage`, `fal.generateVideo`, `credits.spend` |
| **Episode Publish Rate**    | On-chain nodes created per day                          | Ponder `node` table                                       |
| **Creator Activation**      | % of wallet logins that create a universe within 7 days | `trackWalletLogin` + `cinematicUniverses.create`          |
| **Creator Retention**       | % of creators who generate content in week 2+           | `credits.spend` timestamps                                |

### Audience Funnel

| KPI                         | Definition                                      | Source                                                  |
| --------------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| **DAU / WAU / MAU**         | Unique wallet addresses with activity           | `trackWalletLogin`, `analytics.recordView`              |
| **Episode Views**           | Total and unique views per episode              | `analytics.recordView` (tracks viewerAddress, duration) |
| **Engagement Rate**         | (likes + shares + comments + bookmarks) / views | `analytics.recordEngagement`                            |
| **Discovery Conversion**    | % of `/discover` visits → universe page visit   | Client-side event tracking                              |
| **Subscription Conversion** | % of viewers who subscribe to a universe        | `subscriptions.subscribe`                               |

### Monetization

| KPI                      | Definition                                   | Source                                  |
| ------------------------ | -------------------------------------------- | --------------------------------------- |
| **Credit Revenue**       | Total credits purchased (fiat-equivalent)    | `credits.purchase` transactions         |
| **NFT Volume**           | Total ETH from episode + character NFT mints | `nft.recordMint` (price field)          |
| **Subscription Revenue** | MRR from active subscriptions                | `subscriptions.subscribe` transactions  |
| **Licensing Revenue**    | Upfront fees + royalty payments              | `licensing.recordRoyalty`               |
| **Ad Revenue**           | Accepted bids × impressions delivered        | `ads.acceptBid`, `ads.recordImpression` |
| **Token Trading Volume** | Swap volume across all universe pools        | Ponder `swap` table                     |
| **Platform Take Rate**   | Platform revenue / total GMV                 | Aggregated from all streams             |
| **ARPU**                 | Revenue / active users per month             | All revenue sources / DAU               |

### Health

| KPI                          | Definition                                   | Source                                           |
| ---------------------------- | -------------------------------------------- | ------------------------------------------------ |
| **Storage Redundancy**       | Avg providers per content item               | `storageManifests` collection (uploads[] length) |
| **Generation Success Rate**  | Completed / (completed + failed) generations | `fal` router responses                           |
| **Governance Participation** | % of token holders who vote                  | Ponder `vote` + `tokenHolder` tables             |
| **Canon Submission Rate**    | Submissions per universe per week            | `marketplace.submit`                             |

---

## AI Generation Cost Model

### Current Credit Pricing

| Action                | Credits | Estimated Provider Cost    | Margin                 |
| --------------------- | ------- | -------------------------- | ---------------------- |
| Image generation      | 1       | ~$0.01–0.05 (FAL)          | TBD after pricing lock |
| Video generation (5s) | 5       | ~$0.10–0.50 (FAL)          | TBD                    |
| Story generation      | 2       | ~$0.01–0.03 (Gemini)       | TBD                    |
| Spinoff generation    | 10      | ~$0.20–1.00 (FAL + Gemini) | TBD                    |
| Character creation    | 3       | ~$0.05–0.15 (FAL + Gemini) | TBD                    |
| Scene generation      | 8       | ~$0.15–0.80 (FAL)          | TBD                    |

### Cost Tracking Points

These are the instrumentation points for tracking actual AI costs:

| Service    | Endpoint                  | What to Log                                     |
| ---------- | ------------------------- | ----------------------------------------------- |
| **FAL AI** | `fal.generateImage`       | model, resolution, latency, success/fail        |
| **FAL AI** | `fal.generateVideo`       | model, duration (5s/10s), latency, success/fail |
| **FAL AI** | `fal.editImage`           | model, latency, success/fail                    |
| **FAL AI** | `fal.analyzeCharacter`    | Gemini call cost                                |
| **Gemini** | `wiki.generateEventWikia` | token count, latency                            |
| **Gemini** | `wiki.generateStoryline`  | token count, latency                            |
| **Gemini** | `wiki.generateFromVideo`  | token count + video processing, latency         |
| **Gemini** | `wiki.improveVideoPrompt` | token count, latency                            |

### Storage Costs

| Provider                  | Cost Model                        | Tracking                  |
| ------------------------- | --------------------------------- | ------------------------- |
| **IPFS (Pinata)**         | Free tier → $20/mo for 50GB       | Upload count + total size |
| **Lighthouse (Filecoin)** | Per-deal pricing                  | Upload count + deal size  |
| **Filecoin (Synapse)**    | Per-deal pricing                  | Upload count + deal size  |
| **Firebase Storage**      | $0.026/GB/month + $0.12/GB egress | Bucket usage metrics      |

---

## Unit Economics Framework

### Per-Universe Economics

```
Universe Revenue = NFT sales + Subscription MRR + Licensing fees + Ad revenue + Token fees
Universe Cost    = AI generation (credits consumed × provider cost) + Storage + Gas fees
Universe Margin  = Revenue - Cost
```

### Per-User Economics

```
User LTV    = Credits purchased + NFTs minted + Subscriptions paid (over lifetime)
User CAC    = Marketing spend / new users acquired
LTV:CAC     = Target > 3:1
```

### Platform Economics

```
Platform GMV     = Sum of all transactions across all universes
Platform Revenue = Credit sales margin + NFT fees + Subscription cut + Licensing cut
Platform COGS    = AI provider costs + Storage costs + Infrastructure + Gas subsidies
Gross Margin     = (Revenue - COGS) / Revenue
```

---

## Existing Analytics Infrastructure

### What's Already Instrumented

| Endpoint                       | What It Tracks                                                  |
| ------------------------------ | --------------------------------------------------------------- |
| `analytics.recordView`         | Episode views with viewer address, duration                     |
| `analytics.recordEngagement`   | Likes, shares, comments, bookmarks per episode                  |
| `analytics.getUniverseMetrics` | Per-universe: views, mints, votes, subscribers, revenue         |
| `analytics.getTrending`        | Top universes by views, volume, engagement                      |
| `analytics.getPlatformStats`   | Global: universeCount, totalViews, totalMints, totalRevenue     |
| `trackWalletLogin`             | Wallet address, chain, connector, login count, first/last login |

### What Needs to Be Added

| Gap                                      | Priority | Implementation                                                                                     |
| ---------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| **Per-generation cost logging**          | High     | Log FAL/Gemini response metadata (tokens, model, latency) to Firestore `generationLogs` collection |
| **Credit purchase ↔ generation linking** | High     | Associate `creditTransactions` with `generationLogs` for unit economics                            |
| **Funnel events**                        | Medium   | Client-side: page views, button clicks, wizard step completion                                     |
| **Storage cost aggregation**             | Medium   | Periodic job to sum storage usage per provider                                                     |
| **Revenue attribution**                  | Medium   | Link revenue events to acquisition source                                                          |
| **Creator P&L dashboard**                | Low      | Aggregate per-universe revenue and costs for creator-facing analytics                              |
| **Cohort analysis**                      | Low      | Group users by signup week, track retention and revenue curves                                     |

---

## Dashboard Requirements

### Platform Dashboard (Internal)

For the team to answer: "Is this working?"

| Panel        | Metrics                                                      | Update Frequency |
| ------------ | ------------------------------------------------------------ | ---------------- |
| **Overview** | DAU, WAU, universes created, episodes published              | Real-time        |
| **Revenue**  | Credits sold, NFT volume, subscription MRR, total GMV        | Daily            |
| **Costs**    | AI generation spend, storage costs, gas costs                | Daily            |
| **Margins**  | Gross margin, per-generation cost, credit pricing efficiency | Weekly           |
| **Funnel**   | Login → create universe → first episode → first revenue      | Daily            |
| **Health**   | Generation success rate, storage redundancy, API latency     | Real-time        |

### Creator Dashboard (User-Facing, Planned)

For creators to answer: "How is my universe doing?"

| Panel          | Metrics                                                          |
| -------------- | ---------------------------------------------------------------- |
| **Audience**   | Views, unique viewers, engagement rate, subscriber count         |
| **Revenue**    | NFT sales, subscription income, licensing royalties, ad earnings |
| **Content**    | Episodes published, AI generations used, credits spent           |
| **Governance** | Active proposals, voter turnout, token holder count              |
| **Growth**     | Week-over-week trends for all above metrics                      |

### Investor Dashboard (Planned)

For investors to answer: "Is this a good bet?"

| Panel              | Metrics                                               |
| ------------------ | ----------------------------------------------------- |
| **Traction**       | Total universes, total creators, MAU, content volume  |
| **Revenue**        | GMV, platform revenue, MRR, growth rate               |
| **Unit Economics** | LTV, CAC, LTV:CAC, gross margin                       |
| **Engagement**     | DAU/MAU ratio, avg session duration, retention curves |
| **Market**         | Universes with revenue > 0, avg revenue per universe  |
