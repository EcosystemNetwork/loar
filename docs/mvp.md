# LOAR — MVP Scope Definition

## What "MVP" Means for LOAR

The MVP is the smallest feature set that lets one creator go from zero to a published, tokenized cinematic universe with at least one working monetization path. Not ten revenue streams — one that works end-to-end.

---

## MVP Core Loop (What Must Work Flawlessly)

```
Connect Wallet → Create Universe → Generate AI Content → Publish On-Chain → Get Discovered → Earn
```

### Status of Each Step

| Step | Feature              | Status | Gap                                                                |
| ---- | -------------------- | ------ | ------------------------------------------------------------------ |
| 1    | **Wallet Login**     | LIVE   | None. SIWE auth works end-to-end                                   |
| 2    | **Create Universe**  | LIVE   | Contract + token + Uniswap pool deploys correctly                  |
| 3    | **Generate Content** | LIVE   | 4 video models, 4 image models, wiki generation all functional     |
| 4    | **Build Timeline**   | LIVE   | ReactFlow editor, branching, on-chain node storage                 |
| 5    | **Publish**          | LIVE   | Decentralized storage with dedup, content hash on-chain            |
| 6    | **Get Discovered**   | LIVE   | Content feed + creator gallery with search/filters                 |
| 7    | **Earn Revenue**     | BROKEN | Marketplace UI is informational. No purchase/mint flow on frontend |

**The MVP loop breaks at Step 7.** The backend APIs and smart contracts for monetization exist, but no frontend transaction flow lets a user actually pay for anything.

---

## What's Actually Shipped (Honest Assessment)

### Working End-to-End

- Wallet authentication (SIWE → JWT)
- Universe + token deployment (smart contract)
- AI content generation (video + image + wiki)
- Narrative timeline editor (ReactFlow + on-chain)
- Decentralized multi-provider storage
- Content upload with IP classification
- Creator profiles with customization
- Content and creator discovery
- Character wiki browsing
- Blockchain event indexing (Ponder, 37+ tables)

### Backend-Complete, Frontend-Incomplete

These have fully implemented tRPC routes AND deployed Solidity contracts, but the marketplace UI doesn't wire them to actual transactions:

- Episode NFT minting (contract + API ready, no mint button)
- Character NFT minting (contract + API ready, no mint button)
- Credit purchasing (API ready, no payment flow)
- Subscription management (API ready, no subscribe button)
- Canon voting (contract + API ready, no voting form)
- Cross-universe collabs (API ready, no proposal form)
- Ad bidding (contract + API ready, no bid form)
- IP licensing (contract + API ready, no license form)
- Analytics (API ready, no dashboard visualization)
- Governance voting (contract indexed, voting UI incomplete)

### Not Built

- Fiat payments (no Stripe, no credit card)
- Social features (no follows, comments, notifications)
- Content moderation (no flagging, no review queue)
- Creator analytics dashboard
- Mobile-responsive layouts (partial at best)
- Merch fulfillment (backend shell, no logistics)

---

## Revised MVP Definition

To close the loop, the MVP needs these additions:

### Must-Have (Closes the revenue loop)

| Feature                            | Effort   | Why                                                                                                                              |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **NFT Mint Button**                | 1-2 days | Wire marketplace tab to Episode/Character NFT contracts. Creator lists, fan mints. This is the simplest revenue path to complete |
| **Credit Purchase Flow**           | 1-2 days | Wire credits tab to `credits.purchase` mutation. Even without fiat, ETH purchase works                                           |
| **Dashboard with Real Data**       | 1 day    | Replace hardcoded dummy data with `cinematicUniverses.getByCreator()`                                                            |
| **Canon Submission + Voting Form** | 2-3 days | Wire marketplace canon tab to `marketplace.submit()` and `marketplace.vote()`                                                    |

### Should-Have (Makes it believable to investors)

| Feature                     | Effort   | Why                                                          |
| --------------------------- | -------- | ------------------------------------------------------------ |
| **Subscription Purchase**   | 1-2 days | Wire subscribe button to `subscriptions.subscribe()`         |
| **Basic Governance Voting** | 2-3 days | Complete the GovernanceSidebar voting UI with contract calls |
| **Per-Universe Analytics**  | 2-3 days | Visualize `analytics.getUniverseMetrics()` data              |

### Nice-to-Have (Polish)

| Feature                   | Effort   | Why                                               |
| ------------------------- | -------- | ------------------------------------------------- |
| **Loading/Error States**  | 2-3 days | Currently no skeleton loaders or error boundaries |
| **Mobile Responsiveness** | 3-5 days | Market page, timeline editor need mobile layouts  |
| **Onboarding Tutorial**   | 2-3 days | Guided first-universe creation                    |

---

## MVP Success Criteria

1. A creator can deploy a universe and generate AI content in under 10 minutes
2. A fan can discover a universe and mint an episode NFT with ETH
3. Credits can be purchased and spent on AI generation
4. At least one community governance vote can execute on-chain
5. Content appears in discovery feed within 60 seconds of creation
6. Platform runs on Sepolia without manual intervention

---

## What's Experimental

These features are built but their parameters may change:

- **AI model selection** — FAL models may be swapped based on cost/quality data
- **Credit pricing** — Generation costs (image=1, video=5) are estimates, not validated
- **Storage provider priority** — Walrus-first ordering may shift based on reliability
- **Governance parameters** — 300-block voting period, 10% quorum are defaults, not tuned
- **Token supply** — 100B per universe is arbitrary, may need economic modeling

---

## Deferred (Not MVP)

| Feature            | Why Deferred                                               |
| ------------------ | ---------------------------------------------------------- |
| Mainnet deployment | Needs smart contract audit (~$50-100K)                     |
| Fiat on-ramp       | Requires payment processor (Stripe/MoonPay) integration    |
| Mobile app         | Web-first; mobile is a growth play, not a validation play  |
| Social features    | Follows/comments don't validate the core monetization loop |
| Content moderation | Required before mainnet but not for testnet validation     |
| Multi-chain        | Adds complexity without validating the product             |
| Merch fulfillment  | Physical logistics is a separate business problem          |
