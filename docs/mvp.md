# LOAR — MVP Scope Definition

## What "MVP" Means for LOAR

The MVP is the smallest feature set that lets one creator go from zero to a published, tokenized cinematic universe with at least one working monetization path. Not ten revenue streams — one that works end-to-end.

---

## MVP Core Loop (What Must Work Flawlessly)

```
Connect Wallet → Create Universe → Generate AI Content → Publish On-Chain → Get Discovered → Earn
```

### Status of Each Step

| Step | Feature              | Status  | Gap                                                                                                                                       |
| ---- | -------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Wallet Login**     | LIVE    | None. SIWE auth works end-to-end                                                                                                          |
| 2    | **Create Universe**  | LIVE    | Contract + token + Uniswap pool deploys correctly                                                                                         |
| 3    | **Generate Content** | LIVE    | 44 video models, 21 image models, wiki generation all functional                                                                          |
| 4    | **Build Timeline**   | LIVE    | ReactFlow editor with MiniMap, search, undo/redo, auto-layout, keyboard shortcuts, scene controls, cast management, on-chain node storage |
| 5    | **Publish**          | LIVE    | Decentralized storage with dedup, content hash on-chain                                                                                   |
| 6    | **Get Discovered**   | LIVE    | Content feed + creator gallery with search/filters                                                                                        |
| 7    | **Earn Revenue**     | PARTIAL | On-chain credit purchases (ETH/$LOAR) work. NFT minting and subscriptions not yet wired                                                   |

**The MVP loop is partially closed at Step 7.** On-chain credit purchases (ETH and $LOAR) work end-to-end on Sepolia + Base Sepolia. NFT minting, subscriptions, and other marketplace transactions still need frontend wiring.

---

## What's Actually Shipped (Honest Assessment)

### Working End-to-End

- Wallet authentication (SIWE → JWT)
- Universe + token deployment (smart contract)
- AI content generation (44 video + 21 image models, wiki generation)
- Narrative timeline editor (ReactFlow + on-chain) with MiniMap, node search (Ctrl+K), undo/redo, auto-layout, keyboard shortcuts, fullscreen mode, edge labels, zoom controls
- Scene controls: 16 camera presets, 12 style presets, 14 VFX overlays, cast assignment, motion brush, keyframe handoff
- Cast management: universe-wide character registry with reference images for consistency
- Decentralized multi-provider storage (Pinata, Lighthouse, Firebase) with SHA-256 dedup
- Content upload with IP classification (fan/original/licensed)
- Creator profiles with customization
- Content and creator discovery with marketplace stats
- Worldbuilding studio: `/create` hub with 10 entity kinds, tabbed wiki at `/wiki`
- Blockchain event indexing (Ponder, 29 tables)
- On-chain credit purchases (ETH + $LOAR, Sepolia + Base Sepolia)
- LP yield management (fee collection, multi-recipient distribution, claim UI)
- TimelockController governance (24h execution delay, Ponder indexes proposals/votes)
- Identity NFTs (per-universe creator identity proof)
- Content moderation (flag system, admin review queue, DMCA intake, audit log)
- Quest & affiliate system ($LOAR rewards for engagement actions)
- Social features: follow/unfollow, activity feed, notifications, likes, threaded comments
- AI agent system: agent creation, pipelines, API keys, MCP server (25 tools)
- Audio generation: music, TTS, voice cloning, sound effects, lip-sync
- 3D asset generation: text-to-3D and image-to-3D via Meshy
- Private creator's room: plot notes, lore vault, draft workspace (token-gated)
- Interactive narrative player: branching playback with choice overlays and branch stats

### Backend-Complete, Frontend-Incomplete

These have fully implemented tRPC routes AND deployed Solidity contracts, but the marketplace UI doesn't wire them to actual transactions:

- Episode NFT minting (contract + API ready, no mint button)
- Character NFT minting (contract + API ready, no mint button)
- Subscription management (API ready, no subscribe button)
- Canon voting (submit form + for/against voting UI exists, on-chain finalize/license not wired)
- Cross-universe collabs (API ready, no proposal form)
- Ad bidding (contract + API ready, no bid form)
- **Seed Dance** — Ad seed creation + bounty placements (API + full UI: `/ads/seeds`, `/ads/seeds/new`, `/ads/seeds/$seedId`). Brands post seeds, filmmakers earn $LOAR by placing ads in films. Advertiser approve/reject flow complete
- IP licensing (contract + API ready, no license form)
- Analytics (API ready, no per-universe dashboard visualization)
- Governance voting (proposals/votes indexed, voting UI partially wired)
- Rights classification (backend uses fan/original/licensed, frontend labels not fully migrated)

### Not Built

- Fiat payments (Stripe integration exists but requires `STRIPE_SECRET_KEY`; no other fiat on-ramp)
- ~~Social features~~ → **Now LIVE**: follows, comments, notifications, activity feed, like system, token-gated discussions
- Creator analytics dashboard (per-universe P&L — basic view exists, no funnels/cohorts)
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

- **AI model selection** — 65 models (44 video + 21 image) via FAL AI + ModelArk, plus audio (ElevenLabs), 3D (Meshy). Smart auto-routing selects by quality/speed/cost
- **Credit pricing** — Dual-margin pricing (35% card/ETH, 25% LOAR). Generation costs are estimates, not validated
- **Storage provider priority** — Pinata > Lighthouse > Firebase ordering may shift (Storacha being sunset, see project notes)
- **Governance parameters** — Voting delay 7200 blocks, voting period 50400 blocks, 10% quorum are defaults, not tuned
- **Token supply** — 100B per universe is arbitrary, may need economic modeling

---

## Deferred (Not MVP)

| Feature             | Why Deferred                                                                     |
| ------------------- | -------------------------------------------------------------------------------- |
| Mainnet deployment  | Needs smart contract audit (~$50-100K). 3.65% test coverage is critical gap      |
| Fiat on-ramp        | Requires payment processor (Stripe/MoonPay) integration                          |
| Merch fulfillment   | Physical logistics is a separate business problem                                |
| ~~Mobile app~~      | **Exists** — Expo 52 app (iOS + Android) built. Not yet published to stores      |
| ~~Social features~~ | **Shipped** — Follows, comments, activity feed, notifications, likes all working |
