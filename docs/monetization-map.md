# LOAR — Monetization Map

## How Money Flows Through LOAR

This document maps every revenue stream: who pays, who receives, what the platform takes, and what's actually working today.

---

## Revenue Stream Overview

```
                          ┌─────────────────────┐
                          │     FANS / USERS     │
                          └──────────┬──────────┘
                                     │ pay
        ┌────────────────────────────┼────────────────────────────┐
        │            │               │              │             │
   Buy Credits   Mint NFTs   Subscribe    Buy Tokens    Bid on Ads
        │            │               │              │             │
        ▼            ▼               ▼              ▼             ▼
   ┌─────────┐ ┌─────────┐   ┌──────────┐  ┌───────────┐ ┌──────────┐
   │ Credits │ │ Episode  │   │ Creator  │  │ Uniswap   │ │ Ad Slot  │
   │ System  │ │ /Char    │   │ Sub Tier │  │ v4 Pool   │ │ Auction  │
   └────┬────┘ │ NFT      │   └────┬─────┘  └─────┬─────┘ └────┬─────┘
        │      └────┬─────┘        │               │            │
        │           │              │               │            │
        ▼           ▼              ▼               ▼            ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                    REVENUE SPLIT                              │
   │              Platform Fee (configurable bps)                  │
   │                    + Creator Share                            │
   └──────────────────────────────────────┬───────────────────────┘
                                          │
                          ┌───────────────┼───────────────┐
                          ▼                               ▼
                   ┌──────────┐                    ┌──────────┐
                   │ PLATFORM │                    │ CREATOR  │
                   │ Treasury │                    │ Wallet   │
                   └──────────┘                    └──────────┘
```

---

## Stream-by-Stream Breakdown

### 1. AI Generation Credits

| Aspect                  | Detail                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| **Who pays**            | Any authenticated user                                                           |
| **What they get**       | Credits to generate AI content (images, videos, stories)                         |
| **Pricing**             | Tiered packages (e.g., 100 credits for X ETH)                                    |
| **Cost per generation** | Image: 1 credit, Video: 5, Story: 2, Spinoff: 10, Character: 3, Scene: 8         |
| **Who earns**           | Platform (100% — this is a platform service)                                     |
| **On-chain**            | CreditManager contract tracks balances, but purchase is currently Firestore-only |
| **Status**              | PARTIAL — Backend tracks credits, no actual payment flow                         |

### 2. Episode NFTs

| Aspect            | Detail                                                                          |
| ----------------- | ------------------------------------------------------------------------------- |
| **Who pays**      | Fans who want to own a piece of a narrative                                     |
| **What they get** | ERC721 token representing an episode/scene                                      |
| **Pricing**       | Creator-set mint price + max supply                                             |
| **Who earns**     | Creator (mint revenue minus platform fee). ERC2981 royalties on secondary sales |
| **Platform take** | Configurable bps on primary mint                                                |
| **On-chain**      | EpisodeNFT.sol — fully deployed contract logic                                  |
| **Status**        | PARTIAL — Contract + API done, no frontend mint button                          |

### 3. Character NFTs

| Aspect                | Detail                                                                 |
| --------------------- | ---------------------------------------------------------------------- |
| **Who pays**          | Users who want to own a character                                      |
| **What they get**     | ERC721 character with appearance-based royalties                       |
| **Passive income**    | Character owners earn every time their character appears in an episode |
| **Secondary royalty** | 5% (500 bps) on resales                                                |
| **On-chain**          | CharacterNFT.sol — appearance tracking + royalty accumulation          |
| **Status**            | PARTIAL — Contract + API done, no frontend mint flow                   |

### 4. Subscriptions

| Aspect            | Detail                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| **Who pays**      | Fans of specific universes                                                                     |
| **What they get** | Tiered access: early content, voting boost, premium content, behind-the-scenes, credit bonuses |
| **Tiers**         | Free / Basic / Premium / VIP (creator-configurable pricing + features)                         |
| **Who earns**     | Creator (subscription revenue minus platform fee)                                              |
| **On-chain**      | SubscriptionManager.sol — tier config, subscribe, renew, revenue withdrawal                    |
| **Status**        | PARTIAL — Contract + API done, no subscribe flow on frontend                                   |

### 5. Canon Marketplace

| Aspect            | Detail                                                                                |
| ----------------- | ------------------------------------------------------------------------------------- |
| **Who pays**      | Community members (submission fee) + licensors (license fee)                          |
| **What they get** | Submissions: community content voted into canon. Licenses: right to use canon content |
| **Voting**        | Token-weighted — governance token holders decide which submissions are accepted       |
| **Who earns**     | Submitters (if accepted + licensed) + Platform (fee on submissions + licenses)        |
| **On-chain**      | CanonMarketplace.sol — submit, vote, finalize, license                                |
| **Status**        | PARTIAL — Contract + API done, marketplace tab is informational only                  |

### 6. Cross-Universe Collaborations

| Aspect            | Detail                                                            |
| ----------------- | ----------------------------------------------------------------- |
| **Who pays**      | Revenue from joint episodes is split per agreement                |
| **What they get** | Cross-pollinated audiences, shared content                        |
| **Revenue split** | Defined in basis points at collaboration creation                 |
| **On-chain**      | CollabManager.sol — propose, accept, activate, distribute revenue |
| **Status**        | PARTIAL — Contract + API done, no UI for creating collabs         |

### 7. IP Licensing

| Aspect            | Detail                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| **Who pays**      | External parties (studios, game devs, publishers)                             |
| **What they get** | License to use universe IP for: streaming, merch, gaming, comic, audio, other |
| **Pricing**       | Upfront fee + ongoing royalties (bps)                                         |
| **Who earns**     | Creator (upfront + royalties minus platform fee)                              |
| **On-chain**      | LicensingRegistry.sol — create, activate, pay royalties, revoke               |
| **Status**        | PARTIAL — Contract + API done, no licensing UI                                |

### 8. Programmatic Ads

| Aspect            | Detail                                                                                |
| ----------------- | ------------------------------------------------------------------------------------- |
| **Who pays**      | Advertisers/sponsors                                                                  |
| **What they get** | Ad placement in universes: billboard, product, sponsored character, audio mention     |
| **Pricing**       | Auction-based (competitive bidding, highest bid wins)                                 |
| **Who earns**     | Creator (accepted bid amount)                                                         |
| **On-chain**      | AdPlacement.sol — slot creation, bidding, sponsorship activation, impression tracking |
| **Status**        | PARTIAL — Contract + API done, no ad management UI                                    |

### 9. Token Trading (Uniswap v4)

| Aspect            | Detail                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| **Who pays**      | Token traders (swap fees)                                                     |
| **What they get** | Universe governance tokens (voting power + speculative value)                 |
| **Platform take** | 20% of LP fee on every swap (LoarHookStaticFee)                               |
| **Anti-rug**      | All LP tokens locked via LoarLpLockerMultiple                                 |
| **Token supply**  | 100B per universe, entire supply initially deposited as LP                    |
| **On-chain**      | LoarHook + LoarFeeLocker + LoarLpLocker — fully deployed                      |
| **Status**        | LIVE on Sepolia — pool created at universe deployment, but no swap UI in LOAR |

### 10. Merch (Shell Only)

| Aspect       | Detail                                                              |
| ------------ | ------------------------------------------------------------------- |
| **Who pays** | Fans buying physical merchandise                                    |
| **On-chain** | LicensingRegistry includes merch item creation + purchase tracking  |
| **Status**   | SHELL — API endpoints exist, no fulfillment partner, no real orders |

---

## Ownership Model

### What Creators Own

| Asset             | Ownership                                                   | Evidence                                             |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| Universe contract | Creator is admin/owner                                      | On-chain, immutable                                  |
| Governance token  | Initially all supply → LP pool. Creator gets team fee claim | On-chain via UniverseManager                         |
| Content IP        | Creator declares ownership at upload                        | Off-chain declaration, enforced by platform          |
| Revenue           | Direct to creator wallet (minus platform fees)              | On-chain for NFTs/tokens, off-chain for credits/subs |

### What the Platform Owns

| Asset                             | How                                         |
| --------------------------------- | ------------------------------------------- |
| Platform fee from NFT mints       | Configurable bps set in EpisodeNFT contract |
| 20% of Uniswap swap fees          | Hardcoded in LoarHookStaticFee              |
| Credit sale revenue               | 100% (credits are a platform service)       |
| Platform fee from subscriptions   | Configurable bps in SubscriptionManager     |
| Platform fee from canon licensing | Configurable bps in CanonMarketplace        |

### What Fans Own

| Asset             | Rights                                                    |
| ----------------- | --------------------------------------------------------- |
| Episode NFTs      | ERC721 ownership + potential resale royalties to creator  |
| Character NFTs    | ERC721 ownership + appearance royalty accumulation        |
| Governance tokens | Voting power + speculative value + subscription discounts |
| Subscriptions     | Time-limited access to tiered features                    |
| Credits           | Spendable on AI generation (non-transferable)             |

---

## Unit Economics (Estimated)

| Cost Center                                     | Estimated Cost                                 |
| ----------------------------------------------- | ---------------------------------------------- |
| AI Video Generation (FAL)                       | ~$0.03-0.10 per video (model-dependent)        |
| AI Image Generation (FAL)                       | ~$0.01-0.03 per image                          |
| AI Wiki Generation (Gemini/OpenAI)              | ~$0.005 per generation                         |
| Firestore reads/writes                          | ~$0.0001-0.001 per operation                   |
| Decentralized storage (Pinata/IPFS, Lighthouse) | ~$0.001-0.01 per MB                            |
| Sepolia gas                                     | Free (testnet). Mainnet L2: ~$0.01-0.10 per tx |

**Key insight:** The platform's primary variable cost is AI generation. Credits must be priced above AI API cost to be margin-positive. Current pricing (5 credits per video) needs validation against actual FAL costs.

---

## What's NOT Monetized Yet

| Gap                               | Impact                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| No fiat on-ramp                   | Limits users to crypto-native audience                          |
| No secondary NFT marketplace      | Users must use OpenSea or similar for resales                   |
| No creator payout dashboard       | Creators can't see consolidated earnings                        |
| No automated royalty distribution | Some streams require manual platform action                     |
| Credits have no real payment      | `credits.purchase` records to Firestore but doesn't collect ETH |
