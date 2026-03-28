# LOAR Mobile — Workstream 3: Market, Shop, and Seller Tools

**Product:** LOAR Mobile Market
**Workstream:** 3 of 3 (parallel with Workstream 1: Creator Studio, Workstream 2: Explore and Governance)
**Platform:** React Native (Expo) — shares auth, tRPC client, and contract ABIs with the web app
**Date:** 2026-03-28
**Status:** PRD — not yet in development

---

## Goal

Give creators a single mobile surface where every dollar they earn is visible and actionable, and give buyers a single mobile surface where everything in a universe can be discovered and purchased — without opening a desktop browser or a separate app.

---

## Problem

Every revenue stream in LOAR is partially built but isolated. A creator who wants to understand how much money their universe is making has to check: `nft.getEpisodesByUniverse`, `subscriptions.getUniverseStats`, `ads.getSponsorships`, `licensing.getLicenses`, `universeTreasury.getPoolBalance`, and `marketplace.mySubmissions` — six separate endpoints, no aggregated view, no mobile UI for any of them.

A fan who wants to support a creator has to know, in advance, that the option exists. There is no storefront for a universe. There is no "here are all the ways you can support this world" page. Monetization options are buried in disparate tabs with no purchase flow wired to the frontend.

The result: money that should be moving is not. The platform has at least seven working revenue-stream backends. The UI wires zero of them into a coherent checkout experience for a buyer or a coherent earnings view for a seller.

---

## Vision

Open a universe on mobile. See its storefront. Buy what you want — episode NFT, subscription, merch, canon license, ad slot — in under three taps with your CDP embedded wallet. As a creator, open your Seller Hub and see: total earned this month, breakdown by stream, pending payouts, one-tap listing tools, and your sponsor inbox. Both sides of the market live in one app. Neither requires a desktop.

---

## Users

**Primary seller persona — independent IP creator ("The Architect"):**
Building a narrative universe on LOAR. Primarily on mobile. Posts updates, manages listings, responds to collab proposals, and checks earnings while commuting. Cannot be asked to open a laptop to list an NFT or see their revenue.

**Primary buyer persona — narrative fan ("The Collector"):**
Discovered a universe through social, Workstream 2 explore feed, or word of mouth. Wants to own a piece of it. Has a CDP wallet or can create one in-app. Comfortable spending ETH in small amounts. Does not need to understand Web3 to complete a purchase.

**Secondary buyer persona — brand sponsor ("The Sponsor"):**
Marketing team for a brand. Looking for niche narrative audiences on emerging platforms. Wants to place a product, character, or audio mention inside a specific universe. Needs to browse available ad slots, understand the audience size, submit a bid, and receive a pitch-ready impression report.

**Secondary seller persona — collaborating creator ("The Co-Author"):**
Has an established universe and wants to expand by bringing in guest creators. Needs to post open collab calls, review applicants, activate agreements, and track joint episode revenue splits.

---

## Success Metrics

| Metric | Target (90 days post-launch) |
|--------|------------------------------|
| Creators who view Seller Hub at least once per week | >60% of active creators |
| Average time from "open universe storefront" to completed purchase | <90 seconds |
| Completed NFT mint transactions via mobile (not web) | >40% of total mints |
| Creator subscription tier configuration rate | >50% of universe owners configure at least one paid tier |
| Sponsor bids submitted via mobile ad slot browser | >10 per month |
| Open collab calls with at least one applicant | >20 per month |
| Creator payout awareness (viewed earnings at least once) | >80% of earners |

---

## Scope

### In scope

- Seller Hub: unified earnings dashboard aggregating all revenue streams per universe
- Universe Storefront: buyer-facing page showing all purchasable items for a universe, organized by type
- Episode NFT: list (single and bulk), buy (mint), view owned collection
- Character NFT: list, buy, view with appearance royalty tracker
- Subscription tiers: configure (seller), subscribe (buyer), manage (both)
- Merch: list items, browse, purchase (shell fulfillment — records order, no physical shipping integration)
- Canon marketplace: submit, vote, license accepted canon
- IP licensing: request a license from a creator (new buyer-initiated flow), creator accept/counter/reject
- Ad slot manager: create slots, view bids, accept sponsor (seller); browse slots, place bid, view placement (sponsor/buyer)
- Collab marketplace: post open collab call (new), browse calls, apply, accept, activate, track revenue split
- Direct tip: send ETH tip to creator from universe page (new endpoint required)
- Seller analytics: per-universe revenue chart, per-stream breakdown, recent transactions, exportable CSV
- Impression report: read endpoint for ad slot impressions (new), shareable sponsor pitch card

### Out of scope

- Fiat on-ramp (listed in GTM Phase 3 prerequisites — deferred)
- Secondary NFT marketplace (OpenSea handles resale; LOAR does not build a resale exchange)
- Token trading / Uniswap v4 swap UI (separate workstream, complex regulatory surface)
- Physical merch fulfillment integration (Printful, etc. — shell only; records intent, fulfillment is manual)
- Automated royalty distribution (on-chain; depends on contract audit completion)
- Admin review queue for Rights-Cleared content (covered in rights-classification-ui.md, implemented on web)
- Fan-to-fan resale of owned NFTs (deferred)

---

## Core UX

The Market tab in the mobile app is split into two perspectives, toggled at the top of the screen: **Buy** (default for fans) and **Sell** (default for creators). The toggle is persistent — if a user's primary wallet owns at least one universe, it defaults to Sell. Otherwise it defaults to Buy.

### Buy perspective

The Buy perspective is universe-centric. A universe's storefront is the primary unit of commerce. A fan arrives at a storefront either from the Explore tab (Workstream 2) or from a direct share link. Every monetization option the creator has configured is presented on one scrollable page, organized in sections. Nothing is hidden behind tabs. If a section is empty (no subscription tiers configured, no merch listed), it is omitted rather than shown empty.

The purchase flow is three steps for every item type: (1) item detail sheet slides up, (2) confirm + sign with CDP wallet, (3) success screen with share prompt. Gas is shown in ETH and approximate USD. If the user's balance is insufficient, the flow surfaces a fiat on-ramp placeholder ("Add funds — coming soon").

### Sell perspective

The Sell perspective is universe-centric on the creator side. If the creator owns multiple universes, a universe picker appears at the top. Below it: the Seller Hub for the selected universe.

The Seller Hub is a dashboard-first design. Revenue is the headline. Below the headline number: a sparkline for the last 30 days, then a stream-by-stream breakdown (Episode NFTs, Subscriptions, Licensing, Ads, Collabs, Treasury). Each stream row is tappable — tapping navigates to that stream's management screen.

All listing and configuration tools are reachable from the Seller Hub within two taps.

---

## Functional Requirements

### FR-1: Universe Storefront (Buyer-Facing)

**1.1** Display universe name, cover image, creator handle, and follower/subscriber count at the top of the storefront.

**1.2** Display rights classification badge (`original` / `licensed` / `fan`) per the rights-classification-ui spec. Fan-lane universes suppress all purchase sections.

**1.3** Episode NFT section: renders a horizontal scroll of episode cards from `nft.getEpisodesByUniverse`. Each card shows: episode title, thumbnail, price in ETH, minted/max supply ratio, rights badge. Tapping opens the episode detail sheet. The "Mint" button in the sheet calls `nft.mintContent` via `writeContract` on the EpisodeNFT.sol contract, then calls `nft.recordMint` to log.

**1.4** Subscription section: renders tier cards from `subscriptions.getTiers`. Each card shows: tier name (FREE / BASIC / PREMIUM / VIP), monthly price, feature bullets (early access, voting boost, premium content, behind-the-scenes, credit bonus). Tapping an active tier calls `subscriptions.subscribe`. Tapping a tier the user already holds navigates to subscription management (cancel, renew).

**1.5** Merch section: renders merch items from `licensing.getMerch` filtered by `universeId`. Each item shows: image, name, price, category (physical/digital). Tapping opens item detail with size/variant selectors if applicable and a "Buy" button that calls `licensing.purchaseMerch`. Records the order in Firestore; fulfillment is manual.

**1.6** Canon Marketplace section: renders accepted canon submissions from `marketplace.getCanon`. Shows submissions available for licensing with a "License This Canon" button that calls `marketplace.licenseCanon`. Voting-phase submissions are shown with a vote count and a "Vote" button.

**1.7** IP Licensing section: a single CTA — "Request a License" — that opens a negotiation form (new buyer-initiated flow; see FR-7). Only shown for `original` and approved `licensed` universes.

**1.8** Ad Slots section (visible to sponsors only — gated behind a "Sponsor This Universe" toggle): renders open ad slots from `ads.getSlotsByUniverse` filtered to `active: true`. Each slot shows: placement type (BILLBOARD / PRODUCT / SPONSORED_CHARACTER / AUDIO_MENTION), episode count, minimum bid in ETH. Tapping opens the bid form.

**1.9** Tip section: a "Support the Creator" button that opens a tip amount picker (0.001 / 0.005 / 0.01 / custom ETH). Calls `tips.sendTip` (new endpoint — see backend gaps). Always shown for `original` universes, never for `fan`.

**1.10** Share button: generates a deep link to the storefront. Copy, share sheet, QR code. No auth required to view a storefront — browse is always public.

---

### FR-2: Episode NFT Listing (Seller)

**2.1** "List Episode as NFT" action from the Seller Hub episode management screen. Input fields: episode title, thumbnail, mint price (ETH), max supply (or unlimited), royalty percentage (default 5%). Calls `nft.createEpisodeListing`. Single-episode flow.

**2.2** Bulk listing tool: a multi-select screen that shows all unlisted episodes for the universe (from `content.routes.ts` filtered by `universeId` and `listed: false`). Creator selects multiple episodes, sets a shared price or per-episode prices, sets shared supply or per-episode supply. Submits as a batch — client sends one `nft.createEpisodeListing` call per episode in sequence (no new batch endpoint required; parallelized client-side with progress indicator). New work: client must handle partial failure gracefully — show which listings succeeded and which failed with retry.

**2.3** Listing management: edit price, deactivate listing (`nft.deactivateEpisode`), view mint count per episode. Read from `nft.getEpisodesByUniverse`.

**2.4** Rights gate: the listing form is blocked with an explanatory screen if the universe is classified `fan`. Copy: "This universe is marked Non-Commercial. To list Episode NFTs, update your universe classification to Creator-Owned and complete the originality declaration."

---

### FR-3: Character NFT Listing (Seller) and Purchase (Buyer)

**3.1** "Create Character NFT" from the Seller Hub character management screen. Input: character name, appearance image, backstory (optional), royalty bps. Calls `nft.createCharacterNFT`. Confirms on-chain via CharacterNFT.sol.

**3.2** Character gallery on the storefront: renders from `nft.getCharactersByUniverse`. Each card shows: name, image, appearance royalty rate, whether available for mint. Tapping opens character detail with mint button. Calls `nft.mintContent` then `nft.recordMint`.

**3.3** Owned character panel (buyer): within the user's profile/collection view, shows all owned character NFTs. For each: name, universe, appearance royalty accumulation (read from CharacterNFT.sol via wagmi `useReadContract` on `accumulatedRoyalties(tokenId)`), claim button (calls contract directly; no existing tRPC endpoint — new `nft.claimCharacterRoyalties` procedure needed).

---

### FR-4: Subscription Management (Seller and Buyer)

**4.1** Tier configuration screen (seller): four tier cards (FREE / BASIC / PREMIUM / VIP). Each card is an editable form: price per month in ETH, toggles for each feature flag (earlyAccess, votingBoost, premiumContent, behindTheScenes), credit bonus number input. Save calls `subscriptions.configureTier`. Setting price to 0 saves the tier as free. Deleting a tier requires confirming that existing subscribers will lose access at renewal.

**4.2** Universe stats panel (seller): shows subscriber counts per tier from `subscriptions.getUniverseStats`. Monthly recurring revenue estimate (active subscribers × monthly price, computed client-side). Churn rate (requires new field on `subscriptionRevenue` collection — see data model changes).

**4.3** Subscription purchase (buyer, covered in FR-1.4 but expanded here): before confirming, show a feature comparison table of all tiers. Allow upgrade from a lower tier to a higher one within the same universe — calls `subscriptions.subscribe` with the new tier; prorated credit is not calculated (full price applies). Cancel any time from the "My Subscriptions" screen which reads `subscriptions.mySubscriptions`.

**4.4** Access gate enforcement on content (buy side): before rendering premium content in the Explore or player view, client calls `subscriptions.hasAccess` with `universeId` and `tier`. If not authorized, shows an upsell card for the correct tier.

---

### FR-5: Merch (Seller and Buyer)

**5.1** Create merch item (seller): form fields — item name, description, image, price in ETH, category (physical / digital), max quantity (or unlimited), SKU variants (sizes, colors — stored as a string array). Calls `licensing.createMerch`.

**5.2** Merch management (seller): list from `licensing.myMerch`. Edit price, deactivate, view order count from `licensing.getOrders`.

**5.3** Purchase merch (buyer): covered in FR-1.5. The detail sheet adds a fulfillment expectation disclosure: "Physical items ship within 30 business days. Fulfillment is managed directly by the creator." No tracking integration in this workstream.

**5.4** Royalty recording (seller): `licensing.recordRoyalty` is called server-side when a merch order is recorded. No seller action required.

---

### FR-6: Canon Marketplace (Both Sides)

**6.1** Submit to canon (buyer/community): form — submission type (CHARACTER / PLOT_ARC / LOCATION / LORE_RULE), title, description, attach content (file upload or existing content hash). Optional: submission fee tx hash if the universe charges a fee. Calls `marketplace.submit`.

**6.2** Vote on submission (buyer/fan): from the submission detail screen, vote For or Against. Weight is the user's governance token balance for the universe (read from contract via wagmi `useReadContract`). Calls `marketplace.vote`.

**6.3** Finalize submission (seller/creator): a notification appears when a submission's voting deadline has passed. One-tap "Finalize" calls `marketplace.finalize`. The result (ACCEPTED / REJECTED) is shown with vote tallies. Accepted submissions are pinned to IPFS automatically server-side.

**6.4** License accepted canon (buyer): from the Canon section of the storefront, tapping "License This Canon" opens a detail sheet with: submission title, content preview, creator, license fee in ETH. Buyer sends ETH transaction, then calls `marketplace.licenseCanon` with the tx hash. Platform fee is deducted server-side per `getPlatformFee`.

**6.5** My submissions (creator/contributor): a "My Submissions" tab within the Canon section lists all the user's submissions across all universes from `marketplace.mySubmissions`. Status badges (VOTING / ACCEPTED / REJECTED). Tap to view vote tally and finalization CTA.

---

### FR-7: IP Licensing — Buyer-Initiated Negotiation Flow (New)

The existing `licensing.createLicense` procedure is seller-initiated. There is no buyer-facing flow. This workstream adds one.

**7.1** "Request a License" form (buyer): opened from the storefront's IP Licensing section. Fields: intended use (z.enum — streaming, merch, gaming, comic, audio, other), territory, proposed term, proposed fee in ETH, message to creator. Submits via new `licensing.requestLicense` procedure (see backend gaps).

**7.2** Negotiation inbox (seller): within the Seller Hub, a "License Requests" section lists incoming requests from `licensing.getLicenseRequests` (new endpoint). Each request shows: requester wallet, intended use, proposed fee, message. Creator can: Accept (calls `licensing.createLicense` with agreed terms + marks request resolved), Counter (sends a counter-offer message, mutates request status to `countered`), or Reject (mutates status to `rejected`). Counter-offer is a simple message field; full negotiation is not automated — the flow supports one round of counter.

**7.3** Accepted license confirmation: when a creator accepts a request, the buyer receives an in-app notification and can view the active license from their "My Licenses" screen. `licensing.activateLicense` is called server-side when the on-chain transaction confirms.

**7.4** Rights-gating: license requests are only available for `original` and approved `licensed` universes. Fan-lane universes suppress the CTA and show: "This is Non-Commercial content. IP licensing is not available."

---

### FR-8: Ad Slots and Sponsor Tools (Both Sides)

**8.1** Create ad slot (seller): form — placement type (BILLBOARD / PRODUCT / SPONSORED_CHARACTER / AUDIO_MENTION), episode count, minimum bid in ETH, description, content constraints (optional brand safety notes). Calls `ads.createSlot`. Slot appears on the storefront's Ad Slots section (visible to sponsors).

**8.2** Bid management (seller): "Sponsor Inbox" within the Seller Hub lists all slots with their current highest bid from `ads.getBids`. Tapping a slot shows all bids with brand name, creative URL, and bid amount. "Accept" calls `ads.acceptBid` and deactivates the slot for further bids. Accepted sponsor is shown as a confirmed placement.

**8.3** Place a bid (buyer/sponsor): from the storefront's Ad Slots section (visible when "Sponsor This Universe" is toggled on), selecting a slot opens the bid form. Fields: bid amount in ETH (must exceed minimum), brand name, creative URL (optional — poster/logo). Submits ETH transaction, then calls `ads.placeBid`.

**8.4** Impression report (new read endpoint required): the existing `ads.recordImpression` is write-only. A new `ads.getImpressions` procedure is needed (see backend gaps). The seller can view impression counts per slot from the Seller Hub — total impressions, impressions per episode, date range. A "Share Pitch Card" button generates a read-only summary card (universe name, slot type, audience stats from `analytics.getUniverseMetrics`, impression count) as a sharable image or PDF. This is the primary tool for persuading sponsors to bid.

**8.5** Sponsorship tracking (buyer/sponsor): sponsors can view their active sponsorships from `ads.mySponsorships`. Each shows: universe, slot type, episode count, impression count (from new `ads.getImpressions`), status (active / completed).

---

### FR-9: Collab Marketplace (Both Sides) — New Discovery Layer

The existing `collabs.propose` is a direct proposal — you must know the collaborator's universe address. There is no open call mechanism. This workstream adds one.

**9.1** Post open collab call (seller): form — title ("Looking for a co-creator for a cyberpunk arc"), description, desired contributor role (z.enum — writer, artist, voice_actor, worldbuilder, other), revenue split offered to collaborator (bps), episode count, application deadline. Submits via new `collabs.createOpenCall` procedure (see backend gaps). Published to the collab feed.

**9.2** Collab feed (buyer/creator): a browsable feed of open collab calls across all universes. Filterable by role, revenue split range, and universe genre (genre tag from universe metadata). Read from new `collabs.listOpenCalls` procedure. Renders call cards with: universe name, creator handle, role wanted, rev split, deadline.

**9.3** Apply to collab call: tapping an open call shows the full description. An "Apply" button opens a form — message to creator, portfolio link (optional). Submits via new `collabs.applyToCall` procedure. Creator is notified.

**9.4** Review applications (seller): "Collab Applications" section in the Seller Hub lists incoming applications per open call from new `collabs.getApplications`. Creator can Accept (transitions to a standard `collabs.propose` with the applicant's universe address pre-filled, terms from the call) or Decline.

**9.5** Standard collab management: once a collab is proposed (via 9.4 or directly), existing endpoints take over. `collabs.accept`, `collabs.activate`, `collabs.complete`, `collabs.cancel`. Episode recording calls `collabs.recordEpisode`. Revenue split from `collabs.getByUniverse`.

**9.6** My collabs (both): a "My Collabs" screen lists all active and past collaborations from `collabs.myCollabs`. Shows status (PROPOSED / ACTIVE / COMPLETED / CANCELLED), revenue split, episode count, and joint earnings if completed.

---

### FR-10: Seller Hub — Unified Earnings Dashboard (New Aggregation Required)

**10.1** Earnings headline: total ETH earned across all streams in the selected time range (7d / 30d / 90d / all-time). Computed by a new server-side aggregation endpoint `seller.getEarningsSummary` (see backend gaps). Displayed as both ETH value and approximate USD (USD rate fetched from a public price oracle or hardcoded for testnet).

**10.2** Stream breakdown: a horizontal scroll of stream cards below the headline. Each card: stream name (Episode NFTs, Subscriptions, Licensing, Ads, Collabs, Treasury, Tips), earnings for the period, delta vs. prior period (arrow up/down). Tapping navigates to that stream's management screen.

**10.3** Revenue chart: a 30-bar daily bar chart (one bar per day) using a lightweight charting library (Victory Native or react-native-gifted-charts). Bars are color-coded by dominant stream. Tap a bar to see the breakdown for that day.

**10.4** Recent transactions: a scrollable list of the last 20 transactions across all streams. Each row: date, stream type, item name, amount in ETH, buyer wallet (abbreviated). Read from `analytics.getRecentActivity` with a new `asEarner: true` filter that scopes to transactions where the authenticated user is the seller.

**10.5** Pending payouts: some streams (treasury distributions, collab revenue) may have unclaimed balances on-chain. A "Pending" section reads `universeTreasury.getPoolBalance` and `collabs.getByUniverse` filtered for completed collabs with unclaimed distributions. Shows claimable amounts with one-tap claim buttons. Claim actions call the relevant on-chain contracts directly via wagmi.

**10.6** Export: "Export CSV" button calls `analytics.exportUniverseData` with date range. Triggers a file download on device.

---

### FR-11: Direct Tip Flow (New Endpoint Required)

**11.1** The "Support the Creator" button on any `original`-lane universe storefront opens a tip amount selector. Preset amounts: 0.001 ETH / 0.005 ETH / 0.01 ETH / custom. User enters the custom amount in ETH. A brief message field is optional (max 140 chars).

**11.2** Tapping "Send Tip" signs and broadcasts an ETH transfer directly to the creator's wallet address. After transaction confirms, client calls new `tips.recordTip` procedure (see backend gaps) to log the event.

**11.3** Creator receives an in-app notification: "[wallet address] tipped you [amount] ETH — [message if any]". Tip appears in the Seller Hub recent transactions list and is counted in the earnings summary.

**11.4** Tipping is not available for `fan`-lane universes or for the creator's own universe (sender === creator wallet is checked client-side and suppressed in the CTA).

---

### FR-12: Analytics for Sellers

**12.1** Universe Metrics screen: calls `analytics.getUniverseMetrics`. Displays: total views, unique wallets, episode plays, mint count, subscriber count, tip count. Date-range filterable.

**12.2** Episode Metrics screen: calls `analytics.getEpisodeMetrics` for a selected episode. Displays: views, play-through rate, mint conversions, tip conversions.

**12.3** Trending panel: calls `analytics.getTrending`. Shows the creator's top-performing content by engagement in the last 7 days. Displayed as a ranked list.

**12.4** Sponsor Pitch Card (from FR-8.4): composited from `analytics.getUniverseMetrics` + new `ads.getImpressions` data. Exportable as a PNG or shared via share sheet.

---

## Technical Approach

### Client Stack

- **Framework:** React Native with Expo SDK 52+ (managed workflow for OTA updates)
- **Navigation:** Expo Router (file-based, mirrors TanStack Router conventions from the web app)
- **State / data fetching:** TanStack Query — same query keys and cache invalidation logic as the web app where endpoints are shared
- **tRPC client:** `@trpc/react-query` — reuse `apps/web/src/utils/trpc.ts` pattern, extract to a shared `packages/trpc-client` package (or duplicate and keep in sync until package extraction is prioritized)
- **Auth:** CDP Embedded Wallet (same SIWE JWT flow as web app — `useWalletAuth` hook adapted for React Native). CDP's React Native SDK or a WebView bridge for the embedded wallet modal.
- **Contracts:** wagmi — confirm React Native compatibility; fallback to `viem` direct calls if wagmi's React hooks don't support RN. Contract ABIs from `packages/abis`.
- **Charts:** `react-native-gifted-charts` — lightweight, no native dependencies beyond React Native core
- **File handling:** `expo-document-picker` for merch image uploads, `expo-sharing` for sponsor pitch card export
- **Push notifications:** `expo-notifications` for seller inbox alerts (tip received, bid received, collab application received, license request received)

### Backend Reuse

The following tRPC procedures are called exactly as-is from the mobile client. No backend changes required for these paths:

| Procedure | Used in |
|-----------|---------|
| `nft.createEpisodeListing` | FR-2.1 |
| `nft.deactivateEpisode` | FR-2.3 |
| `nft.getEpisodesByUniverse` | FR-1.3, FR-2.3 |
| `nft.recordMint` | FR-1.3 |
| `nft.getCharactersByUniverse` | FR-3.2 |
| `nft.createCharacterNFT` | FR-3.1 |
| `subscriptions.configureTier` | FR-4.1 |
| `subscriptions.getTiers` | FR-1.4, FR-4.3 |
| `subscriptions.getUniverseStats` | FR-4.2 |
| `subscriptions.subscribe` | FR-4.3 |
| `subscriptions.cancel` | FR-4.3 |
| `subscriptions.hasAccess` | FR-4.4 |
| `subscriptions.mySubscriptions` | FR-4.3 |
| `licensing.createMerch` | FR-5.1 |
| `licensing.getMerch` | FR-1.5 |
| `licensing.getOrders` | FR-5.2 |
| `licensing.purchaseMerch` | FR-1.5 |
| `licensing.myMerch` | FR-5.2 |
| `licensing.recordRoyalty` | FR-5.4 (server-side) |
| `licensing.createLicense` | FR-7.2 |
| `licensing.activateLicense` | FR-7.3 |
| `licensing.getLicenses` | FR-7 |
| `marketplace.submit` | FR-6.1 |
| `marketplace.vote` | FR-6.2 |
| `marketplace.finalize` | FR-6.3 |
| `marketplace.licenseCanon` | FR-6.4 |
| `marketplace.getByUniverse` | FR-6 |
| `marketplace.getCanon` | FR-1.6 |
| `marketplace.getSubmission` | FR-6.5 |
| `marketplace.getVotes` | FR-6.2 |
| `marketplace.getPlatformFee` | FR-6.4 |
| `marketplace.mySubmissions` | FR-6.5 |
| `ads.createSlot` | FR-8.1 |
| `ads.getBids` | FR-8.2 |
| `ads.acceptBid` | FR-8.2 |
| `ads.placeBid` | FR-8.3 |
| `ads.recordImpression` | background, server-side |
| `ads.getSlotsByUniverse` | FR-1.8, FR-8.3 |
| `ads.getSponsorships` | FR-8.5 |
| `ads.mySponsorships` | FR-8.5 |
| `collabs.propose` | FR-9.4 |
| `collabs.accept` | FR-9.5 |
| `collabs.activate` | FR-9.5 |
| `collabs.complete` | FR-9.5 |
| `collabs.cancel` | FR-9.5 |
| `collabs.getByUniverse` | FR-9.6 |
| `collabs.getCollab` | FR-9.6 |
| `collabs.getEpisodes` | FR-9.6 |
| `collabs.recordEpisode` | FR-9.5 |
| `collabs.myCollabs` | FR-9.6 |
| `universeTreasury.getPoolBalance` | FR-10.5 |
| `universeTreasury.getPoolHistory` | FR-10 |
| `analytics.getUniverseMetrics` | FR-12.1 |
| `analytics.getEpisodeMetrics` | FR-12.2 |
| `analytics.getRecentActivity` | FR-10.4 |
| `analytics.getTrending` | FR-12.3 |
| `analytics.exportUniverseData` | FR-10.6 |
| `credits.getBalance` | Seller Hub sidebar |
| `profiles.getByUid` | Storefront creator card |

### New Backend Work Required

The following endpoints do not exist and must be built. These are listed in dependency order — items higher in the list unblock lower ones.

---

#### NEW-1: `seller.getEarningsSummary`

**Location:** New file `apps/server/src/routers/seller/seller.routes.ts`

**Procedure type:** `protectedProcedure` — scoped to authenticated user

**Input:**
```ts
z.object({
  universeId: z.string(),
  range: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
})
```

**Output:** Aggregated earnings object:
```ts
{
  totalEthWei: string,
  byStream: {
    episodeNfts: string,      // wei — from nft mints where creatorUid === uid
    subscriptions: string,    // wei — from subscriptionRevenue where creatorUid === uid
    licensing: string,        // wei — from licensing royalties
    ads: string,              // wei — from accepted ad bids
    collabs: string,          // wei — from collab revenue splits
    treasury: string,         // wei — from treasury pool distributions
    tips: string,             // wei — from tips collection (NEW-4)
    canonLicensing: string,   // wei — from marketplaceSales where sellerUid === uid
  },
  transactionCount: number,
  periodStart: Date,
  periodEnd: Date,
}
```

**Implementation:** Fan-out read across `marketplaceSales`, `subscriptionRevenue`, `tipRecords` (new), and `collabDistributions` (new field on completed collabs) Firestore collections, filtered by `creatorUid` and date range. Aggregated server-side. No cross-collection joins possible in Firestore without a denormalized summary document — recommend writing a running summary document per creator per universe updated on each sale event, and reading from that summary document rather than scanning all collections at query time.

**Firestore design:** `creatorEarnings/{uid}_{universeId}` document updated by server-side triggers (or inline in each mutation that records a payment). Fields: running totals by stream, last updated timestamp. `getEarningsSummary` reads this document + applies date filtering from a `dailyEarnings` subcollection.

---

#### NEW-2: `ads.getImpressions`

**Location:** `apps/server/src/routers/ads/ads.routes.ts`

**Procedure type:** `protectedProcedure` (seller) and `publicProcedure` (for sponsor pitch card share link)

**Input:**
```ts
z.object({
  slotId: z.string(),
  range: z.enum(['7d', '30d', '90d', 'all']).default('30d'),
})
```

**Output:**
```ts
{
  slotId: string,
  totalImpressions: number,
  byEpisode: Array<{ episodeId: string, episodeTitle: string, impressions: number }>,
  byDay: Array<{ date: string, impressions: number }>,
  lastImpressionAt: Date | null,
}
```

**Implementation:** `ads.recordImpression` currently writes to an `adImpressions` collection (implied by the write endpoint). Confirm collection name in implementation. Query by `slotId` and date range. Aggregate by episode and by day client-side or in a Cloud Function depending on volume.

**Note:** The `ads.recordImpression` write procedure needs an `episodeId` field added to its input schema so per-episode breakdowns are possible. This is a minor additive change.

---

#### NEW-3: `licensing.requestLicense` and `licensing.getLicenseRequests`

**Location:** `apps/server/src/routers/licensing/licensing.routes.ts`

**`requestLicense` — protectedProcedure:**
```ts
z.object({
  universeId: z.string(),
  intendedUse: z.enum(['streaming', 'merch', 'gaming', 'comic', 'audio', 'other']),
  territory: z.string().max(200),
  proposedTerm: z.string().max(200),  // e.g. "12 months", "perpetual"
  proposedFeeEth: z.string(),          // decimal string, e.g. "0.5"
  message: z.string().max(1000).optional(),
})
```

Creates a document in a new `licenseRequests` Firestore collection with status `pending`. Notifies the universe creator (write to a notifications collection or trigger a push notification via NEW-5).

**`getLicenseRequests` — protectedProcedure:**
```ts
z.object({
  universeId: z.string(),
  status: z.enum(['pending', 'countered', 'accepted', 'rejected', 'all']).default('pending'),
})
```

Returns requests where the authenticated user is the universe creator. Adds `creatorUid` check.

**`respondToLicenseRequest` — protectedProcedure:**
```ts
z.object({
  requestId: z.string(),
  action: z.enum(['accept', 'counter', 'reject']),
  counterMessage: z.string().max(1000).optional(),  // required if action === 'counter'
  agreedTerms: z.object({ ... }).optional(),         // required if action === 'accept', passes to createLicense
})
```

On `accept`: calls through to `createLicense` logic internally, marks request as `accepted`. On `counter`: updates status to `countered`, sets `counterMessage`. On `reject`: updates status to `rejected`.

---

#### NEW-4: `tips.recordTip` and `tips.getByUniverse`

**Location:** New file `apps/server/src/routers/tips/tips.routes.ts`

**`recordTip` — protectedProcedure:**
```ts
z.object({
  universeId: z.string(),
  creatorAddress: z.string(),   // recipient wallet, verified against universe owner
  amountWei: z.string(),
  txHash: z.string(),
  message: z.string().max(140).optional(),
})
```

Writes to a `tipRecords` Firestore collection. Verifies that `creatorAddress` matches the universe's owner address (prevents misdirected tip records). Updates the `creatorEarnings` summary document (see NEW-1). Triggers a push notification to the creator (see NEW-5).

**`getByUniverse` — protectedProcedure (creator-only view):**
```ts
z.object({ universeId: z.string(), limit: z.number().default(50) })
```

Returns tip records for the universe ordered by `createdAt` desc. Only accessible to the universe owner.

**Note on the on-chain flow:** The ETH transfer itself is a direct `sendTransaction` from the buyer's wallet to the creator's wallet — no contract interaction, no platform fee. `recordTip` is called after the transaction confirms to create the audit trail and update earnings. This means platform takes 0% of tips. That is intentional — tips are a creator-loyalty feature, not a revenue stream for the platform.

---

#### NEW-5: `collabs.createOpenCall`, `collabs.listOpenCalls`, `collabs.applyToCall`, `collabs.getApplications`

**Location:** `apps/server/src/routers/collabs/collabs.routes.ts`

**`createOpenCall` — protectedProcedure:**
```ts
z.object({
  universeId: z.string(),
  title: z.string().min(1).max(200),
  description: z.string().min(10).max(2000),
  role: z.enum(['writer', 'artist', 'voice_actor', 'worldbuilder', 'other']),
  revSplitBps: z.number().min(100).max(5000),  // 1%–50% to collaborator
  episodeCount: z.number().min(1),
  deadline: z.string(),  // ISO date
})
```

Writes to new `collabOpenCalls` collection with status `open`.

**`listOpenCalls` — publicProcedure:**
```ts
z.object({
  role: z.enum(['writer', 'artist', 'voice_actor', 'worldbuilder', 'other']).optional(),
  minRevSplitBps: z.number().optional(),
  limit: z.number().min(1).max(50).default(20),
  cursor: z.string().optional(),   // Firestore pagination cursor
})
```

Returns open calls ordered by `createdAt` desc. Filters by role and minimum rev split if provided. Deadline must be in the future (server-side filter).

**`applyToCall` — protectedProcedure:**
```ts
z.object({
  callId: z.string(),
  message: z.string().max(1000),
  portfolioUrl: z.string().url().optional(),
})
```

Writes to new `collabApplications` collection. One application per user per call (duplicate check). Notifies call creator.

**`getApplications` — protectedProcedure:**
```ts
z.object({ callId: z.string() })
```

Returns applications for a call. Verified that authenticated user owns the universe the call belongs to.

---

#### NEW-6: Push Notification Dispatch

Not a tRPC procedure — a server-side utility called by mutation handlers.

**Location:** `apps/server/src/services/notifications.ts`

When the following events occur, a push notification is dispatched to the relevant user's registered Expo push token (stored in a `pushTokens/{uid}` Firestore document when the user grants notification permission in the mobile app):

| Event | Recipient | Message |
|-------|-----------|---------|
| Tip received | Creator | "[address] tipped [amount] ETH" |
| License request received | Creator | "[address] requested a license for [universe]" |
| License response received | Requester | "Creator responded to your license request" |
| Ad bid received | Creator | "[brand] placed a [amount] ETH bid on your [slot type] slot" |
| Collab application received | Call creator | "New applicant for your [role] collab call" |
| Collab application accepted | Applicant | "Your collab application was accepted" |
| Canon submission finalized | Submitter | "Your submission was [ACCEPTED/REJECTED]" |

Uses Expo Push Notification API (`https://exp.host/--/api/v2/push/send`). Dispatch is fire-and-forget (non-fatal failure). Token registration endpoint: `notifications.registerToken` (simple write to `pushTokens` collection; no business logic).

---

### Data Model Changes

#### New Firestore Collections

| Collection | Written by | Read by |
|------------|-----------|---------|
| `tipRecords` | `tips.recordTip` | `tips.getByUniverse`, `seller.getEarningsSummary` |
| `creatorEarnings` | All payment mutations (updated inline) | `seller.getEarningsSummary` |
| `licenseRequests` | `licensing.requestLicense` | `licensing.getLicenseRequests`, `licensing.respondToLicenseRequest` |
| `collabOpenCalls` | `collabs.createOpenCall` | `collabs.listOpenCalls` |
| `collabApplications` | `collabs.applyToCall` | `collabs.getApplications` |
| `pushTokens` | `notifications.registerToken` | notification dispatch service |

#### Modified Collections / Documents

| Collection | Change |
|------------|--------|
| `adImpressions` | Add `episodeId` field (new field on `ads.recordImpression` input) |
| `subscriptionRevenue` | Add `creatorUid` field for earnings aggregation query (was implicit via `universeId`) |
| `sponsorships` (active) | Add `impressionCount` denormalized field, updated by `ads.recordImpression` server-side trigger |

#### No Schema Migrations Required for Existing Collections

The above are all additive changes. No existing documents need to be updated. The new fields are optional in read queries — old documents without them return `undefined`, which client code must handle with nullish coalescing.

---

## Screens List

The Market tab in the mobile app is one of the root tabs (alongside Explore and Create from Workstreams 2 and 1). All screens below live under the `/market/` route prefix in Expo Router.

### Buy-side screens

| Screen | Route | Primary data |
|--------|-------|-------------|
| Market home (Buy toggle) | `/market/` | `analytics.getTrending`, `nft.getEpisodesByUniverse` (featured) |
| Universe Storefront | `/market/universe/[universeId]` | Multiple — see FR-1 |
| Episode NFT detail + mint | `/market/universe/[universeId]/episode/[episodeId]` | `nft.getEpisodesByUniverse` |
| Character NFT detail + mint | `/market/universe/[universeId]/character/[characterId]` | `nft.getCharactersByUniverse` |
| Subscription tiers + subscribe | `/market/universe/[universeId]/subscribe` | `subscriptions.getTiers` |
| Merch item detail + buy | `/market/universe/[universeId]/merch/[itemId]` | `licensing.getMerch` |
| Canon submission detail + vote | `/market/universe/[universeId]/canon/[submissionId]` | `marketplace.getSubmission`, `marketplace.getVotes` |
| License canon flow | `/market/universe/[universeId]/canon/[submissionId]/license` | `marketplace.getPlatformFee` |
| Request IP license form | `/market/universe/[universeId]/license-request` | `licensing.requestLicense` (new) |
| Ad slot browser | `/market/universe/[universeId]/sponsor` | `ads.getSlotsByUniverse` |
| Place ad bid form | `/market/universe/[universeId]/sponsor/[slotId]/bid` | `ads.placeBid` |
| Collab feed (open calls) | `/market/collabs` | `collabs.listOpenCalls` (new) |
| Collab call detail + apply | `/market/collabs/[callId]` | `collabs.applyToCall` (new) |
| My purchased NFTs | `/market/my/nfts` | `nft.getEpisodesByUniverse` filtered by owner wallet |
| My subscriptions | `/market/my/subscriptions` | `subscriptions.mySubscriptions` |
| My collab applications | `/market/my/collabs` | `collabs.myCollabs` |
| My active sponsorships | `/market/my/sponsorships` | `ads.mySponsorships` |
| My licenses (as licensee) | `/market/my/licenses` | `licensing.getLicenses` |
| Tip confirmation sheet | (bottom sheet, modal) | `tips.recordTip` (new) |

### Sell-side screens

| Screen | Route | Primary data |
|--------|-------|-------------|
| Seller Hub (earnings dashboard) | `/market/sell/[universeId]` | `seller.getEarningsSummary` (new) |
| Episode NFT management | `/market/sell/[universeId]/episodes` | `nft.getEpisodesByUniverse` |
| Create/edit NFT listing | `/market/sell/[universeId]/episodes/[episodeId]/list` | `nft.createEpisodeListing` |
| Bulk episode listing | `/market/sell/[universeId]/episodes/bulk-list` | `nft.createEpisodeListing` (batched) |
| Character NFT management | `/market/sell/[universeId]/characters` | `nft.getCharactersByUniverse` |
| Create character NFT | `/market/sell/[universeId]/characters/create` | `nft.createCharacterNFT` |
| Subscription tier config | `/market/sell/[universeId]/subscriptions` | `subscriptions.configureTier`, `subscriptions.getUniverseStats` |
| Merch management | `/market/sell/[universeId]/merch` | `licensing.myMerch`, `licensing.getOrders` |
| Create merch item | `/market/sell/[universeId]/merch/create` | `licensing.createMerch` |
| Canon management + finalize | `/market/sell/[universeId]/canon` | `marketplace.getByUniverse`, `marketplace.finalize` |
| Ad slot manager | `/market/sell/[universeId]/ads` | `ads.getSlotsByUniverse`, `ads.getBids` |
| Create ad slot | `/market/sell/[universeId]/ads/create` | `ads.createSlot` |
| Sponsor inbox (bid review) | `/market/sell/[universeId]/ads/[slotId]/bids` | `ads.getBids`, `ads.acceptBid` |
| Impression report + pitch card | `/market/sell/[universeId]/ads/[slotId]/impressions` | `ads.getImpressions` (new) |
| License request inbox | `/market/sell/[universeId]/license-requests` | `licensing.getLicenseRequests` (new) |
| License request detail + respond | `/market/sell/[universeId]/license-requests/[requestId]` | `licensing.respondToLicenseRequest` (new) |
| Collab management | `/market/sell/[universeId]/collabs` | `collabs.getByUniverse`, `collabs.myCollabs` |
| Post open collab call | `/market/sell/[universeId]/collabs/open-call` | `collabs.createOpenCall` (new) |
| Collab applications inbox | `/market/sell/[universeId]/collabs/[callId]/applications` | `collabs.getApplications` (new) |
| Analytics overview | `/market/sell/[universeId]/analytics` | `analytics.getUniverseMetrics`, `analytics.getTrending` |
| Episode analytics | `/market/sell/[universeId]/analytics/episodes/[episodeId]` | `analytics.getEpisodeMetrics` |
| Earnings export | `/market/sell/[universeId]/analytics/export` | `analytics.exportUniverseData` |
| Tips received | `/market/sell/[universeId]/tips` | `tips.getByUniverse` (new) |
| Pending payouts | `/market/sell/[universeId]/payouts` | `universeTreasury.getPoolBalance`, `collabs.getByUniverse` |

---

## Dependencies

| Dependency | Owner | Blocking |
|------------|-------|---------|
| CDP Embedded Wallet React Native SDK (or WebView bridge) | Coinbase/external | Auth flow, all wallet transactions |
| `packages/abis` current build (EpisodeNFT.sol, CharacterNFT.sol, Universe.sol ABIs) | Internal (contracts team) | All on-chain write actions |
| wagmi RN compatibility or viem fallback decision | Internal (client team) | All on-chain reads/writes |
| NEW-1 `seller.getEarningsSummary` | Internal (backend team) | Seller Hub headline — cannot ship Seller Hub without this |
| NEW-2 `ads.getImpressions` | Internal (backend team) | Sponsor pitch card, impression report |
| NEW-3 `licensing.requestLicense` / `getLicenseRequests` / `respondToLicenseRequest` | Internal (backend team) | IP licensing buyer flow |
| NEW-4 `tips.recordTip` / `getByUniverse` | Internal (backend team) | Tip flow |
| NEW-5 `collabs.createOpenCall` / `listOpenCalls` / `applyToCall` / `getApplications` | Internal (backend team) | Collab marketplace discovery |
| NEW-6 push notification service | Internal (backend team) | Non-blocking for launch; required for seller inbox alerts |
| Rights classification migration (`fun` → `fan`, `monetized` → `original`) | Internal (backend team) | Rights-gating logic throughout (FR-1.2, FR-2.4, FR-7.4, FR-11.4) |
| Workstream 2 (Explore) | Internal (mobile team) | Universe Storefront linked from Explore cards; deeplinks must resolve |

---

## Milestones

### M1 — Buy-side foundation (weeks 1–3)

**Deliverables:**
- Universe Storefront screen (FR-1) — static layout, all sections, no purchase actions wired
- Episode NFT section: mint flow end-to-end (FR-1.3, FR-3.2)
- Subscription section: subscribe flow end-to-end (FR-1.4)
- Rights badge visible on all content items
- Deeplink routing: `/market/universe/[universeId]` resolves on both iOS and Android

**Backend required:** None new — all procedures exist. Needs wagmi/viem RN decision made before week 1.

**Excluded from M1:** Merch, canon, licensing, ads, tips, collabs.

---

### M2 — Seller Hub and earnings (weeks 4–6)

**Deliverables:**
- Seller Hub screen with universe picker (FR-10)
- Earnings headline, stream breakdown, revenue chart (FR-10.1–10.3)
- Recent transactions list (FR-10.4)
- Episode NFT listing — single and bulk (FR-2)
- Subscription tier configuration (FR-4.1–4.2)
- Character NFT creation and listing (FR-3.1)

**Backend required:** NEW-1 (`seller.getEarningsSummary`) must be complete before M2 ships.

---

### M3 — Merch, canon, and direct tips (weeks 7–9)

**Deliverables:**
- Merch create, manage, buy (FR-5)
- Canon submit, vote, finalize, license (FR-6)
- Direct tip send + record (FR-11)
- Pending payouts screen (FR-10.5)
- Export CSV (FR-10.6)

**Backend required:** NEW-4 (`tips.recordTip`). Merch and canon use existing endpoints.

---

### M4 — Ad slots and sponsor tools (weeks 10–11)

**Deliverables:**
- Ad slot creation and management (FR-8.1–8.2)
- Sponsor bid flow (FR-8.3)
- Impression report + pitch card (FR-8.4)
- Sponsorship tracking for sponsors (FR-8.5)

**Backend required:** NEW-2 (`ads.getImpressions`), plus `ads.recordImpression` input schema extension (add `episodeId`).

---

### M5 — IP licensing negotiation and collab marketplace (weeks 12–14)

**Deliverables:**
- License request form for buyers (FR-7.1)
- License request inbox and response flow for sellers (FR-7.2–7.4)
- Open collab call creation and feed (FR-9.1–9.2)
- Apply to collab call (FR-9.3)
- Application inbox for creators (FR-9.4)
- Collab management (FR-9.5–9.6)
- Push notifications for all seller inbox events (NEW-6)

**Backend required:** NEW-3, NEW-5, NEW-6.

---

### M6 — Polish and analytics (weeks 15–16)

**Deliverables:**
- Full analytics screens (FR-12)
- Sponsor pitch card export (FR-8.4 + FR-12.4)
- Character appearance royalty claim flow (FR-3.3, requires `nft.claimCharacterRoyalties` new procedure)
- Performance audit: query deduplication, cache warming, skeleton loading states on all screens
- Accessibility pass: all interactive elements have accessible labels, touch targets ≥ 44pt

---

## Definition of Done

The workstream is shippable when all of the following are true:

**Buyer experience:**
1. A first-time user (wallet not connected) can browse a universe storefront without connecting a wallet and see all listed items.
2. A user who connects a CDP wallet can mint an Episode NFT from a universe they do not own, and the transaction confirms on Sepolia within 30 seconds of tapping "Confirm and Mint."
3. A user can subscribe to a paid tier and `subscriptions.hasAccess` returns `true` for that user/universe combination immediately after the subscription transaction confirms.
4. A user can send a tip and the creator sees it in their Seller Hub recent transactions within 5 seconds of transaction confirmation.
5. A user can submit a canon entry, vote on another entry, and license an accepted entry — all from mobile.

**Seller experience:**
6. A creator who owns at least one universe with completed transactions sees a non-zero earnings total on the Seller Hub headline for the correct time range.
7. A creator can list an Episode NFT (single) from mobile, and the listing appears on the universe storefront within 10 seconds.
8. A creator can configure a subscription tier from mobile, and `subscriptions.getTiers` returns the new tier immediately.
9. A creator can create an ad slot, receive a mock bid, and accept it — all from mobile.
10. A creator can post an open collab call and an applicant can apply — both from mobile.

**Quality gates:**
11. All screens render without crashes on iOS 16+ and Android 13+.
12. All network errors surface a non-empty error message (no silent blank screens).
13. All purchase flows (mint, subscribe, tip, merch buy, canon license, ad bid) show a transaction confirmation screen after on-chain success and a transaction failure screen with a retry option after on-chain failure.
14. Rights classification gate: no fan-lane universe shows any purchase CTA anywhere in the Market tab. Tested with a universe where `classification === 'fan'`.
15. No tRPC call is made without a valid JWT in the Authorization header. Unauthenticated access to protected procedures returns 401, not a crash.

---

## Open Questions

1. **Fiat on-ramp placeholder**: The designs show a "Add funds — coming soon" state when balance is insufficient. Who owns the fiat on-ramp integration? When does it become a dependency for mainnet?

2. **Platform fee on tips**: Currently specified as 0% (creator takes all). Is this the intended business model decision, or should the platform take a small bps cut? Decision needed before NEW-4 is implemented.

3. **Merch fulfillment SLA copy**: "Ships within 30 business days" is a placeholder. The platform does not control fulfillment — this copy creates an implied SLA. Legal review needed before any physical merch is listed by creators who are not the team.

4. **Character royalty claim gas**: Claiming accumulated CharacterNFT royalties requires an on-chain transaction. On mainnet L2 this will cost real gas. Should the platform subsidize small claims (e.g., under $1) or require the user to pay? No decision made.

5. **Collab revenue split enforcement**: The `collabs` router records a `revSplitBps` but there is no on-chain enforcement in the current contract. Revenue split is tracked off-chain and relies on creator honesty + platform arbitration. Is this acceptable for launch, or does CollabManager.sol need to auto-distribute before M5?

6. **Creator earnings aggregation performance**: The NEW-1 `getEarningsSummary` approach using a running summary document is sound but requires every payment mutation to also write to `creatorEarnings`. This is a fan-out write pattern. At high volume this can become a Firestore write bottleneck. If the platform grows beyond ~1000 transactions/day per creator, this needs to move to a Cloud Function with a write queue. Flag for post-launch monitoring.
