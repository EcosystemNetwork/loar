# LOAR — Core Product Loops

## Overview

A product loop is a repeatable cycle where user action creates value that attracts more users. LOAR has four core loops. This document maps each one, assesses what works, and identifies where the loop breaks.

---

## Loop 1: Universe Creation

```
Creator connects wallet
    │
    ▼
Creates universe (deploys smart contract)
    │
    ▼
Deploys governance token + Uniswap v4 pool
    │
    ▼
Generates AI content (video/image/wiki)
    │
    ▼
Builds narrative timeline (ReactFlow → on-chain nodes)
    │
    ▼
Content stored across decentralized providers
    │
    ▼
Universe appears in discovery feed
    │
    ▼
Creator sets up profile + uploads additional content
    │
    ├─── Loop back: create more episodes ───┐
    │                                        │
    ▼                                        │
Attracts fans ─── fans discover ─── fans watch ─── creator is motivated ─┘
```

**Status: 90% WORKING**

| Step                  | Status | Notes                                                      |
| --------------------- | ------ | ---------------------------------------------------------- |
| Wallet connect        | LIVE   | SIWE auth works                                            |
| Universe deployment   | LIVE   | Contract + token + pool                                    |
| AI generation         | LIVE   | 4 video models, 4 image models, wiki                       |
| Timeline editor       | LIVE   | ReactFlow + on-chain storage                               |
| Decentralized storage | LIVE   | Pinata/IPFS > Lighthouse/Filecoin > Firebase               |
| Discovery             | LIVE   | Search, filters, content feed                              |
| Profile setup         | LIVE   | Themes, bio, social links                                  |
| **Fan engagement**    | BROKEN | No comments, likes, follows. Fans can only watch passively |

**Loop breaks because:** Fans have no way to signal interest back to the creator (no social features). The creator has no engagement metrics dashboard to see if anyone is watching.

---

## Loop 2: Episode Generation

```
Creator opens universe timeline
    │
    ▼
Creates new event node
    │
    ▼
Writes prompt + selects characters
    │
    ▼
AI generates image from prompt
    │
    ▼
AI generates video from image (4 model choices)
    │
    ▼
Creator previews + confirms
    │
    ▼
Content uploaded to decentralized storage
    │
    ▼
Node stored on-chain (contentHash + plotHash)
    │
    ▼
Ponder indexes → appears in GraphQL / discovery
    │
    ├─── Creator adds more episodes ───────────────┐
    │                                               │
    ▼                                               │
Wiki auto-generated (Gemini) ─── characters enriched ─┘
```

**Status: 95% WORKING**

| Step                 | Status | Notes                                                                |
| -------------------- | ------ | -------------------------------------------------------------------- |
| Open timeline        | LIVE   | ReactFlow with zoom, pan                                             |
| Create node          | LIVE   | Multi-step creation dialog                                           |
| Write prompt         | LIVE   | Prompt input + character selection                                   |
| AI image gen         | LIVE   | 4 FAL models                                                         |
| AI video gen         | LIVE   | Veo3, Kling, Wan2.5, Sora                                            |
| Preview + confirm    | LIVE   | Video player + metadata display                                      |
| Storage upload       | LIVE   | SHA-256 dedup, multi-provider                                        |
| On-chain storage     | LIVE   | Universe.createNode()                                                |
| Indexing             | LIVE   | Ponder → GraphQL                                                     |
| Wiki generation      | LIVE   | Gemini analysis                                                      |
| **Credit deduction** | BROKEN | Generation happens without spending credits. Cost model not enforced |

**Loop breaks because:** AI generation is free (no credit enforcement). This means no revenue from the generation loop and no scarcity/value signal.

---

## Loop 3: Token Participation

```
Fan discovers universe
    │
    ▼
Fan buys governance token on Uniswap v4
    │
    ├─── 20% fee → platform treasury
    │
    ▼
Fan delegates voting power
    │
    ▼
Fan creates/votes on governance proposals
    │
    ▼
Proposals execute on-chain (canon decisions, policy changes)
    │
    ▼
Universe evolves based on community votes
    │
    ├─── More engagement → token demand ─── price appreciation ───┐
    │                                                              │
    ▼                                                              │
Fan submits canon content ─── voted in ─── earns from licensing ──┘
```

**Status: 40% WORKING**

| Step              | Status    | Notes                                                                              |
| ----------------- | --------- | ---------------------------------------------------------------------------------- |
| Discover universe | LIVE      | Discovery feed works                                                               |
| Buy token         | PARTIAL   | Pool exists on Uniswap v4, but no swap UI in LOAR. Users must use Uniswap directly |
| Delegate voting   | NOT WIRED | useERC20Governance hook is empty                                                   |
| Create proposals  | NOT WIRED | GovernanceSidebar shows info but can't create proposals                            |
| Vote on proposals | NOT WIRED | Voting UI exists but isn't connected to contract                                   |
| Execute proposals | NOT WIRED | Depends on proposal creation + voting                                              |
| Canon submissions | NOT WIRED | Backend ready, no frontend form                                                    |

**Loop breaks because:** The governance UI is mostly display-only. Token holders can't actually participate in governance from the frontend. The entire DAO loop is backend-complete but frontend-incomplete.

---

## Loop 4: Monetization

```
Creator produces content (Loop 1 + Loop 2)
    │
    ├─── List episode as NFT ─── fans mint ─── creator earns
    │
    ├─── Mint character NFT ─── character appears ─── owner earns royalties
    │
    ├─── Set subscription tiers ─── fans subscribe ─── recurring revenue
    │
    ├─── Platform sells credits ─── users generate ─── platform earns
    │
    ├─── Open canon marketplace ─── community submits ─── accepted = licensed
    │
    ├─── Propose collab ─── partner accepts ─── shared episodes ─── split revenue
    │
    ├─── List ad slots ─── sponsors bid ─── impressions tracked ─── payout
    │
    ├─── License IP ─── partner pays upfront + royalties
    │
    └─── Token trades on Uniswap ─── 20% fee to platform
```

**Status: 15% WORKING (on frontend)**

| Revenue Stream | Backend | Contract | Frontend     | End-to-End                     |
| -------------- | ------- | -------- | ------------ | ------------------------------ |
| Credits        | DONE    | DONE     | Display only | NO                             |
| Episode NFTs   | DONE    | DONE     | Display only | NO                             |
| Character NFTs | DONE    | DONE     | Display only | NO                             |
| Subscriptions  | DONE    | DONE     | Display only | NO                             |
| Canon Market   | DONE    | DONE     | Display only | NO                             |
| Collabs        | DONE    | DONE     | Placeholder  | NO                             |
| Ad Bidding     | DONE    | DONE     | Placeholder  | NO                             |
| IP Licensing   | DONE    | DONE     | Placeholder  | NO                             |
| Token Trading  | N/A     | DONE     | No swap UI   | PARTIAL (via external Uniswap) |
| Merch          | DONE    | DONE     | Placeholder  | NO                             |

**Loop breaks because:** The marketplace page is informational — it explains revenue streams but doesn't let anyone transact. Every tab needs interactive forms + contract calls.

---

## Loop Health Summary

| Loop                    | Health   | Blocking Issue                   | Fix Effort                         |
| ----------------------- | -------- | -------------------------------- | ---------------------------------- |
| **Universe Creation**   | Strong   | No fan engagement signals        | Medium (social features)           |
| **Episode Generation**  | Strong   | Credits not enforced             | Small (wire credit spending)       |
| **Token Participation** | Weak     | Governance UI not connected      | Medium (wire voting + proposals)   |
| **Monetization**        | Critical | No transaction flows on frontend | Medium (wire 3-4 marketplace tabs) |

---

## Priority Actions to Close Loops

### Week 1-2: Close the Money Loop

1. Wire Episode NFT mint/buy flow (contract call from marketplace tab)
2. Wire credit purchase flow (even without fiat — ETH is fine)
3. Enforce credit spending on AI generation
4. Wire canon submission + voting forms

### Week 3-4: Close the Governance Loop

5. Wire governance proposal creation
6. Wire voting on proposals
7. Add basic token swap widget (or link to Uniswap)
8. Complete delegation UI

### Week 5-6: Close the Engagement Loop

9. Basic social: like/bookmark episodes
10. View counts visible to creators
11. Per-universe analytics dashboard
12. Notifications for governance events
