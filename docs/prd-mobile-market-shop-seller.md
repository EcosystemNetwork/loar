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

Open a universe on mobile. See its storefront. Buy what you want — episode NFT, subscription, merch, canon license, ad slot — in under three taps with your connected wallet. As a creator, open your Seller Hub and see: total earned this month, breakdown by stream, pending payouts, one-tap listing tools, and your sponsor inbox. Both sides of the market live in one app. Neither requires a desktop.

---

## Users

**Primary seller persona — independent IP creator ("The Architect"):**
Building a narrative universe on LOAR. Primarily on mobile. Posts updates, manages listings, responds to collab proposals, and checks earnings while commuting. Cannot be asked to open a laptop to list an NFT or see their revenue.

**Primary buyer persona — narrative fan ("The Collector"):**
Discovered a universe through social, Workstream 2 explore feed, or word of mouth. Wants to own a piece of it. Has a connected wallet or can create one in-app. Comfortable spending ETH in small amounts. Does not need to understand Web3 to complete a purchase.

**Secondary buyer persona — brand sponsor ("The Sponsor"):**
Marketing team for a brand. Looking for niche narrative audiences on emerging platforms. Wants to place a product, character, or audio mention inside a specific universe. Needs to browse available ad slots, understand the audience size, submit a bid, and receive a pitch-ready impression report.

**Secondary seller persona — collaborating creator ("The Co-Author"):**
Has an established universe and wants to expand by bringing in guest creators. Needs to post open collab calls, review applicants, activate agreements, and track joint episode revenue splits.

---

## Success Metrics

| Metric                                                             | Target (90 days post-launch)                             |
| ------------------------------------------------------------------ | -------------------------------------------------------- |
| Creators who view Seller Hub at least once per week                | >60% of active creators                                  |
| Average time from "open universe storefront" to completed purchase | <90 seconds                                              |
| Completed NFT mint transactions via mobile (not web)               | >40% of total mints                                      |
| Creator subscription tier configuration rate                       | >50% of universe owners configure at least one paid tier |
| Sponsor bids submitted via mobile ad slot browser                  | >10 per month                                            |
| Open collab calls with at least one applicant                      | >20 per month                                            |
| Creator payout awareness (viewed earnings at least once)           | >80% of earners                                          |

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

The purchase flow is three steps for every item type: (1) item detail sheet slides up, (2) confirm + sign with connected wallet, (3) success screen with share prompt. Gas is shown in ETH and approximate USD. If the user's balance is insufficient, the flow surfaces a fiat on-ramp placeholder ("Add funds — coming soon").

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
- **Auth:** Dynamic Labs wallet (same SIWE JWT flow as web app — `useWalletAuth` hook adapted for React Native). Dynamic's React Native SDK or a WebView bridge for the wallet modal.
- **Contracts:** wagmi — confirm React Native compatibility; fallback to `viem` direct calls if wagmi's React hooks don't support RN. Contract ABIs from `packages/abis`.
- **Charts:** `react-native-gifted-charts` — lightweight, no native dependencies beyond React Native core
- **File handling:** `expo-document-picker` for merch image uploads, `expo-sharing` for sponsor pitch card export
- **Push notifications:** `expo-notifications` for seller inbox alerts (tip received, bid received, collab application received, license request received)

### Backend Reuse

The following tRPC procedures are called exactly as-is from the mobile client. No backend changes required for these paths:

| Procedure                         | Used in                 |
| --------------------------------- | ----------------------- |
| `nft.createEpisodeListing`        | FR-2.1                  |
| `nft.deactivateEpisode`           | FR-2.3                  |
| `nft.getEpisodesByUniverse`       | FR-1.3, FR-2.3          |
| `nft.recordMint`                  | FR-1.3                  |
| `nft.getCharactersByUniverse`     | FR-3.2                  |
| `nft.createCharacterNFT`          | FR-3.1                  |
| `subscriptions.configureTier`     | FR-4.1                  |
| `subscriptions.getTiers`          | FR-1.4, FR-4.3          |
| `subscriptions.getUniverseStats`  | FR-4.2                  |
| `subscriptions.subscribe`         | FR-4.3                  |
| `subscriptions.cancel`            | FR-4.3                  |
| `subscriptions.hasAccess`         | FR-4.4                  |
| `subscriptions.mySubscriptions`   | FR-4.3                  |
| `licensing.createMerch`           | FR-5.1                  |
| `licensing.getMerch`              | FR-1.5                  |
| `licensing.getOrders`             | FR-5.2                  |
| `licensing.purchaseMerch`         | FR-1.5                  |
| `licensing.myMerch`               | FR-5.2                  |
| `licensing.recordRoyalty`         | FR-5.4 (server-side)    |
| `licensing.createLicense`         | FR-7.2                  |
| `licensing.activateLicense`       | FR-7.3                  |
| `licensing.getLicenses`           | FR-7                    |
| `marketplace.submit`              | FR-6.1                  |
| `marketplace.vote`                | FR-6.2                  |
| `marketplace.finalize`            | FR-6.3                  |
| `marketplace.licenseCanon`        | FR-6.4                  |
| `marketplace.getByUniverse`       | FR-6                    |
| `marketplace.getCanon`            | FR-1.6                  |
| `marketplace.getSubmission`       | FR-6.5                  |
| `marketplace.getVotes`            | FR-6.2                  |
| `marketplace.getPlatformFee`      | FR-6.4                  |
| `marketplace.mySubmissions`       | FR-6.5                  |
| `ads.createSlot`                  | FR-8.1                  |
| `ads.getBids`                     | FR-8.2                  |
| `ads.acceptBid`                   | FR-8.2                  |
| `ads.placeBid`                    | FR-8.3                  |
| `ads.recordImpression`            | background, server-side |
| `ads.getSlotsByUniverse`          | FR-1.8, FR-8.3          |
| `ads.getSponsorships`             | FR-8.5                  |
| `ads.mySponsorships`              | FR-8.5                  |
| `collabs.propose`                 | FR-9.4                  |
| `collabs.accept`                  | FR-9.5                  |
| `collabs.activate`                | FR-9.5                  |
| `collabs.complete`                | FR-9.5                  |
| `collabs.cancel`                  | FR-9.5                  |
| `collabs.getByUniverse`           | FR-9.6                  |
| `collabs.getCollab`               | FR-9.6                  |
| `collabs.getEpisodes`             | FR-9.6                  |
| `collabs.recordEpisode`           | FR-9.5                  |
| `collabs.myCollabs`               | FR-9.6                  |
| `universeTreasury.getPoolBalance` | FR-10.5                 |
| `universeTreasury.getPoolHistory` | FR-10                   |
| `analytics.getUniverseMetrics`    | FR-12.1                 |
| `analytics.getEpisodeMetrics`     | FR-12.2                 |
| `analytics.getRecentActivity`     | FR-10.4                 |
| `analytics.getTrending`           | FR-12.3                 |
| `analytics.exportUniverseData`    | FR-10.6                 |
| `credits.getBalance`              | Seller Hub sidebar      |
| `profiles.getByUid`               | Storefront creator card |

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
});
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
});
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
  proposedTerm: z.string().max(200), // e.g. "12 months", "perpetual"
  proposedFeeEth: z.string(), // decimal string, e.g. "0.5"
  message: z.string().max(1000).optional(),
});
```

Creates a document in a new `licenseRequests` Firestore collection with status `pending`. Notifies the universe creator (write to a notifications collection or trigger a push notification via NEW-5).

**`getLicenseRequests` — protectedProcedure:**

```ts
z.object({
  universeId: z.string(),
  status: z.enum(['pending', 'countered', 'accepted', 'rejected', 'all']).default('pending'),
});
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
  creatorAddress: z.string(), // recipient wallet, verified against universe owner
  amountWei: z.string(),
  txHash: z.string(),
  message: z.string().max(140).optional(),
});
```

Writes to a `tipRecords` Firestore collection. Verifies that `creatorAddress` matches the universe's owner address (prevents misdirected tip records). Updates the `creatorEarnings` summary document (see NEW-1). Triggers a push notification to the creator (see NEW-5).

**`getByUniverse` — protectedProcedure (creator-only view):**

```ts
z.object({ universeId: z.string(), limit: z.number().default(50) });
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
  revSplitBps: z.number().min(100).max(5000), // 1%–50% to collaborator
  episodeCount: z.number().min(1),
  deadline: z.string(), // ISO date
});
```

Writes to new `collabOpenCalls` collection with status `open`.

**`listOpenCalls` — publicProcedure:**

```ts
z.object({
  role: z.enum(['writer', 'artist', 'voice_actor', 'worldbuilder', 'other']).optional(),
  minRevSplitBps: z.number().optional(),
  limit: z.number().min(1).max(50).default(20),
  cursor: z.string().optional(), // Firestore pagination cursor
});
```

Returns open calls ordered by `createdAt` desc. Filters by role and minimum rev split if provided. Deadline must be in the future (server-side filter).

**`applyToCall` — protectedProcedure:**

```ts
z.object({
  callId: z.string(),
  message: z.string().max(1000),
  portfolioUrl: z.string().url().optional(),
});
```

Writes to new `collabApplications` collection. One application per user per call (duplicate check). Notifies call creator.

**`getApplications` — protectedProcedure:**

```ts
z.object({ callId: z.string() });
```

Returns applications for a call. Verified that authenticated user owns the universe the call belongs to.

---

#### NEW-6: Push Notification Dispatch

Not a tRPC procedure — a server-side utility called by mutation handlers.

**Location:** `apps/server/src/services/notifications.ts`

When the following events occur, a push notification is dispatched to the relevant user's registered Expo push token (stored in a `pushTokens/{uid}` Firestore document when the user grants notification permission in the mobile app):

| Event                       | Recipient    | Message                                                      |
| --------------------------- | ------------ | ------------------------------------------------------------ |
| Tip received                | Creator      | "[address] tipped [amount] ETH"                              |
| License request received    | Creator      | "[address] requested a license for [universe]"               |
| License response received   | Requester    | "Creator responded to your license request"                  |
| Ad bid received             | Creator      | "[brand] placed a [amount] ETH bid on your [slot type] slot" |
| Collab application received | Call creator | "New applicant for your [role] collab call"                  |
| Collab application accepted | Applicant    | "Your collab application was accepted"                       |
| Canon submission finalized  | Submitter    | "Your submission was [ACCEPTED/REJECTED]"                    |

Uses Expo Push Notification API (`https://exp.host/--/api/v2/push/send`). Dispatch is fire-and-forget (non-fatal failure). Token registration endpoint: `notifications.registerToken` (simple write to `pushTokens` collection; no business logic).

---

### Data Model Changes

#### New Firestore Collections

| Collection           | Written by                             | Read by                                                             |
| -------------------- | -------------------------------------- | ------------------------------------------------------------------- |
| `tipRecords`         | `tips.recordTip`                       | `tips.getByUniverse`, `seller.getEarningsSummary`                   |
| `creatorEarnings`    | All payment mutations (updated inline) | `seller.getEarningsSummary`                                         |
| `licenseRequests`    | `licensing.requestLicense`             | `licensing.getLicenseRequests`, `licensing.respondToLicenseRequest` |
| `collabOpenCalls`    | `collabs.createOpenCall`               | `collabs.listOpenCalls`                                             |
| `collabApplications` | `collabs.applyToCall`                  | `collabs.getApplications`                                           |
| `pushTokens`         | `notifications.registerToken`          | notification dispatch service                                       |

#### Modified Collections / Documents

| Collection              | Change                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `adImpressions`         | Add `episodeId` field (new field on `ads.recordImpression` input)                               |
| `subscriptionRevenue`   | Add `creatorUid` field for earnings aggregation query (was implicit via `universeId`)           |
| `sponsorships` (active) | Add `impressionCount` denormalized field, updated by `ads.recordImpression` server-side trigger |

#### No Schema Migrations Required for Existing Collections

The above are all additive changes. No existing documents need to be updated. The new fields are optional in read queries — old documents without them return `undefined`, which client code must handle with nullish coalescing.

---

## Screens List

The Market tab in the mobile app is one of the root tabs (alongside Explore and Create from Workstreams 2 and 1). All screens below live under the `/market/` route prefix in Expo Router.

### Buy-side screens

| Screen                         | Route                                                        | Primary data                                                    |
| ------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------- |
| Market home (Buy toggle)       | `/market/`                                                   | `analytics.getTrending`, `nft.getEpisodesByUniverse` (featured) |
| Universe Storefront            | `/market/universe/[universeId]`                              | Multiple — see FR-1                                             |
| Episode NFT detail + mint      | `/market/universe/[universeId]/episode/[episodeId]`          | `nft.getEpisodesByUniverse`                                     |
| Character NFT detail + mint    | `/market/universe/[universeId]/character/[characterId]`      | `nft.getCharactersByUniverse`                                   |
| Subscription tiers + subscribe | `/market/universe/[universeId]/subscribe`                    | `subscriptions.getTiers`                                        |
| Merch item detail + buy        | `/market/universe/[universeId]/merch/[itemId]`               | `licensing.getMerch`                                            |
| Canon submission detail + vote | `/market/universe/[universeId]/canon/[submissionId]`         | `marketplace.getSubmission`, `marketplace.getVotes`             |
| License canon flow             | `/market/universe/[universeId]/canon/[submissionId]/license` | `marketplace.getPlatformFee`                                    |
| Request IP license form        | `/market/universe/[universeId]/license-request`              | `licensing.requestLicense` (new)                                |
| Ad slot browser                | `/market/universe/[universeId]/sponsor`                      | `ads.getSlotsByUniverse`                                        |
| Place ad bid form              | `/market/universe/[universeId]/sponsor/[slotId]/bid`         | `ads.placeBid`                                                  |
| Collab feed (open calls)       | `/market/collabs`                                            | `collabs.listOpenCalls` (new)                                   |
| Collab call detail + apply     | `/market/collabs/[callId]`                                   | `collabs.applyToCall` (new)                                     |
| My purchased NFTs              | `/market/my/nfts`                                            | `nft.getEpisodesByUniverse` filtered by owner wallet            |
| My subscriptions               | `/market/my/subscriptions`                                   | `subscriptions.mySubscriptions`                                 |
| My collab applications         | `/market/my/collabs`                                         | `collabs.myCollabs`                                             |
| My active sponsorships         | `/market/my/sponsorships`                                    | `ads.mySponsorships`                                            |
| My licenses (as licensee)      | `/market/my/licenses`                                        | `licensing.getLicenses`                                         |
| Tip confirmation sheet         | (bottom sheet, modal)                                        | `tips.recordTip` (new)                                          |

### Sell-side screens

| Screen                           | Route                                                      | Primary data                                                    |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| Seller Hub (earnings dashboard)  | `/market/sell/[universeId]`                                | `seller.getEarningsSummary` (new)                               |
| Episode NFT management           | `/market/sell/[universeId]/episodes`                       | `nft.getEpisodesByUniverse`                                     |
| Create/edit NFT listing          | `/market/sell/[universeId]/episodes/[episodeId]/list`      | `nft.createEpisodeListing`                                      |
| Bulk episode listing             | `/market/sell/[universeId]/episodes/bulk-list`             | `nft.createEpisodeListing` (batched)                            |
| Character NFT management         | `/market/sell/[universeId]/characters`                     | `nft.getCharactersByUniverse`                                   |
| Create character NFT             | `/market/sell/[universeId]/characters/create`              | `nft.createCharacterNFT`                                        |
| Subscription tier config         | `/market/sell/[universeId]/subscriptions`                  | `subscriptions.configureTier`, `subscriptions.getUniverseStats` |
| Merch management                 | `/market/sell/[universeId]/merch`                          | `licensing.myMerch`, `licensing.getOrders`                      |
| Create merch item                | `/market/sell/[universeId]/merch/create`                   | `licensing.createMerch`                                         |
| Canon management + finalize      | `/market/sell/[universeId]/canon`                          | `marketplace.getByUniverse`, `marketplace.finalize`             |
| Ad slot manager                  | `/market/sell/[universeId]/ads`                            | `ads.getSlotsByUniverse`, `ads.getBids`                         |
| Create ad slot                   | `/market/sell/[universeId]/ads/create`                     | `ads.createSlot`                                                |
| Sponsor inbox (bid review)       | `/market/sell/[universeId]/ads/[slotId]/bids`              | `ads.getBids`, `ads.acceptBid`                                  |
| Impression report + pitch card   | `/market/sell/[universeId]/ads/[slotId]/impressions`       | `ads.getImpressions` (new)                                      |
| License request inbox            | `/market/sell/[universeId]/license-requests`               | `licensing.getLicenseRequests` (new)                            |
| License request detail + respond | `/market/sell/[universeId]/license-requests/[requestId]`   | `licensing.respondToLicenseRequest` (new)                       |
| Collab management                | `/market/sell/[universeId]/collabs`                        | `collabs.getByUniverse`, `collabs.myCollabs`                    |
| Post open collab call            | `/market/sell/[universeId]/collabs/open-call`              | `collabs.createOpenCall` (new)                                  |
| Collab applications inbox        | `/market/sell/[universeId]/collabs/[callId]/applications`  | `collabs.getApplications` (new)                                 |
| Analytics overview               | `/market/sell/[universeId]/analytics`                      | `analytics.getUniverseMetrics`, `analytics.getTrending`         |
| Episode analytics                | `/market/sell/[universeId]/analytics/episodes/[episodeId]` | `analytics.getEpisodeMetrics`                                   |
| Earnings export                  | `/market/sell/[universeId]/analytics/export`               | `analytics.exportUniverseData`                                  |
| Tips received                    | `/market/sell/[universeId]/tips`                           | `tips.getByUniverse` (new)                                      |
| Pending payouts                  | `/market/sell/[universeId]/payouts`                        | `universeTreasury.getPoolBalance`, `collabs.getByUniverse`      |

---

## Dependencies

| Dependency                                                                           | Owner                     | Blocking                                                              |
| ------------------------------------------------------------------------------------ | ------------------------- | --------------------------------------------------------------------- |
| Dynamic Labs React Native SDK (or WebView bridge)                                    | Dynamic/external          | Auth flow, all wallet transactions                                    |
| `packages/abis` current build (EpisodeNFT.sol, CharacterNFT.sol, Universe.sol ABIs)  | Internal (contracts team) | All on-chain write actions                                            |
| wagmi RN compatibility or viem fallback decision                                     | Internal (client team)    | All on-chain reads/writes                                             |
| NEW-1 `seller.getEarningsSummary`                                                    | Internal (backend team)   | Seller Hub headline — cannot ship Seller Hub without this             |
| NEW-2 `ads.getImpressions`                                                           | Internal (backend team)   | Sponsor pitch card, impression report                                 |
| NEW-3 `licensing.requestLicense` / `getLicenseRequests` / `respondToLicenseRequest`  | Internal (backend team)   | IP licensing buyer flow                                               |
| NEW-4 `tips.recordTip` / `getByUniverse`                                             | Internal (backend team)   | Tip flow                                                              |
| NEW-5 `collabs.createOpenCall` / `listOpenCalls` / `applyToCall` / `getApplications` | Internal (backend team)   | Collab marketplace discovery                                          |
| NEW-6 push notification service                                                      | Internal (backend team)   | Non-blocking for launch; required for seller inbox alerts             |
| Rights classification migration (`fun` → `fan`, `monetized` → `original`)            | Internal (backend team)   | Rights-gating logic throughout (FR-1.2, FR-2.4, FR-7.4, FR-11.4)      |
| Workstream 2 (Explore)                                                               | Internal (mobile team)    | Universe Storefront linked from Explore cards; deeplinks must resolve |

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
2. A user who connects a connected wallet can mint an Episode NFT from a universe they do not own, and the transaction confirms on Sepolia within 30 seconds of tapping "Confirm and Mint."
3. A user can subscribe to a paid tier and `subscriptions.hasAccess` returns `true` for that user/universe combination immediately after the subscription transaction confirms.
4. A user can send a tip and the creator sees it in their Seller Hub recent transactions within 5 seconds of transaction confirmation.
5. A user can submit a canon entry, vote on another entry, and license an accepted entry — all from mobile.

**Seller experience:** 6. A creator who owns at least one universe with completed transactions sees a non-zero earnings total on the Seller Hub headline for the correct time range. 7. A creator can list an Episode NFT (single) from mobile, and the listing appears on the universe storefront within 10 seconds. 8. A creator can configure a subscription tier from mobile, and `subscriptions.getTiers` returns the new tier immediately. 9. A creator can create an ad slot, receive a mock bid, and accept it — all from mobile. 10. A creator can post an open collab call and an applicant can apply — both from mobile.

**Quality gates:** 11. All screens render without crashes on iOS 16+ and Android 13+. 12. All network errors surface a non-empty error message (no silent blank screens). 13. All purchase flows (mint, subscribe, tip, merch buy, canon license, ad bid) show a transaction confirmation screen after on-chain success and a transaction failure screen with a retry option after on-chain failure. 14. Rights classification gate: no fan-lane universe shows any purchase CTA anywhere in the Market tab. Tested with a universe where `classification === 'fan'`. 15. No tRPC call is made without a valid JWT in the Authorization header. Unauthenticated access to protected procedures returns 401, not a crash.

---

## Open Questions

1. **Fiat on-ramp placeholder**: The designs show a "Add funds — coming soon" state when balance is insufficient. Who owns the fiat on-ramp integration? When does it become a dependency for mainnet?

2. **Platform fee on tips**: Currently specified as 0% (creator takes all). Is this the intended business model decision, or should the platform take a small bps cut? Decision needed before NEW-4 is implemented.

3. **Merch fulfillment SLA copy**: "Ships within 30 business days" is a placeholder. The platform does not control fulfillment — this copy creates an implied SLA. Legal review needed before any physical merch is listed by creators who are not the team.

4. **Character royalty claim gas**: Claiming accumulated CharacterNFT royalties requires an on-chain transaction. On mainnet L2 this will cost real gas. Should the platform subsidize small claims (e.g., under $1) or require the user to pay? No decision made.

5. **Collab revenue split enforcement**: The `collabs` router records a `revSplitBps` but there is no on-chain enforcement in the current contract. Revenue split is tracked off-chain and relies on creator honesty + platform arbitration. Is this acceptable for launch, or does CollabManager.sol need to auto-distribute before M5?

6. **Creator earnings aggregation performance**: The NEW-1 `getEarningsSummary` approach using a running summary document is sound but requires every payment mutation to also write to `creatorEarnings`. This is a fan-out write pattern. At high volume this can become a Firestore write bottleneck. If the platform grows beyond ~1000 transactions/day per creator, this needs to move to a Cloud Function with a write queue. Flag for post-launch monitoring.

---

## Production Requirements

### 1. Performance Contracts

#### Buy-side Critical Path (Storefront → Mint)

**Universe Storefront initial render (all sections except NFT images):** target ≤ 800ms from screen mount to all section headers and text content visible. Images (episode artwork, merch thumbnails) are lazy-loaded and do not block this target.

**`nft.getEpisodesByUniverse` + `subscriptions.getTiers` + `ads.getSlotsByUniverse` parallel load:**

- p50: 280ms
- p95: 700ms
- p99: 1400ms

All three calls are fired in parallel via `Promise.all` at storefront mount. The storefront renders each section independently as data arrives (not blocked on the slowest call). If any individual call exceeds 3000ms, that section renders in a skeleton-error state rather than blocking the others.

**Episode detail sheet open:** target ≤ 200ms from tap to sheet fully expanded. The episode data is already resident in the React Query cache from the `getEpisodesByUniverse` call — no network round trip. Sheet animation budget: 200ms at 60fps.

**Mint transaction submit to Sepolia:** 1500ms–4000ms expected range. This covers: wagmi `estimateGas` call (~500ms on Sepolia RPC), user confirmation in the embedded wallet UI (~0ms for connected wallet, no separate approval screen), and `writeContract` broadcast (~800ms–3000ms depending on Sepolia mempool congestion). Display "Submitting…" spinner during this window. If `estimateGas` has not returned in 5000ms, surface the gas estimation failure error (see Section 3).

**Mint confirmation (2 block confirmations on Sepolia):** 24–36 seconds expected. Sepolia block time is ~12 seconds. Two confirmations = ~24 seconds minimum. Display a live "Waiting for confirmation (0/2)… (1/2)…" progress indicator. After 120 seconds with no confirmation, surface the on-chain tx timeout error state (see Section 3) — do not block the UI; allow the user to navigate away with the transaction tracked in a persistent "Pending Transactions" banner.

**Post-mint: storefront supply counter update (Ponder indexer lag + cache invalidation):** max 30 seconds. Ponder indexes Sepolia in near-real-time (~10–15 seconds average). Add 15 seconds for the server-side cache TTL on `nft.getEpisodesByUniverse` (60s TTL with SWR). The client optimistically decrements the supply counter immediately after the user's own successful mint, bypassing cache lag for their own session. Other users will see the updated count within 30 seconds.

#### Sell-side Critical Path (Seller Hub)

**`seller.getEarningsSummary` API SLA:**

- p50: 350ms
- p95: 1200ms
- p99: 2800ms

This procedure fans out across 7 Firestore collections: `episodeMints` (NFT revenue), `subscriptionPayments`, `licensingFees`, `adPayments`, `collabPayments`, `treasuryDistributions`, and `tipPayments`. The parallelism strategy is: all 7 reads are fired simultaneously via `Promise.allSettled`. The timeout per sub-call is 2000ms — implemented via `Promise.race` with a `setTimeout` rejection per call. If a sub-call times out or rejects, the response includes that stream's data as `null` with a `"timed_out"` or `"error"` status flag. The client renders available streams immediately and labels unavailable streams as "Unavailable — tap to retry." The response shape must always include all 7 stream keys; none are omitted on failure. Total handler timeout is 4000ms — if the `Promise.allSettled` itself has not resolved in 4000ms, return whatever is complete with remaining streams marked `"timed_out"`.

**Revenue chart render (30-bar daily bar chart with Victory Native):** target ≤ 150ms from data received to chart interactive. This is a client-side render of a fixed 30-point dataset. No additional network call. Victory Native renders synchronously on the RN main thread — if frame drops are observed, wrap the chart in a deferred `useEffect` with a 16ms delay to yield the frame to the list render before mounting the chart.

**Seller Hub full load (headline + chart + stream breakdown + recent transactions):** p95 ≤ 1500ms. This is dominated by the `getEarningsSummary` p95 (1200ms) plus chart render (150ms) and layout (150ms). The "recent transactions" list is a separate `seller.getRecentTransactions` call, fired in parallel with `getEarningsSummary`, with its own 2000ms timeout and skeleton fallback.

#### Transaction Flows

**Subscription purchase end-to-end:** `subscriptions.subscribe` call + on-chain confirmation: p95 ≤ 30 seconds. The `subscribe` tRPC call itself should complete in ≤ 800ms (Firestore write + event emit). On-chain subscription state is confirmed via the same 2-block Sepolia confirmation window (24–36 seconds). Display "Subscribed!" optimistically after the `subscribe` call returns, with a small "Confirming on-chain…" badge that resolves once the Ponder index reflects the subscription.

**Direct tip end-to-end (wallet sign + broadcast + recordTip + creator notification):** p95 ≤ 35 seconds. Breakdown: ETH transfer broadcast (~2000ms), 2-block confirmation (~24–30 seconds), `tips.recordTip` tRPC call (~400ms), push notification delivery (~1000ms via FCM). The "Tip sent!" success screen appears at broadcast time (not confirmation time) with the confirmation status shown live. Creator notification fires after `recordTip` succeeds, not after confirmation, to minimize delay.

**Bulk episode listing (10 episodes):** total time with progress indicator ≤ 20 seconds. Each `nft.createEpisodeListing` call takes ~500ms (Firestore write + cache invalidation). 10 sequential calls = ~5 seconds of network time. Plus UI rendering: progress bar increments for each completion. Sequential (not parallel) to avoid Firestore write contention and to allow per-item failure isolation. Display: "Listing episodes… 3/10" with a progress bar. Estimated total shown upfront: "~10 seconds."

#### Impression Report

**`ads.getImpressions` API SLA:**

- p50: 180ms
- p95: 600ms

This reads the `adImpressions` sub-collection for a given slot. On slots with high impression counts (> 10,000 documents), the query must use server-side aggregation (Firestore aggregation queries or a pre-aggregated `impressionSummary` document updated via a counter). The raw document read path is only acceptable for slots with < 500 impressions; above that, the aggregated path must be used. The query returns: total impressions, unique wallets, impressions by day (last 30 days), and top referrers.

**Sponsor pitch card image generation (composited from analytics + impressions):** target ≤ 800ms from "Export Pitch Card" tap to share sheet appearing. The card is generated client-side using `react-native-view-shot` (screenshot of a rendered `PitchCardView` component). The component renders off-screen synchronously from cached data (impressions + universe metadata already loaded). The `captureRef` call takes ~300ms on a mid-range Android device. File is written to the Expo media library and then shared via `expo-sharing`.

#### Canon Marketplace

**`marketplace.getCanon` + `getVotes` initial load:** p95 ≤ 900ms. Both calls fired in parallel. `getCanon` reads the `canonSubmissions` collection filtered by universeId. `getVotes` reads `canonVotes` filtered by submissionId (for the first page of submissions). Client paginates votes lazily — initial load shows vote counts only.

**Vote submission to confirmation:** p95 ≤ 500ms. `marketplace.vote` is a Firestore write — no on-chain transaction in the current spec (governance weight is read client-side from the contract but vote recording is off-chain). The optimistic update is applied immediately; the server response either confirms or reverts it.

---

### 2. Security Requirements

#### Mint Flow

**Server-side `recordMint` verification:** when the client calls `nft.recordMint({ txHash, episodeId })`, the server performs the following verification before writing to Firestore:

1. Call the Sepolia RPC (`eth_getTransactionReceipt`) with the provided `txHash`. If the receipt is not found or `status === 0` (reverted), return 400.
2. Verify `receipt.to` is the deployed `EpisodeNFT.sol` contract address (from `packages/abis`). If not, return 400 with `"Invalid contract"`.
3. Decode the transaction logs. Locate the `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)` event emitted by ERC-721 mint (where `from === address(0)`). If no such event exists, return 400 with `"No mint event found"`.
4. Verify `receipt.from` (the transaction sender) equals the authenticated wallet address from the SIWE JWT (`ctx.user.address`). If not, return 403 with `"Transaction sender does not match authenticated user"`.
5. Decode the `Mint(address indexed minter, uint256 indexed tokenId, uint256 indexed episodeId)` event from `EpisodeNFT.sol` and verify the `episodeId` in the event matches the `episodeId` parameter. If not, return 400 with `"Episode ID mismatch"`.
6. Check the `processedTxHashes` Firestore collection for this `txHash`. If it already exists, return 200 (idempotent — not an error, just a no-op). Write to `processedTxHashes` before returning success to prevent TOCTOU races.

**Max supply off-chain reconciliation:** the contract enforces max supply on-chain at mint time — it is impossible to over-mint via contract. The off-chain `mintedCount` in Firestore is authoritative via the Ponder indexer. Reconciliation strategy: every `Mint` event emitted by `EpisodeNFT.sol` triggers a Ponder handler that upserts the episode's `mintedCount` in Firestore. The `recordMint` tRPC call increments the same counter as a belt-and-suspenders measure, but Ponder is the canonical source. On divergence (Ponder count > Firestore tRPC count), Ponder wins — the `mintedCount` is overwritten by the Ponder handler on each event. There is no scheduled reconciliation job because Ponder is event-driven and inherently consistent with the chain.

#### Tip Flow

**`tips.recordTip` server-side verification:** when the client calls `tips.recordTip({ txHash, creatorAddress, amountWei, message? })`:

1. Check `processedTxHashes` for `txHash`. If found, return 200 (idempotent).
2. Call Sepolia RPC `eth_getTransactionReceipt`. If not found or `status === 0`, return 400.
3. Verify `receipt.to.toLowerCase() === creatorAddress.toLowerCase()`. A tip must go directly to the creator wallet. If not, return 400 with `"Transaction recipient does not match creator"`.
4. Verify `receipt.from.toLowerCase() === ctx.user.address.toLowerCase()`. If not, return 403 with `"Transaction sender does not match authenticated user"`.
5. Call `eth_getTransactionByHash` to retrieve the transaction object. Verify `tx.value === amountWei` (BigInt comparison). If not, return 400 with `"Transaction value does not match claimed amount"`. This prevents a user from sending 0.001 ETH but recording it as 1 ETH.
6. Write `txHash` to `processedTxHashes` before writing the tip record. Use a Firestore batch write to make both atomic.

**Platform fee on tips is 0%.** The creator receives 100% of the ETH value of every tip. This is an intentional product decision made on 2026-03-28. Do NOT add any platform fee deduction to this handler without a recorded product decision and a corresponding update to this document and to `Open Questions #2`. See `tips.routes.ts` — this note is duplicated as a code comment directly above the tip recording logic.

#### IP Licensing Negotiation

**`licensing.requestLicense` — creator cannot license their own universe:** before creating a license request, the server reads the universe document and verifies `universe.ownerAddress !== ctx.user.address`. If the requesting user is the universe owner, return 400 with `"Universe owners cannot request a license for their own universe"`. This prevents self-dealing records in the licensing system.

**`licensing.respondToLicenseRequest` — must be the universe owner:** read the license request document to get `universeId`. Read the universe document. Verify `universe.ownerAddress === ctx.user.address`. If not, return 403 with `"Only the universe owner can respond to license requests"`. This check must happen before any mutation — do not mutate first and check after.

**Counter-offer round limit:** the licensing flow allows one round of counter-offer. State transitions:

- `pending` → `accepted` (owner accepts)
- `pending` → `rejected` (owner rejects)
- `pending` → `countered` (owner sends counter with modified terms)
- `countered` → `accepted` (requester accepts the counter)
- `countered` → `rejected` (requester rejects the counter — terminates the negotiation)

After a license request enters `countered` status, the requester may only Accept or Reject. The server enforces this: if `respondToLicenseRequest` is called on a request with `status === 'countered'` by the original requester, only `action: 'accept'` or `action: 'reject'` are valid. Any attempt to send another counter returns 400 with `"Counter-offers are limited to one round. Accept, reject, or contact the creator directly."` Further negotiation must occur off-platform.

#### Ad Slot Bidding

**Creative URL validation:** `ads.placeBid` accepts a `creativeUrl` field. The Zod input schema enforces:

- `z.string().url()` — must be a valid URL
- `.refine(url => url.startsWith('https://'), "Creative URL must use HTTPS")`
- No further domain allowlisting is implemented in v1. Content moderation is manual: the universe owner reviews the creative (image/video URL) in their sponsor inbox before accepting the bid. The `ads.acceptBid` endpoint does not auto-approve; it is always creator-initiated. Document this in the `ads.routes.ts` file as: `// Creative URL moderation is manual in v1. Creator reviews before accepting. No automated content scanning.`

**`ads.acceptBid` ownership check:** before accepting a bid, the server reads the ad slot document (`adSlots/{slotId}`), retrieves `slot.universeId`, reads the universe document, and verifies `universe.ownerAddress === ctx.user.address`. If not, return 403 with `"Only the universe owner can accept bids on their ad slots"`.

#### Canon Marketplace

**Vote weight trust model:** the governance token balance used as vote weight is read by the client via `useReadContract({ abi: GovernanceTokenABI, functionName: 'balanceOf', args: [userAddress] })`. The client passes this `weight` to `marketplace.vote`. The server does NOT re-verify the weight against the contract. The on-chain governance contract (`GovernanceToken.sol`) is the source of truth for token balances, and any manipulation would require the user to actually hold the tokens. This is an explicit product decision: off-chain vote recording with client-reported weight is acceptable for v1 because the governance contract prevents weight fabrication at the token level. This trust model must be re-evaluated before mainnet if vote weight manipulation becomes a concern. Document in `marketplace.routes.ts`: `// Vote weight is reported by the client from on-chain balanceOf. Server does not re-verify in v1.`

**`marketplace.finalize` ownership check:** before finalizing a canon submission (accepting or rejecting it as canon), the server reads the submission document to get `universeId`, reads the universe document, and verifies `universe.ownerAddress === ctx.user.address`. If not, return 403. Finalization is irreversible — a finalized submission cannot be re-opened.

#### Seller Earnings

**`seller.getEarningsSummary` authorization:** the first operation in the handler (before any Firestore reads) is to read the universe document for the provided `universeId` and verify `universe.ownerAddress === ctx.user.address`. If not, return 403 with `"You do not have permission to view earnings for this universe"`. A creator cannot view another creator's earnings data, even if they know the `universeId`. This is enforced regardless of whether the universe is public.

#### Rights Classification Gate

**Server-side enforcement of rights classification:** the client-side suppression of purchase CTAs for fan-lane universes is a UX control, not a security control. Every write endpoint that initiates a monetization action must independently verify the universe's rights classification before executing:

- `nft.createEpisodeListing`: read universe, verify `classification !== 'fan'`. If fan-lane, return 403 with `"Fan-lane universes cannot list NFTs for sale"`.
- `licensing.requestLicense`: read universe, verify `classification !== 'fan'`. If fan-lane, return 403 with `"Fan-lane universes cannot be licensed"`.
- `tips.recordTip`: read universe, verify `classification !== 'fan'`. If fan-lane, return 403 with `"Fan-lane universes cannot receive monetized tips"`. Note: direct ETH transfer is unstoppable on-chain, but `recordTip` can be refused, preventing the tip from appearing in creator earnings.
- `subscriptions.configureTier`: read universe, verify `classification !== 'fan'`. If fan-lane, return 403.
- `ads.createSlot`: read universe, verify `classification !== 'fan'`. If fan-lane, return 403.

The `classification` field on universe documents must be treated as `'fan'` when absent or `undefined`. The absence of a classification is the most conservative default — treat unclassified universes as fan-lane until explicitly set to `'original'` or `'licensed'` by the creator.

---

### 3. Error Taxonomy and Handling Strategy

| Error                                         | Examples                                                                                                                      | Client behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | User message                                                                                                                                                                                                                            | Retry?                                                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Mint transaction reverted                     | Max supply reached after user started checkout; price changed on-chain                                                        | Dismiss mint confirmation sheet. Refresh `getEpisodesByUniverse` to show current supply. Show sold-out state on the episode card. Fire `mint_failed` analytics event with `reason: 'reverted'`.                                                                                                                                                                                                                                                                                                                                                           | "This episode is sold out. The last edition was minted while you were checking out."                                                                                                                                                    | No — redirect to sold-out state. The "Mint" button becomes "Sold Out" (disabled).                                                        |
| Mint gas estimation failure                   | Sepolia RPC timeout during `estimateGas`; RPC returns an error                                                                | Auto-retry `estimateGas` once after 2 seconds. If retry fails, show inline error in the confirmation sheet. Do not close the sheet — the user may try again manually.                                                                                                                                                                                                                                                                                                                                                                                     | "We couldn't estimate gas right now. The Sepolia network may be congested. Try again in a moment."                                                                                                                                      | Auto-retry once automatically; then user-initiated via "Try Again" button in sheet.                                                      |
| Insufficient ETH balance for mint             | `estimateGas` succeeds but wallet balance < price + estimated gas                                                             | Dismiss the confirmation sheet. Show an "Add Funds" bottom sheet with the shortfall amount ("You need ~0.02 ETH more to mint this episode") and a "Copy Wallet Address" button. Fire `mint_failed` analytics event with `reason: 'insufficient_balance'`.                                                                                                                                                                                                                                                                                                 | "Your wallet doesn't have enough ETH. You need [X] ETH to mint this episode."                                                                                                                                                           | No — show "Add funds" state with wallet address copyable.                                                                                |
| Subscription already active                   | Duplicate `subscribe` call (user double-tapped; or previously subscribed and re-subscribing)                                  | The `subscriptions.subscribe` tRPC call returns a specific error code (`SUBSCRIPTION_ALREADY_ACTIVE`). Client redirects to the "Manage Subscription" sheet for that tier instead of showing an error. No error toast is shown.                                                                                                                                                                                                                                                                                                                            | (No error toast) — the manage sheet opens, showing the existing subscription with next billing date.                                                                                                                                    | No — redirect to manage.                                                                                                                 |
| Seller Hub partial failure                    | `seller.getEarningsSummary` — 2 of 7 sub-calls time out (e.g., `licensingFees` and `treasuryDistributions` timeout at 2000ms) | Render the Seller Hub with available streams. Each timed-out stream renders a "Unavailable" card with a grey placeholder and a "Retry" chip. The headline total excludes the timed-out streams and shows a "(Partial)" label next to the total. A `seller_earnings_partial` analytics event fires with the list of unavailable streams.                                                                                                                                                                                                                   | "Some earnings data is unavailable. Tap Retry to reload the missing streams." (shown as inline card text, not a toast)                                                                                                                  | Background auto-retry after 30 seconds; also user-initiated via "Retry" chip per stream.                                                 |
| Bulk listing partial failure                  | 7 of 10 episode listings succeed; 3 fail (e.g., Firestore write timeout on episodes 4, 7, and 10)                             | Stop the progress indicator. Show a results sheet: "7 episodes listed successfully. 3 failed." with a list of the failed episodes by title. Each failed episode has an individual "Retry" button. Successfully listed episodes are not re-submitted.                                                                                                                                                                                                                                                                                                      | "3 episodes couldn't be listed. Tap Retry next to each one to try again."                                                                                                                                                               | User-initiated per-item retry. The retry calls `nft.createEpisodeListing` for that single episode only.                                  |
| Collab application duplicate                  | User taps "Apply" on a call they already applied to (race between UI state and server state)                                  | The client maintains a local `appliedCallIds: Set<string>` in Zustand store, hydrated from `collabs.getMyApplications` on mount. The "Apply" button is disabled for calls in this set. If the server returns a duplicate error (`DUPLICATE_APPLICATION`), show a toast and disable the button retroactively.                                                                                                                                                                                                                                              | "You've already applied to this collab call."                                                                                                                                                                                           | N/A — the application already exists. Navigate to the application detail instead.                                                        |
| License request for fan-lane universe         | `licensing.requestLicense` returns 403 because `classification === 'fan'`                                                     | This should not be reachable via the normal UI (rights gate suppresses the CTA). If reached (e.g., via a stale client), show an error sheet. Fire `rights_gate_hit` analytics event.                                                                                                                                                                                                                                                                                                                                                                      | "This universe hasn't been cleared for licensing. The creator needs to complete the rights classification process first."                                                                                                               | No. Dismiss the sheet.                                                                                                                   |
| Direct tip tx rejected by wallet              | User tapped cancel in the connected wallet confirmation UI; or wallet returned a user-rejected error code (`4001`)            | Dismiss the tip sheet silently. Do not show an error toast. Return the user to the storefront tip section with the tip amount cleared. Fire `tip_failed` analytics event with `reason: 'wallet_cancelled'`.                                                                                                                                                                                                                                                                                                                                               | (No message — silent dismiss. The user knows they cancelled.)                                                                                                                                                                           | No — dismiss silently.                                                                                                                   |
| Direct tip tx confirmed but `recordTip` fails | Network drop after tx broadcast and 2-block confirmation; tRPC call to `tips.recordTip` returns a network error or 5xx        | Store the txHash, creatorAddress, amountWei, universeId, and timestamp in AsyncStorage under the key `pending_tip_records` as a JSON array. Show a brief toast. On every subsequent app foreground event (`AppState` change to `active`), the app checks `pending_tip_records` and retries `recordTip` for each pending entry. After 3 failed retries per entry, the entry moves to `failed_tip_records` and the user sees a persistent alert: "We couldn't log your tip. Please contact support." with the txHash displayed and a "Copy Tx Hash" button. | Toast: "Your tip was sent on-chain. We'll finish recording it shortly." Persistent alert after 3 failures: "We couldn't log your tip to [Creator]. Your ETH was sent successfully. Contact support with your transaction ID: [txHash]." | Auto-retry on every app foreground event, up to 3 times per record. After 3 failures: surface persistent alert, no more auto-retry.      |
| Impression report data unavailable            | `ads.getImpressions` returns an empty result set for a newly created slot (0 impressions recorded)                            | Render the impression report screen in a clean "No data yet" empty state. Do not show an error. Include a "How impressions are tracked" info link.                                                                                                                                                                                                                                                                                                                                                                                                        | "No impressions recorded yet. Impressions appear here once your ad is live and views are recorded."                                                                                                                                     | N/A — this is a valid empty state, not an error.                                                                                         |
| Merch order submitted, fulfillment unknown    | Creator never ships; buyer has no tracking                                                                                    | The app does not track fulfillment status in v1. The order record in Firestore has `status: 'pending_fulfillment'` and is never updated by the platform. The buyer's purchase history shows the order with a disclosure.                                                                                                                                                                                                                                                                                                                                  | Disclosure shown at checkout: "Fulfillment is managed directly by the creator. LOAR does not track shipping or guarantee delivery timelines." Order history shows: "Status: Fulfillment managed by creator."                            | N/A — out of scope for v1.                                                                                                               |
| On-chain tx timeout                           | Transaction broadcast to Sepolia but no confirmation in 120 seconds                                                           | Stop the confirmation spinner. Show a "Pending" state with an Etherscan link (`https://sepolia.etherscan.io/tx/{txHash}`). The transaction is NOT marked failed — it may still confirm. The user can navigate away; the pending state persists in a "Pending Transactions" banner at the top of the Market tab. When Ponder detects the confirmation, the banner resolves automatically.                                                                                                                                                                  | "Your transaction is taking longer than expected. It's still pending on Sepolia. [View on Etherscan ↗]"                                                                                                                                 | User-initiated only — the Etherscan link lets the user monitor progress. The app will auto-resolve when Ponder indexes the confirmation. |

**Recovery mechanism for `recordTip` failure (detailed spec):**

1. At the moment `recordTip` fails (network error or 5xx), the client writes to AsyncStorage:
   - Key: `loar_pending_tip_records`
   - Value: JSON array of `{ txHash: string, creatorAddress: string, amountWei: string, universeId: string, timestamp: number, retryCount: number }`
2. A `usePendingTipRecovery` hook (initialized in the app root) subscribes to `AppState` change events.
3. On every `active` foreground event, the hook reads `loar_pending_tip_records`, filters entries with `retryCount < 3`, and calls `tips.recordTip` for each.
4. On success: remove the entry from the array.
5. On failure: increment `retryCount`. If `retryCount === 3`, move the entry to `loar_failed_tip_records` and surface the persistent alert.
6. The `tips.recordTip` endpoint is idempotent for the same `txHash` (see Section 2) — retrying a previously recorded tip returns 200 without duplicating the record.
7. The persistent alert renders as a `Banner` component pinned above the bottom tab bar, not dismissible until the user taps "Contact Support" or the record is manually cleared by support.

---

### 4. Testing Strategy

#### Unit Tests

Coverage target: **80%** of all new Workstream 3 client-side modules and all new server-side procedures. The 12 specific unit test cases, weighted toward complex flows:

1. **Bulk listing progress state machine** — `useBulkListingProgress` hook: given 10 episodes, verify state transitions `idle → listing → partial_success → complete` when 7 succeed and 3 fail. Assert that `failedEpisodes` contains exactly the 3 failed items and `successCount === 7`. Mock `nft.createEpisodeListing` to reject for episodes at index 3, 6, and 9.

2. **Seller earnings partial data aggregation** — `computeEarningsTotals(streams)`: given a `streams` object where 2 of 7 keys are `null` (timed out), verify the computed `totalEth` sums only the non-null streams, `isPartial === true`, and `unavailableStreams` lists the 2 null keys by name.

3. **Rights classification gate logic — `getVisibleCTAs(universe)`**: given `classification: 'fan'`, assert the returned CTA array is empty. Given `classification: 'original'`, assert all CTAs are present. Given `classification: undefined`, assert the returned array is empty (treats undefined as `'fan'`).

4. **Tip recovery mechanism — pending record check**: mock `AsyncStorage.getItem('loar_pending_tip_records')` to return 2 pending records (one with `retryCount: 0`, one with `retryCount: 2`). Mock `tips.recordTip` to succeed for the first and fail for the second. After the recovery run, assert: first entry removed from storage, second entry has `retryCount: 3` and was moved to `loar_failed_tip_records`.

5. **Tip recovery mechanism — idempotency**: mock `tips.recordTip` to return 200 for an already-recorded txHash. Assert the entry is removed from `loar_pending_tip_records` (success path, not counted as failure).

6. **Mint confirmation screen — `useMintFlow` state machine**: test state transitions `idle → estimating_gas → awaiting_signature → broadcasting → awaiting_confirmation → success`. Mock wagmi `writeContract` to resolve after 1 tick. Assert the `txHash` is set in state after broadcast and cleared from `pending` after confirmation.

7. **`seller.getEarningsSummary` handler — partial timeout**: inject a test middleware that delays the `licensingFees` sub-call by 3000ms (> the 2000ms timeout). Assert the response includes `licensingFees: null` with `status: 'timed_out'` and all other streams with real data.

8. **`tips.recordTip` — forged txHash rejection**: provide a `txHash` that corresponds to a valid Sepolia transaction but with `to` pointing to the wrong address (not the `creatorAddress`). Mock the RPC call response. Assert the handler returns 400 with `"Transaction recipient does not match creator"`.

9. **`licensing.respondToLicenseRequest` — double counter prevention**: create a license request in `countered` status. Call `respondToLicenseRequest` with `action: 'counter'` as the original requester. Assert 400 with `"Counter-offers are limited to one round"`.

10. **Universe storefront cache invalidation**: call `nft.createEpisodeListing` and assert that `storefrontCache/{universeId}` is deleted (or overwritten with a fresh document) as part of the same handler execution, before the handler returns.

11. **Rights gate server-side — `nft.createEpisodeListing` on fan-lane universe**: create a universe document with `classification: 'fan'`. Call `createEpisodeListing`. Assert 403 with `"Fan-lane universes cannot list NFTs for sale"`.

12. **`collabs.applyToCall` — duplicate rejection**: apply to a call with `userId: 'user-A'`. Apply again with the same `userId` and `callId`. Assert the second call returns a `DUPLICATE_APPLICATION` error code without creating a second application document.

**Mocks required:**

- `wagmi.writeContract` — mock via `vi.mock('wagmi')` with a controllable `Promise` factory
- `expo-sharing` — mock `shareAsync` to capture the file path and return immediately
- `victory-native` — mock the entire module to render a `<View testID="chart" />` in unit test environments (Victory Native has native dependencies that break Jest)
- `expo-document-picker` — mock `getDocumentAsync` to return a fixed `{ uri: 'file://test.jpg', name: 'test.jpg', size: 1024 }`
- `@react-native-async-storage/async-storage` — use `@react-native-async-storage/async-storage/jest/async-storage-mock`

#### Integration Tests

10 specific integration tests run against a Firestore emulator (port 8080) and a Hono test server instance:

**Firestore emulator seed for all tests:** the emulator is seeded before each test suite with:

- `universes/{testUniverseId}`: `{ ownerAddress: '0xCreator', classification: 'original', name: 'Test Universe' }`
- `universes/{fanUniverseId}`: `{ ownerAddress: '0xCreator', classification: 'fan', name: 'Fan Universe' }`
- `users/{testUserId}`: `{ walletAddress: '0xCreator' }`
- `users/{buyerUserId}`: `{ walletAddress: '0xBuyer' }`
- `episodeListings/{testEpisodeId}`: `{ universeId: testUniverseId, price: '10000000000000000', maxSupply: 10, mintedCount: 0 }`
- `licenseRequests/{testRequestId}`: `{ universeId: testUniverseId, requesterId: buyerUserId, status: 'pending' }`
- `collabCalls/{testCallId}`: `{ universeId: testUniverseId, ownerId: testUserId, role: 'Writer', revSplitBps: 1500, status: 'open' }`

**Test 1: `seller.getEarningsSummary` partial timeout**
Inject a delay middleware that adds a 2500ms delay to any Firestore read from the `licensingFees` collection. Call `getEarningsSummary({ universeId: testUniverseId })` as `0xCreator`. Assert response shape includes all 7 stream keys; `licensingFees` key has `{ data: null, status: 'timed_out' }`; all other keys have `{ data: { totalEth: expect.any(String) }, status: 'ok' }`; response arrives in < 4500ms.

**Test 2: `tips.recordTip` with forged txHash**
Mock the Sepolia RPC `eth_getTransactionReceipt` to return a receipt where `to` is `0xSomeOtherAddress` (not the `creatorAddress` passed in the request). Call `recordTip({ txHash: '0xforged', creatorAddress: '0xCreator', amountWei: '1000000000000000' })` authenticated as `0xBuyer`. Assert HTTP 400 and `"Transaction recipient does not match creator"`.

**Test 3: `licensing.respondToLicenseRequest` called by non-owner**
Call `respondToLicenseRequest({ requestId: testRequestId, action: 'accept' })` authenticated as `0xBuyer` (not the universe owner). Assert HTTP 403 and `"Only the universe owner can respond to license requests"`.

**Test 4: `collabs.applyToCall` duplicate rejection**
Call `applyToCall({ callId: testCallId })` authenticated as `0xBuyer`. Assert success (201). Call `applyToCall({ callId: testCallId })` again as `0xBuyer`. Assert error with code `DUPLICATE_APPLICATION`. Verify only one application document exists in `collabApplications` for this `(callId, applicantId)` pair.

**Test 5: `ads.recordImpression` → `ads.getImpressions` consistency**
Call `ads.recordImpression({ slotId: testSlotId, viewerAddress: '0xViewer1' })` 5 times with distinct viewer addresses. Then call `ads.getImpressions({ slotId: testSlotId })`. Assert `totalImpressions === 5`, `uniqueWallets === 5`. Call `recordImpression` again with `'0xViewer1'` (duplicate viewer). Assert `totalImpressions === 6`, `uniqueWallets === 5` (same wallet, new impression, not a new unique).

**Test 6: `nft.createEpisodeListing` on fan-lane universe**
Call `createEpisodeListing({ universeId: fanUniverseId, title: 'Test', price: '10000000000000000', maxSupply: 10 })` authenticated as `0xCreator`. Assert HTTP 403 and `"Fan-lane universes cannot list NFTs for sale"`.

**Test 7: `licensing.requestLicense` — self-request prevention**
Call `requestLicense({ universeId: testUniverseId, intendedUse: 'commercial', proposedFeeEth: '0.1' })` authenticated as `0xCreator` (the universe owner). Assert HTTP 400 and `"Universe owners cannot request a license for their own universe"`.

**Test 8: `seller.getEarningsSummary` — authorization check**
Call `getEarningsSummary({ universeId: testUniverseId })` authenticated as `0xBuyer` (not the owner). Assert HTTP 403 and `"You do not have permission to view earnings for this universe"`.

**Test 9: `tips.recordTip` — idempotency (same txHash twice)**
Seed `processedTxHashes/0xduplicateTx` as already existing. Mock RPC to return a valid receipt. Call `recordTip({ txHash: '0xduplicateTx', creatorAddress: '0xCreator', amountWei: '1000000000000000' })` as `0xBuyer`. Assert HTTP 200. Assert no new document was created in `tipPayments` (document count unchanged). Assert no new entry in `processedTxHashes`.

**Test 10: `licensing.respondToLicenseRequest` — counter-offer round limit**
Update `licenseRequests/{testRequestId}` in the emulator to `status: 'countered'`. Call `respondToLicenseRequest({ requestId: testRequestId, action: 'counter', counterTerms: { feeEth: '0.5' } })` authenticated as `0xBuyer` (the original requester attempting a second counter). Assert HTTP 400 and `"Counter-offers are limited to one round"`.

#### E2E Tests (Maestro)

8 Maestro flows. Flow files live in `apps/mobile/e2e/workstream3/`.

**Flow 1 (buy-side full path): Storefront → Episode Detail → Mint → Portfolio**

1. Launch app, authenticate as buyer wallet
2. Navigate to universe storefront for `testUniverseId`
3. Assert all storefront sections visible (NFTs, subscriptions, tips)
4. Tap episode card for `testEpisodeId`
5. Assert episode detail sheet opens with price and supply
6. Tap "Mint" → confirm in connected wallet
7. Assert transaction confirmation screen shows tx hash
8. Navigate to Portfolio (Workstream 2 screen)
9. Assert the minted episode NFT appears in the owned collection
   This flow requires Sepolia testnet with funded test wallet. Estimated duration: 60–90 seconds.

**Flow 2 (sell-side full path): Create Episode Listing → Appears on Storefront**

1. Launch app, authenticate as creator wallet
2. Navigate to Sell → Seller Hub → Episode NFTs section → "Add Episode"
3. Fill title, description, price (0.01 ETH), max supply (100)
4. Tap "List Episode"
5. Assert success toast "Episode listed"
6. Navigate to universe storefront (Buy perspective)
7. Assert the new episode card appears in the NFT section
   This flow tests end-to-end storefront cache invalidation.

**Flow 3 (direct tip): Send Tip → Creator Receives Push Notification**

1. Launch app on physical test device (Device A) as buyer, push notifications granted
2. Launch app on physical test device (Device B) as creator
3. On Device A: open storefront, scroll to Tips section, tap "Send Tip", select 0.01 ETH preset, confirm
4. Assert Device A shows "Tip sent!" success state
5. Assert Device B receives push notification within 10 seconds: "You received a 0.01 ETH tip from [buyer]"
   This flow requires two physical devices and real-time FCM delivery. Flagged as physical-device-only.

**Flow 4 (collab marketplace): Post Open Call → Apply → Accept**

1. Launch app as creator, navigate to Sell → Collab Calls → "Post Open Call"
2. Fill role (Writer), revenue split (15%), episode count (5), description
3. Tap "Post Call" → assert success
4. Switch to buyer persona (second test account)
5. Navigate to Collab feed, find the posted call
6. Tap "Apply", write pitch message, tap "Submit Application"
7. Switch back to creator persona
8. Navigate to Sell → Collab Calls → [posted call] → Applications
9. Assert buyer's application appears
10. Tap "Accept" → assert status updates to "Active"

**Flow 5 (rights gate): No Purchase CTAs on Fan-Lane Universe Storefront**

1. Launch app as buyer
2. Navigate to storefront for a universe with `classification: 'fan'`
3. Assert: no "Mint" buttons present
4. Assert: no "Subscribe" buttons present
5. Assert: no "Send Tip" button present
6. Assert: a "Fan Creation" badge is visible
7. Assert: no price labels anywhere on the screen
8. Tap every tappable element — none should open a purchase flow

**Flow 6 (seller hub): Earnings Summary Loads and Chart Is Interactive**

1. Launch app as creator with seeded earnings data (at least 30 days of test transactions)
2. Navigate to Sell → Seller Hub
3. Assert headline total is non-zero
4. Assert revenue chart renders with 30 bars visible
5. Tap individual bars — assert a tooltip appears with day + amount
6. Tap "View as table" toggle — assert FlatList renders 30 rows
7. Tap stream breakdown card for "Episode NFTs" — assert stream detail sheet opens

**Flow 7 (ad slot): Browse Slot → Place Bid → Creator Accepts**

1. Launch as sponsor (buyer) account
2. Navigate to a universe storefront → scroll to "Sponsor This Universe" section
3. Tap "View Ad Slots" → assert slot list loads
4. Tap a slot → assert slot detail shows placement type, audience size, min bid
5. Tap "Place Bid" → enter bid (0.05 ETH) and creative URL → Submit
6. Assert success "Bid submitted"
7. Switch to creator account → navigate to Sell → Ad Slots → sponsor inbox
8. Assert bid appears with creative URL visible
9. Tap "Accept Bid" → assert slot status updates to "Sponsored"

**Flow 8 (subscription): Subscribe to Tier → Manage Subscription**

1. Launch as buyer
2. Navigate to storefront → subscriptions section
3. Tap "Collector" tier card → assert tier detail sheet opens
4. Tap "Subscribe" → confirm in wallet
5. Assert success state with confirmation of tier and billing period
6. Navigate back to storefront → subscriptions section
7. Assert tier card now shows "Subscribed" badge
8. Tap "Manage" → assert subscription management sheet opens with "Cancel" option

**Device matrix:**

- iOS 16+ simulator (Xcode): Flows 1, 2, 4, 5, 6, 7, 8
- Android 13+ emulator (AVD): Flows 1, 2, 4, 5, 6, 7, 8
- Physical iOS device (iPhone 12+): Flow 3 (push notification) + Flow 1 (full mint with real wallet)
- Physical Android device (Pixel 6+): Flow 3 (push notification)

**CI integration:**

- **Block PR merge:** Flows 5 (rights gate) and 6 (seller hub load) run on every PR in CI (simulator only, no wallet interaction). These are fast and do not require funded wallets.
- **Run on merge to main:** Flows 1, 2, 4, 7, 8 run on merge using a funded Sepolia test wallet. These may take 2–3 minutes per flow due to Sepolia confirmation times.
- **Pre-release only:** Flow 3 (physical device push notification) runs manually in the pre-release checklist. Not automated in CI due to physical device requirement.

#### Load Tests

All load tests run against a staging environment backed by a dedicated Firestore project and Sepolia testnet.

**`seller.getEarningsSummary` — 500 concurrent creators:**
Simulate 500 simultaneous requests from unique authenticated users (unique JWTs, unique `universeId` per request). Each request triggers a 7-way Firestore fan-out. Measure: p50, p95, p99, error rate, partial response rate. Pass criteria: p95 < 3000ms, error rate < 0.5%. If Firestore quota limits are hit (reads/second), the `creatorEarnings` running-total document pre-aggregation (Open Question #6) must absorb the load — the handler should read the summary document first and fall back to fan-out only if the summary document is stale or missing.

**`collabs.listOpenCalls` — 2000 concurrent readers:**
This is a public endpoint (no authentication required to browse open calls). Simulate 2000 simultaneous GET requests with varying `page` and `sort` parameters. Measure: p50, p95, error rate. Pass criteria: p95 < 500ms, error rate < 0.1%. Server-side cache (Redis or Firestore cache document) is required to pass this threshold — raw Firestore reads at this volume will exhaust connection pools. The endpoint must return from cache for all requests sharing the same query fingerprint (sort + page combination).

**Universe Storefront — 1000 concurrent views:**
Simulate 1000 concurrent `storefront.get({ universeId: 'popularUniverse' })` requests (same universe). Test two scenarios:

- Cache hit: the `storefrontCache/{universeId}` document exists and is fresh. Pass criteria: p95 < 200ms (single Firestore read from cache document).
- Cache miss: the cache document is deleted before the test. Pass criteria: p95 < 1500ms (fan-out reads for all sections). Verify the cache is rebuilt by the first request (or a dedicated cache-warming job) and subsequent requests hit the cache.

**NFT mint — 50 concurrent mints (max supply = 50):**
Simulate 50 concurrent calls to `nft.recordMint`, each with a unique (but pre-confirmed on Sepolia) txHash, for the same episodeId with `maxSupply: 50`. All 50 transactions were broadcast to Sepolia separately and confirmed. The test verifies:

- Exactly 50 `mintedCount` increments are written to Firestore (no lost writes due to concurrent increment races — use Firestore `FieldValue.increment(1)` which is atomic).
- No `mintedCount` exceeds 50 after all 50 calls complete.
- All 50 `recordMint` calls return 200 (not 429 or 500).
- The `processedTxHashes` collection contains exactly 50 entries after the test.
  Note: the contract prevents over-minting on-chain. This test specifically targets the off-chain Firestore write path for correctness under concurrency.

---

### 5. Observability and Alerting

#### Server-side Metrics

All metrics exported via OpenTelemetry to the platform's observability backend (Grafana Cloud or equivalent).

**`seller.getEarningsSummary` latency:**

- Export histogram: `seller_earnings_summary_duration_ms` with labels `{ universe_id (sampled), partial: boolean }`
- Export per-sub-call breakdown: `seller_earnings_subcall_duration_ms` with labels `{ stream: 'episodeMints' | 'subscriptionPayments' | 'licensingFees' | 'adPayments' | 'collabPayments' | 'treasuryDistributions' | 'tipPayments', status: 'ok' | 'timed_out' | 'error' }`
- Export counter: `seller_earnings_partial_total` — increments whenever any sub-call returns non-ok status. Labels: `{ stream }`

**Mint recording rate:**

- Export counter: `nft_record_mint_success_total` — increments on each successful `recordMint`
- Export counter: `nft_onchain_mint_events_total` — increments on each Ponder `Mint` event handler execution
- Divergence ratio computed in alerting rules: `(nft_onchain_mint_events_total - nft_record_mint_success_total) / nft_onchain_mint_events_total` — target < 1%

**Tip recording:**

- Export counter: `tips_record_tip_success_total`
- Export counter: `tips_record_tip_failure_total` with labels `{ reason: 'rpc_verification_failed' | 'firestore_error' | 'network_error' | 'rate_limited' }`
- Export gauge: `tips_pending_async_storage_records` — surfaced via a health check endpoint `GET /health/tips-pending` that reads from a Firestore document `systemHealth/tipsPendingCount` (updated by a background job that aggregates client-reported pending counts via a lightweight beacon endpoint `POST /api/tip-recovery-beacon`)

**Canon finalization lag:**

- Export gauge: `canon_submissions_past_deadline_unfinalized` — computed by a Bun cron job (every 10 minutes) that counts `canonSubmissions` documents where `votingDeadline < now()` and `status === 'VOTING'`. High values indicate creator friction (creators not finalizing).

**Collab call fill rate:**

- Export gauge: `collab_calls_with_applicants_ratio` — computed hourly: `count(calls with ≥1 application) / count(open calls)`. Tracked as a platform health metric.

**License request response time:**

- Export histogram: `licensing_request_response_time_hours` — time delta between `requestedAt` and `respondedAt` on license request documents, recorded by the `respondToLicenseRequest` handler.

**`ads.getImpressions` metrics:**

- Export histogram: `ads_get_impressions_duration_ms`
- Export counter: `ads_get_impressions_empty_total` — increments when the result has `totalImpressions === 0`

#### Client-side Metrics

All client metrics sent to the analytics pipeline (Mixpanel or Amplitude) via the same event-batching layer used for product analytics.

**Storefront section load time:**

- On storefront mount, start a timer per section. When each section's React Query data resolves (transitions from `isLoading: true` to `isLoading: false`), emit `storefront_section_loaded` with `{ section, duration_ms }`. Each section is timed independently.

**Storefront-to-purchase conversion funnel:**

- `storefront_viewed` → `item_tapped` → `confirm_shown` → `purchase_completed`
- Funnel is tracked per-session with a session ID. Drop-off at each step is computed in the analytics dashboard.

**Seller Hub tab view rate:**

- `seller_hub_viewed` events are aggregated per-user per-week. Creators who emit at least one `seller_hub_viewed` event in a 7-day window are counted as "engaged sellers."

**Rights gate hit rate:**

- `rights_gate_hit` events (see Section 6) are aggregated by `cta_suppressed`. High hit rates for specific CTAs indicate either a mismatch between creator intent and classification, or a classification bug.

#### Alerting

Alerts are configured in Grafana (or equivalent) with PagerDuty routing.

**P1 — Immediate response required:**

- **`seller.getEarningsSummary` p95 > 5000ms** (5-minute window): Firestore fan-out query performance degradation. Runbook: check Firestore read quotas, check if the `creatorEarnings` pre-aggregation document is being used, check for collection scan queries (missing indexes).

- **Mint recording divergence > 1%** (30-minute window, minimum 10 events): on-chain mints not reflected in Firestore. Runbook: check Ponder indexer status (is it syncing?), check `recordMint` error rate, check if the Sepolia RPC used by Ponder is responding.

- **Pending tip records count > 100** (global aggregate, evaluated every 15 minutes via the health endpoint): systemic failure of `recordTip`. Runbook: check `tips.recordTip` error rate, check Sepolia RPC, check Firestore write availability. This is P1 because users have already sent ETH and their earnings are not recorded.

**P2 — Respond within 1 business hour:**

- **Tip recording success rate < 95%** (1-hour window, minimum 20 attempts): elevated `recordTip` failures. Runbook: check Sepolia RPC latency, check `processedTxHashes` collection for lock contention.

- **`collabs.listOpenCalls` p95 > 1000ms** (10-minute window): public endpoint degradation. Runbook: check server-side cache hit rate (should be > 90%), check Firestore index on `status + createdAt`.

**P3 — Review next business day:**

- **Rights gate server-side rejection rate > 5%** (1-hour window, minimum 50 requests): clients are attempting gated operations despite the fan-lane classification. Indicates a client bug where the rights classification is not being checked before presenting CTAs, or a client version that has not received the latest flag state.

- **Canon submissions past deadline and unfinalized > 10** (daily): creator friction in the canon finalization flow. Review and reach out to affected creators.

#### Dashboards

**Dashboard 1: Storefront Commerce (daily)**

- Storefront views (total and by universe — top 20)
- Conversion funnel: views → item tapped → confirm shown → purchase completed (with drop-off % at each step)
- NFT mint rate (mints per storefront view)
- Subscription rate (subscribes per storefront view)
- Tip rate (tips per storefront view)
- 30-day trend for each conversion metric

**Dashboard 2: Seller Hub Health**

- `getEarningsSummary` p50/p95/p99 latency (time-series)
- Per-sub-call partial failure rate (stacked bar by stream, daily)
- Total earnings recorded per day across all streams (platform-wide)
- Creator Seller Hub adoption rate: % of universe owners who opened Seller Hub in the last 7 days

**Dashboard 3: Market Integrity**

- Mint recording divergence rate (time-series, alert threshold marked at 1%)
- Tip pending record count (gauge, alert threshold marked at 100)
- Rights gate rejection rate by endpoint (bar chart: `createEpisodeListing`, `requestLicense`, `recordTip`, `configureTier`)
- `recordMint` idempotent duplicate rate (how often the same txHash is submitted twice — spikes indicate client retry loops)

---

### 6. Analytics Instrumentation

Every analytics event for Workstream 3 with exact trigger and typed properties:

```
storefront_viewed
  trigger: Universe Storefront screen mounts with data (React Query status transitions to 'success')
  properties: {
    universe_id: string,
    rights_classification: 'fan' | 'original' | 'licensed',
    sections_shown: Array<'episodes' | 'subscriptions' | 'merch' | 'canon' | 'ads' | 'tip'>,
    has_nfts: boolean,
    has_subscriptions: boolean,
    has_merch: boolean,
    has_tips: boolean,
    section_count: number
  }

storefront_section_tapped
  trigger: user taps a section header or scrolls into a section (intersection observer equivalent via onViewableItemsChanged)
  properties: {
    universe_id: string,
    section: 'episodes' | 'subscriptions' | 'merch' | 'canon' | 'ads' | 'tip'
  }

storefront_section_loaded
  trigger: each section's React Query data resolves (isLoading transitions to false)
  properties: {
    universe_id: string,
    section: 'episodes' | 'subscriptions' | 'merch' | 'canon' | 'ads' | 'tip',
    duration_ms: number,
    item_count: number
  }

episode_nft_detail_viewed
  trigger: episode detail bottom sheet fully opens (onAnimate callback reaches open position)
  properties: {
    episode_id: string,
    universe_id: string,
    price_eth: number,
    supply_remaining: number,
    supply_total: number | null,
    is_sold_out: boolean
  }

mint_initiated
  trigger: user taps "Confirm and Mint" on the confirmation sheet (before writeContract is called)
  properties: {
    episode_id: string,
    universe_id: string,
    price_eth: number
  }

mint_completed
  trigger: writeContract transaction confirmed (2 blocks) AND nft.recordMint succeeds
  properties: {
    episode_id: string,
    universe_id: string,
    tx_hash: string,
    duration_ms: number,   // from mint_initiated to mint_completed
    gas_used: number
  }

mint_failed
  trigger: writeContract rejects, transaction reverts, or recordMint fails
  properties: {
    episode_id: string,
    universe_id: string,
    reason: 'reverted' | 'gas_failure' | 'insufficient_balance' | 'record_failure' | 'wallet_cancelled',
    duration_ms: number   // from mint_initiated to failure
  }

subscription_viewed
  trigger: user taps a subscription tier card on the storefront (tier detail sheet opens)
  properties: {
    universe_id: string,
    tier: string,
    price_eth: number,
    feature_count: number
  }

subscription_completed
  trigger: subscriptions.subscribe tRPC call returns success
  properties: {
    universe_id: string,
    tier: string,
    price_eth: number,
    duration_ms: number   // from tap to success
  }

subscription_duplicate_redirected
  trigger: subscriptions.subscribe returns SUBSCRIPTION_ALREADY_ACTIVE and user is redirected to manage sheet
  properties: {
    universe_id: string,
    tier: string
  }

tip_initiated
  trigger: user taps "Send Tip" with a confirmed amount (before wallet interaction begins)
  properties: {
    universe_id: string,
    amount_eth: number,
    is_preset: boolean,   // whether user chose a preset amount or typed a custom one
    has_message: boolean
  }

tip_completed
  trigger: ETH transfer confirmed on-chain (2 blocks) AND recordTip succeeds
  properties: {
    universe_id: string,
    amount_eth: number,
    had_message: boolean,
    duration_ms: number,   // from tip_initiated to tip_completed
    tx_hash: string
  }

tip_failed
  trigger: wallet rejects, transaction fails, or permanent recordTip failure (after 3 retries)
  properties: {
    universe_id: string,
    reason: 'wallet_cancelled' | 'insufficient_balance' | 'network_error' | 'record_failure_permanent',
    amount_eth: number
  }

tip_record_recovery_attempted
  trigger: usePendingTipRecovery hook finds a pending record and retries recordTip
  properties: {
    universe_id: string,
    tx_hash: string,
    retry_count: number   // 1, 2, or 3
  }

tip_record_recovery_succeeded
  trigger: retry of recordTip succeeds
  properties: {
    universe_id: string,
    tx_hash: string,
    retry_count: number
  }

tip_record_recovery_failed_permanent
  trigger: retry count reaches 3 and persistent alert is surfaced
  properties: {
    universe_id: string,
    tx_hash: string
  }

canon_submission_viewed
  trigger: canon submission detail sheet opens
  properties: {
    submission_id: string,
    universe_id: string,
    status: 'VOTING' | 'ACCEPTED' | 'REJECTED',
    vote_count: number,
    days_remaining: number | null   // null if no deadline
  }

canon_voted
  trigger: marketplace.vote tRPC call succeeds
  properties: {
    submission_id: string,
    universe_id: string,
    vote: 'for' | 'against',
    weight: number   // governance token balance at time of vote
  }

license_request_sent
  trigger: licensing.requestLicense tRPC call succeeds
  properties: {
    universe_id: string,
    intended_use: string,
    proposed_fee_eth: number
  }

license_request_responded
  trigger: licensing.respondToLicenseRequest tRPC call succeeds (creator-side event)
  properties: {
    universe_id: string,
    request_id: string,
    action: 'accept' | 'counter' | 'reject',
    response_time_hours: number   // time since requestedAt
  }

ad_slot_viewed
  trigger: user opens ad slot detail sheet (sponsor browsing view)
  properties: {
    slot_id: string,
    universe_id: string,
    placement_type: 'banner' | 'character_mention' | 'product_placement' | 'audio_mention',
    min_bid_eth: number,
    current_bid_count: number
  }

ad_bid_placed
  trigger: ads.placeBid tRPC call succeeds
  properties: {
    slot_id: string,
    universe_id: string,
    bid_eth: number
  }

ad_impression_report_viewed
  trigger: Impression Report screen mounts with data
  properties: {
    slot_id: string,
    universe_id: string,
    total_impressions: number,
    unique_wallets: number,
    period_days: number
  }

ad_pitch_card_exported
  trigger: user taps "Export Pitch Card" and share sheet appears
  properties: {
    slot_id: string,
    universe_id: string,
    total_impressions: number,
    duration_ms: number   // from tap to share sheet open
  }

collab_call_viewed
  trigger: collab call detail sheet opens (from feed or from Seller Hub)
  properties: {
    call_id: string,
    universe_id: string,
    role: string,
    rev_split_bps: number,
    applicant_count: number,
    days_open: number
  }

collab_applied
  trigger: collabs.applyToCall tRPC call succeeds
  properties: {
    call_id: string,
    universe_id: string,
    role: string,
    rev_split_bps: number
  }

collab_application_accepted
  trigger: collabs.acceptApplication tRPC call succeeds (creator-side event)
  properties: {
    call_id: string,
    universe_id: string,
    applicant_id: string,
    days_since_posted: number
  }

seller_hub_viewed
  trigger: Seller Hub screen mounts and getEarningsSummary returns (success or partial)
  properties: {
    universe_id: string,
    period: '7d' | '30d' | '90d' | 'all',
    total_eth: number,
    stream_count: number,
    available_stream_count: number,   // excludes timed-out streams
    is_partial: boolean
  }

seller_hub_period_changed
  trigger: creator changes the time period selector in Seller Hub
  properties: {
    universe_id: string,
    from_period: '7d' | '30d' | '90d' | 'all',
    to_period: '7d' | '30d' | '90d' | 'all'
  }

seller_stream_tapped
  trigger: creator taps a stream breakdown card in Seller Hub
  properties: {
    universe_id: string,
    stream: 'episode_nfts' | 'subscriptions' | 'licensing' | 'ads' | 'collabs' | 'treasury' | 'tips',
    stream_total_eth: number,
    stream_percentage: number   // percentage of total earnings
  }

seller_chart_table_toggled
  trigger: creator taps "View as table" / "View as chart" toggle on the revenue chart
  properties: {
    universe_id: string,
    to_view: 'table' | 'chart'
  }

episode_listed
  trigger: nft.createEpisodeListing tRPC call succeeds
  properties: {
    episode_id: string,
    universe_id: string,
    price_eth: number,
    max_supply: number | null,
    is_bulk: boolean,
    bulk_index: number | null,   // position in bulk sequence (1-10), null if not bulk
    bulk_total: number | null
  }

bulk_listing_completed
  trigger: bulk listing flow finishes (all episodes attempted, whether success or partial)
  properties: {
    universe_id: string,
    total_attempted: number,
    success_count: number,
    failure_count: number,
    duration_ms: number   // total time for all listing calls
  }

open_collab_call_posted
  trigger: collabs.createOpenCall tRPC call succeeds
  properties: {
    universe_id: string,
    role: string,
    rev_split_bps: number,
    episode_count: number
  }

merch_item_viewed
  trigger: merch item detail sheet opens
  properties: {
    merch_id: string,
    universe_id: string,
    price_usd: number,
    category: string
  }

merch_purchased
  trigger: Stripe payment intent confirmed and merch order created in Firestore
  properties: {
    merch_id: string,
    universe_id: string,
    price_usd: number
  }

rights_gate_hit
  trigger: rights classification gate suppresses a purchase CTA (client-side check detects fan-lane classification and hides the CTA)
  properties: {
    universe_id: string,
    classification: 'fan',
    cta_suppressed: 'mint' | 'subscribe' | 'tip' | 'merch_buy' | 'license_request' | 'ad_bid'
  }

storefront_rights_badge_tapped
  trigger: user taps the rights classification badge on a storefront
  properties: {
    universe_id: string,
    classification: 'fan' | 'original' | 'licensed'
  }
```

---

### 7. Rollout Strategy

#### Feature Flags

All flags are managed via the platform's feature flag service (LaunchDarkly or a Firestore-backed flag document at `featureFlags/workstream3`). Flag state is fetched at app launch and cached in-memory for the session. Flags default to `false` (off) in all environments unless explicitly enabled.

| Flag                    | Kill switch type | Degraded state when off                                              | Notes                                                                                                                                                            |
| ----------------------- | ---------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storefront_v1`         | Soft disable     | Universe profile page shows "Shop coming soon" placeholder           | Master gate for the entire storefront surface                                                                                                                    |
| `episode_nft_mint`      | Hard kill        | "Mint" button hidden; episode cards show price but no action         | Hard because a bug here burns real ETH                                                                                                                           |
| `subscription_purchase` | Hard kill        | Subscription tier cards shown (read-only), "Subscribe" button hidden | Hard because a bug here charges real ETH                                                                                                                         |
| `merch_purchase`        | Soft disable     | Merch section hidden entirely                                        | Soft — no on-chain money, Stripe handles refunds                                                                                                                 |
| `canon_marketplace`     | Soft disable     | Canon section hidden on storefront                                   | Soft — no direct money movement                                                                                                                                  |
| `ip_licensing_requests` | Soft disable     | Licensing section shown read-only; "Request License" CTA hidden      | Soft — licensing fees are off-chain in v1                                                                                                                        |
| `ad_slot_bidding`       | Hard kill        | Ad slot section shown (read-only); bid button hidden                 | Hard because bids involve ETH                                                                                                                                    |
| `direct_tips`           | Hard kill        | Tips section hidden entirely; "Send Tip" CTA removed                 | **HARDEST kill switch in the workstream.** A bug here means real ETH is transferred but not recorded. Disable immediately on any tip recording divergence alert. |
| `collab_marketplace`    | Soft disable     | Collab feed accessible (read-only); "Apply" and "Post Call" hidden   | Soft — no direct money in apply flow                                                                                                                             |
| `seller_hub_v1`         | Soft disable     | Sell tab shows "Seller Hub coming soon"                              | Master gate for seller-side                                                                                                                                      |
| `earnings_summary`      | Soft disable     | Seller Hub shows "Earnings data loading…" indefinitely               | Fallback while `getEarningsSummary` is being stabilized                                                                                                          |
| `bulk_episode_listing`  | Soft disable     | Only single episode listing available; bulk selection UI hidden      | Soft — degrades gracefully to single-item flow                                                                                                                   |
| `impression_report`     | Soft disable     | Ad slot detail shows "Impression reporting coming soon"              | Soft — read-only feature                                                                                                                                         |
| `sponsor_pitch_card`    | Soft disable     | Export button hidden on impression report screen                     | Soft — no money involved                                                                                                                                         |

**Hard vs. soft distinction:**

- Hard kill switch: when the flag is turned off, the feature disappears immediately with no user-facing explanation. The UI renders as if the feature does not exist. Used when a live bug would cause real ETH to be transferred, not recorded, or incorrectly attributed.
- Soft disable: when the flag is turned off, the feature shows a "coming soon" state or is hidden. Used when the risk is UX degradation, not financial loss.

**`direct_tips` hard kill switch protocol:** if the P1 alert fires for "pending tip records > 100" or "tip recording success rate < 95%", the incident response includes immediate flag disable via the emergency flag update endpoint (`POST /api/admin/flags` authenticated with an admin JWT). This removes the Send Tip CTA from all storefronts within the next flag refresh cycle (≤ 60 seconds). The flag is not re-enabled until the root cause is confirmed resolved and a post-mortem is written.

#### Staged Rollout

**Internal alpha (week 1–2 before any external access):**
Test these specific money flows internally with team wallets on Sepolia:

1. Mint a single episode NFT end-to-end (broadcast → confirm → recordMint → portfolio reflects ownership)
2. Mint 50 episodes at full max supply — verify exact sell-out behavior
3. Send a 0.001 ETH tip to a team creator wallet — verify `recordTip` succeeds and earnings appear in Seller Hub
4. Subscribe to a subscription tier — verify subscription status appears in manage screen
5. Place an ad bid — verify it appears in sponsor inbox
6. Create a bulk listing of 10 episodes — verify all succeed and storefront reflects all 10
7. Trigger `direct_tips` kill switch — verify tips CTA disappears within 60 seconds
8. Simulate a `recordTip` failure (kill the server mid-request) — verify txHash is stored in AsyncStorage and retried on foreground

No external user (not even closed beta invitees) accesses the market surface until all 8 flows pass on Sepolia with team wallets.

**Closed beta (weeks 3–4):**

- Invite up to 50 creators and 100 fans from the waitlist.
- Transaction cap: **0.1 ETH per user per day** (combined across all transaction types). This cap is enforced in the `subscriptions.subscribe`, `tips.recordTip`, and `ads.placeBid` handlers via a daily-spend tracker in Firestore (`dailySpend/{userId}_{date}`). On Sepolia this is testnet ETH, but the discipline establishes the pattern for mainnet migration.
- Monitor: mint divergence rate, tip recording rate, seller hub adoption, any P1 alert triggers.
- End of closed beta go/no-go gate: mint recording divergence < 0.5% over 7 days, tip recording success rate > 98% over 7 days, zero P1 alerts unresolved.

**Open beta:**

- Lift the 0.1 ETH/day transaction cap.
- Remove closed beta invite requirement — any user can access the market surface.
- Continue monitoring all P1 and P2 metrics.
- `direct_tips` remains hard-kill-switch-eligible throughout open beta.

**GA (general availability) go/no-go criteria:**
All of the following must be true simultaneously for 7 consecutive days:

- Mint recording divergence < 0.1% (on-chain mints not reflected in Firestore)
- Tip recording success rate > 99%
- `seller.getEarningsSummary` p95 < 2000ms
- Seller Hub weekly adoption rate > 40% of active creators (creators who have listed at least one item)
- Zero unresolved P1 alerts
- Zero critical accessibility issues flagged in VoiceOver/TalkBack testing

#### A/B Tests

**Test 1: Storefront section order — tips first vs. NFTs first**

- Control: NFTs section appears first on the storefront scroll
- Variant: Tips section appears first ("Support this creator" CTA at top)
- Allocation: 50/50 random split, assigned at universe storefront view
- Primary metric: total purchase conversion rate (any purchase completed / storefront viewed)
- Secondary metric: tip rate specifically (tips / storefront viewed) vs. NFT mint rate (mints / storefront viewed)
- Minimum sample: 1000 unique storefront views per variant before declaring a winner
- Decision: run for 4 weeks minimum. If tips-first lifts total conversion without significantly reducing NFT mints, adopt it as default.

**Test 2: Seller Hub default period — 30d vs. 7d**

- Control: Seller Hub opens with 30-day period selected
- Variant: Seller Hub opens with 7-day period selected
- Allocation: 50/50 split, assigned to creator accounts at first Seller Hub open
- Primary metric: time-on-screen (average seconds spent on Seller Hub per session)
- Secondary metric: `seller_hub_period_changed` event rate (how often creators override the default — high override rate signals the default is wrong)
- Decision: the period that results in longer time-on-screen with lower override rate is the better default for comprehension.

**Test 3: Collab call feed sort order — by recency vs. by revenue split offered**

- Control: collab calls sorted by `createdAt` descending (newest first)
- Variant: collab calls sorted by `revSplitBps` descending (highest revenue share first)
- Allocation: 50/50 split per user session
- Primary metric: collab application rate (`collab_applied` events / `collab_call_viewed` events)
- Secondary metric: application quality (accepted / applied ratio — requires creator feedback data)
- Decision: if revenue-split-first sort increases application rate without decreasing acceptance rate, adopt as default.

#### Rollback

**OTA rollback for non-on-chain features:**
All UI-only features (storefront display, seller hub view, collab feed, impression report, sponsor pitch card) can be rolled back via an Expo OTA update or via feature flag disable. No Firestore document corruption occurs from UI bugs in these features.

**On-chain features — what rollback can and cannot do:**
For mint, tip, subscription, and ad bid features: an OTA update or flag disable can hide the UI immediately. It cannot undo on-chain transactions. A user who has already sent ETH has sent it — that is permanent. Rollback actions are limited to:

- Hiding the UI for new transactions (prevent more ETH from being spent)
- Manually correcting off-chain Firestore records (if `recordMint` wrote incorrect data)
- Re-indexing from Ponder (if Firestore diverged from the chain)

**Incident response for mint over-recording or incorrect `recordMint`:**
If a bug causes `mintedCount` to be incorrect in Firestore (e.g., duplicate increments, missed increments):

1. Disable `episode_nft_mint` flag immediately.
2. Identify the block range of the incident (from timestamps of incorrect `recordMint` calls).
3. Run `npx ponder dev` pointing at the staging Firestore project with `fromBlock` set to the incident start block. Ponder will re-process all `Mint` events from that block and overwrite `mintedCount` with the on-chain truth.
4. Validate that Firestore `mintedCount` values match `EpisodeNFT.totalMinted(episodeId)` on-chain for all affected episodes.
5. Re-enable the flag after validation.
6. Write an incident report documenting the block range, affected episodes, and the fix.

**`seller.getEarningsSummary` running-total reconciliation:**
The `creatorEarnings/{uid}_{universeId}` document is a pre-aggregated running total updated by each payment mutation. If a payment mutation fails to update it (e.g., a Firestore write error in the mutation handler), the running total becomes stale. Reconciliation job specification:

- **Trigger:** manual CLI command `npx ts-node scripts/reconcile-earnings.ts --universeId <id>` or a scheduled Cloud Function (Pub/Sub trigger, daily at 02:00 UTC).
- **Logic:** for each `creatorEarnings` document, re-sum the source collections (`episodeMints`, `subscriptionPayments`, `licensingFees`, `adPayments`, `collabPayments`, `treasuryDistributions`, `tipPayments`) filtered by `universeId` and `creatorUid`. Compare the computed sum to the running total. If divergence > 0.0001 ETH, overwrite the running total document with the recomputed value and log the divergence to `earningsReconciliationLog` with the before/after amounts and timestamp.
- **Alert:** if the reconciliation job finds any divergence > 0.001 ETH on any universe, emit a P2 alert to the monitoring channel.

---

### 8. Accessibility Requirements

#### Screen Reader (VoiceOver / TalkBack)

**Universe Storefront linear navigation order:**
The full storefront must be navigable top-to-bottom by VoiceOver (iOS) and TalkBack (Android) in the following focus order:

1. Universe header (artwork — announce as "Universe artwork for [name]", `accessibilityRole="image"`)
2. Universe name (heading, `accessibilityRole="header"`)
3. Rights classification badge (e.g., "Original IP — this universe is creator-owned and available for purchase", `accessibilityRole="text"`)
4. Universe description (body text)
5. Section header: "Episode NFTs" (`accessibilityRole="header"`)
6. Episode cards (left-to-right in carousel): each card announced as described below
7. Section header: "Subscriptions" (`accessibilityRole="header"`)
8. Tier cards (vertical list)
9. Section header: "Merch" (if present)
10. Merch items
11. Section header: "Canon Marketplace" (if present)
12. Canon submissions
13. Section header: "Ad Slots" (if present)
14. Ad slot cards
15. Tips CTA section header: "Support [Creator Name]"
16. Preset tip amount buttons
17. "Send Tip" button

All sections that are absent (not configured by the creator) are skipped entirely — no focus stops on empty sections.

**Episode NFT card `accessibilityLabel` pattern:**
`"Episode [title]. [price] ETH to mint. [X] of [Y] remaining. Double-tap to view details."`
If the episode is sold out: `"Episode [title]. Sold out. All [Y] editions have been minted."`
If max supply is unlimited: `"Episode [title]. [price] ETH to mint. Unlimited supply. Double-tap to view details."`

**Subscription tier card `accessibilityLabel` pattern:**
`"[tier name] tier. [price] ETH per month. [N] features included. Double-tap to subscribe."`
If already subscribed: `"[tier name] tier. Currently subscribed. Renews [date]. Double-tap to manage your subscription."`

**Mint confirmation sheet focus management:**

- When the sheet opens: `autoFocus` on the sheet title element (`accessibilityRole="header"`). On iOS, this is implemented by calling `.focus()` on the title ref inside the `onOpen` callback of the bottom sheet library. On Android, use `AccessibilityInfo.setAccessibilityFocus(findNodeHandle(titleRef.current))`.
- When the sheet closes (success, failure, or user dismissal): focus is programmatically returned to the "Mint" button that opened the sheet. This is tracked via a `lastFocusedRef` that captures the Mint button's ref before the sheet opens.

**Revenue chart accessibility (Seller Hub):**
Victory Native charts do not expose individual data points to the accessibility tree by default. The chart renders as a single unlabeled SVG element to VoiceOver. Specification for accessible alternative:

- Add a "View as table" toggle button above the chart (`accessibilityLabel="View earnings as data table"`).
- When toggled to table view, the chart is unmounted and replaced with a `FlatList` where each item represents one day of data.
- Each `FlatList` item has `accessibilityRole="row"` and `accessibilityLabel` pattern: `"[Day, Month DD]: [X.XXXX] ETH"`.
- The FlatList itself has `accessibilityRole="list"` and `accessibilityLabel="Daily earnings for the last 30 days"`.
- The toggle persists per-session (stored in component state, not AsyncStorage — resets on each Seller Hub open).

**Direct tip amount selector:**

- Preset amounts (e.g., 0.001 ETH, 0.005 ETH, 0.01 ETH) each have `accessibilityLabel`: `"[X] ETH — approximately $[Y] USD. Double-tap to select."` The USD equivalent is computed from a cached ETH price (refreshed on screen mount via a lightweight price API call; if unavailable, omit the USD portion).
- Custom amount `TextInput`: `accessibilityLabel="Enter custom tip amount in ETH"`. As the user types, the `accessibilityValue={{ text: `${inputValue} ETH` }}` prop updates to announce the current value to the screen reader.
- Selected state: the selected preset has `accessibilityState={{ selected: true }}`.

#### Motor Accessibility

**Minimum touch target sizes:**

- "Mint" button: minimum 44×44pt. The button text area may be smaller for visual design — use `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}` to extend the hit area without changing the visual size.
- "Subscribe" button: minimum 44×44pt with `hitSlop` as needed.
- "Send Tip" button: minimum 44×44pt.
- "Buy" button on merch: minimum 44×44pt.
- Tip preset amount buttons: minimum 44×44pt each (these are small by design — expand with `hitSlop`).

**Bottom sheet dismissal:**
Every bottom sheet in Workstream 3 purchase flows (episode detail, mint confirmation, subscription detail, tip sheet, license request, ad bid, collab application, merch detail) must provide BOTH:

1. A visible close button (✕ icon, 44×44pt tap target) in the top-right corner of the sheet, `accessibilityLabel="Close"`.
2. Swipe-to-dismiss gesture.
   The swipe gesture alone is not sufficient — users who cannot perform precise swipe gestures must be able to dismiss via button tap.

**Collab application form submit button visibility:**
The "Submit Application" button must be visible without scrolling on a 375pt-wide screen (iPhone SE 3rd generation viewport). Design constraint: the form fields above the button (role description, pitch text area) must not exceed the available vertical space. The pitch text area uses a fixed height of 120pt (approximately 5 lines) rather than expanding dynamically, to keep the submit button visible at all times on 375pt-wide devices. Test this constraint in every UI review using the iPhone SE simulator.

#### Visual Accessibility

**Rights classification badges:**
The three rights classification states (fan, original, licensed) must be distinguishable by shape and icon in addition to color:

- Fan lane: star icon (⭐) + "Fan Creation" label + yellow/amber color
- Original IP: crown icon (👑) + "Original IP" label + blue/indigo color
- Licensed: handshake icon (🤝) + "Licensed" label + green color
  Each badge renders: `[icon] [label]` — the icon and label are always present. Color is additive, not the primary differentiator. When iOS Color Filters is set to grayscale (Settings → Accessibility → Display & Text Size → Color Filters → Grayscale), the fan/original/licensed states remain distinguishable by icon shape and text.

**Revenue chart bars — colorblind-accessible patterns:**
The 7 revenue streams in the Seller Hub stacked bar chart use distinct colors. For color-blind accessibility (deuteranopia affects ~8% of males), each stream must ALSO be distinguishable without relying on color alone.
Victory Native does not natively support bar hatching/fill patterns. The fallback specification:

- Each stream bar has a distinct colored border (2pt width) in addition to its fill color. Borders use colors that remain distinguishable in deuteranopia simulations.
- Each bar segment, when tapped, shows a tooltip that includes the stream name (text label) — not just the color legend.
- The "View as table" accessible alternative (Section 8 above) provides a fully color-free fallback for users who cannot distinguish the chart colors.

If a future Victory Native version adds pattern fills, migrate to: `episodeMints = solid`, `subscriptions = diagonal stripe`, `licensing = crosshatch`, `ads = dots`, `collabs = horizontal stripe`, `treasury = vertical stripe`, `tips = diamond pattern`.

**Earnings text contrast:**
All ETH amount values displayed in the Seller Hub (headline total, per-stream amounts, individual transaction amounts) must meet WCAG AA contrast ratio of 4.5:1 against their background in both dark mode and light mode.

- Light mode: ETH amounts rendered in `#1A1A2E` on `#FFFFFF` background — contrast ratio 18.5:1 (passes)
- Dark mode: ETH amounts rendered in `#F0F0FF` on `#0A0A1A` background — verify in contrast checker before each design system update
- The `accessibilityLabel` for ETH amounts always spells out the full value including units: "zero point zero one ETH" for `0.01 ETH` — do not rely on the screen reader's number parsing for financial values.

#### Accessibility Testing Protocol

**VoiceOver (iOS) full mint flow audit — required before every release candidate:**

1. Enable VoiceOver on iPhone simulator (iOS 16+)
2. Navigate to Universe Storefront
3. Verify linear focus order matches the specified order in Section 8
4. Tap episode card — verify announcement matches `accessibilityLabel` pattern
5. Confirm episode detail sheet opens with focus on sheet title
6. Navigate to "Mint" button — verify label and role
7. Activate Mint — verify confirmation sheet receives focus
8. Close confirmation sheet — verify focus returns to Mint button
9. Navigate to subscription section — verify tier card labels
10. Navigate to tips section — verify preset amount labels include USD equivalent
    Document any VoiceOver regressions as blocking release issues.

**TalkBack (Android) Seller Hub → Earnings tab audit — required before every release candidate:**

1. Enable TalkBack on Android emulator (API 33+)
2. Navigate to Seller Hub
3. Verify headline total is announced correctly with ETH denomination
4. Activate "View as table" toggle — verify FlatList renders and each row is announced with day + amount
5. Navigate through all 7 stream cards — verify each announces stream name and ETH amount
6. Navigate to "Export CSV" button — verify label and activation

**iOS Color Filters grayscale test — required before every release candidate:**

1. Enable Settings → Accessibility → Display & Text Size → Color Filters → Grayscale on iPhone simulator
2. Open Universe Storefront
3. Verify rights classification badge is distinguishable by icon + text (not just color)
4. Open Seller Hub with chart visible
5. Verify chart stream segments have visible borders and tooltip text when tapped
6. Verify the "View as table" alternative renders correctly in grayscale

---

### 9. Rate Limiting Specifications

Rate limits are enforced via an in-process rate limiter in the Hono middleware layer, backed by a Redis sorted-set implementation (or Firestore atomic counters as a fallback if Redis is not available in the deployment environment). Rate limit state is stored per-user via the JWT `uid`.

| Endpoint                                | Burst limit                                        | Sustained limit | Key              | Client behavior                                                                                                                                                                                                                     | Notes                                                                                            |
| --------------------------------------- | -------------------------------------------------- | --------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `nft.mintContent` (via wagmi, not tRPC) | N/A — contract limits                              | N/A             | on-chain         | N/A                                                                                                                                                                                                                                 | `EpisodeNFT.sol` enforces max supply and price on-chain; no server-side rate limiting applicable |
| `nft.recordMint`                        | 10/min                                             | 50/hour         | per-user (`uid`) | Silent retry only if the call was part of the pending-record recovery flow; for normal calls, show a toast "Please wait before recording another mint"                                                                              | Idempotency for same txHash (see below)                                                          |
| `nft.createEpisodeListing`              | 20/min (to support bulk flow of 10 at ~2/min pace) | 100/day         | per-user         | Show per-item error in bulk progress list: "[Episode title] — Too many requests. Retry."                                                                                                                                            | Daily cap prevents listing spam                                                                  |
| `subscriptions.subscribe`               | 5/min                                              | —               | per-user         | Disable "Subscribe" button for a 30-second cooldown period after each call (successful or failed). Show countdown timer in button: "Try again in [N]s"                                                                              |                                                                                                  |
| `licensing.requestLicense`              | 3/min                                              | 10/hour         | per-user         | Show cooldown timer in the request form: "You can send another request in [N] seconds." Disable submit button during cooldown.                                                                                                      | 10/hour prevents license request spam toward creators                                            |
| `tips.recordTip`                        | 10/min                                             | —               | per-user         | Silent retry — the tip was real and must be recorded. Do not surface a rate limit error to the user; queue the retry after 10 seconds.                                                                                              | The retry mechanism must not count against the rate limit for the same txHash (idempotency)      |
| `ads.placeBid`                          | 5/min                                              | —               | per-user         | Disable "Place Bid" button for 15 seconds after each bid attempt. Show brief "Bid submitted — you can bid again shortly."                                                                                                           |                                                                                                  |
| `collabs.applyToCall`                   | 5/min                                              | —               | per-user         | Show cooldown: "You can apply to another call in [N] seconds."                                                                                                                                                                      | Per-call application is already gated by the duplicate check                                     |
| `collabs.createOpenCall`                | 3/hour                                             | 10/day          | per-user         | Hard error returned to client: display an error sheet "You can post at most 3 collab calls per hour. Try again in [N] minutes." Do not disable the button — show the error on tap.                                                  | Anti-spam for the public collab feed                                                             |
| `marketplace.submit`                    | 5/hour                                             | —               | per-user         | Hard error: "You can submit at most 5 canon proposals per hour." Error sheet with time until reset.                                                                                                                                 |                                                                                                  |
| `marketplace.vote`                      | 20/min                                             | —               | per-user         | Debounce at client: enforce a 1-second delay between vote taps. If the server returns 429, suppress the error toast and revert the optimistic update silently. Display "Voting too quickly — slow down." as a brief inline message. | High vote frequency is expected from engaged fans                                                |
| `seller.getEarningsSummary`             | 10/min                                             | —               | per-user         | Return a cached result with a `stale: true` flag in the response. Client displays a small "Refreshed [N] minutes ago" indicator next to the headline. Do not show an error — stale data is better than no data.                     | Caching (Section 10) is the primary defense; rate limiting is the backstop                       |

**`nft.recordMint` idempotency and rate limiting:**
The rate limiter for `recordMint` must treat repeated calls with the same `txHash` as a no-op, not as a rate-limited request. Implementation: before incrementing the rate limit counter, check the `processedTxHashes` collection. If the `txHash` is already present, return 200 immediately without incrementing the counter. Only increment the rate limit counter for genuinely new `txHash` values. This ensures the pending-record recovery flow (which retries on every app foreground) does not exhaust the rate limit for users whose `recordTip` or `recordMint` legitimately failed on the first attempt.

**Rate limit response format:**
All rate-limited responses return HTTP 429 with a JSON body:

```json
{
  "error": "RATE_LIMITED",
  "retryAfterSeconds": 47,
  "endpoint": "nft.createEpisodeListing"
}
```

The `retryAfterSeconds` field is used by the client to display countdown timers and schedule automatic retries where applicable.

**Redis key schema for rate limits:**

```
rate:uid:{userId}:endpoint:{endpointName}:burst     → sorted set (timestamp → count)
rate:uid:{userId}:endpoint:{endpointName}:sustained → sorted set (timestamp → count)
```

Keys expire automatically (TTL = sustained window duration × 2). On Redis unavailability (connection error), the rate limiter fails open (allows the request) and logs a warning. Rate limiting is a quality-of-service control, not a security control — security is enforced by authentication and server-side validation.

---

### 10. Caching Strategy

#### Cache Layer Architecture

Server-side cache uses Firestore documents as the cache store (keys in `serverCache/{cacheKey}` documents with `data`, `cachedAt`, and `ttlSeconds` fields). Client-side cache is React Query's in-memory cache with the configured TTLs below. For high-traffic production deployments, the server-side Firestore cache may be replaced with Redis without changing the client contract — the tRPC procedure interface remains identical.

#### Cache Table

| Data                                                               | Client TTL | Server TTL | Invalidation trigger                                                                                                                                                              | SWR? | Notes                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | ---------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Universe Storefront (all sections, via `storefrontCache` document) | 2 min      | 60s        | `nft.createEpisodeListing`, `nft.deactivateEpisode`, `subscriptions.configureTier`, `licensing.createMerch`, `marketplace.finalize` (ACCEPTED), `ads.createSlot`, `ads.acceptBid` | Yes  | Server cache keyed by `universeId`. Client SWR: show stale data immediately, refetch in background.                                                                                                                    |
| `nft.getEpisodesByUniverse`                                        | 2 min      | 60s        | Ponder `Mint` event handler (decrements supply in Firestore); `nft.createEpisodeListing` (adds new episode)                                                                       | Yes  | Short TTL because supply remaining changes on every mint. Client shows optimistic supply decrement for the user's own mint session.                                                                                    |
| `subscriptions.getTiers`                                           | 10 min     | 5 min      | `subscriptions.configureTier`                                                                                                                                                     | Yes  | Tier configuration changes are infrequent (weekly or less).                                                                                                                                                            |
| `licensing.getMerch` (by universe)                                 | 10 min     | 5 min      | `licensing.createMerch`, merch item deactivation                                                                                                                                  | Yes  |                                                                                                                                                                                                                        |
| `marketplace.getCanon` (by universe)                               | 5 min      | 2 min      | `marketplace.submit`, `marketplace.finalize`                                                                                                                                      | Yes  | Submission status changes trigger cache invalidation.                                                                                                                                                                  |
| `ads.getSlotsByUniverse`                                           | 5 min      | 2 min      | `ads.createSlot`, `ads.acceptBid`, `ads.deactivateSlot`                                                                                                                           | Yes  |                                                                                                                                                                                                                        |
| `seller.getEarningsSummary`                                        | 2 min      | 30s        | Any payment mutation (`recordMint`, `recordTip`, `subscribe`, payment webhook from Stripe for merch)                                                                              | Yes  | Most critical to be fresh for creator trust. Short server TTL despite fan-out cost. Cache hit rate must be > 80% to avoid Firestore overload — 30s TTL means at most 2 Firestore fan-out reads per creator per minute. |
| `analytics.getUniverseMetrics`                                     | 5 min      | 2 min      | `analytics.recordEngagement`, `analytics.recordView`                                                                                                                              | Yes  |                                                                                                                                                                                                                        |
| `collabs.listOpenCalls`                                            | 5 min      | 2 min      | `collabs.createOpenCall`, call deadline passing (evaluated at query time), `collabs.closeCall`                                                                                    | Yes  | Public endpoint, high-traffic. Aggressive server cache. Cache key includes sort parameter and page number.                                                                                                             |
| `ads.getImpressions`                                               | 5 min      | 60s        | `ads.recordImpression`                                                                                                                                                            | Yes  | Impression counts are append-only — cache is valid until a new impression is recorded. For high-impression slots (> 10,000), use the pre-aggregated `impressionSummary` document.                                      |
| `licensing.getLicenseRequests` (creator inbox)                     | 3 min      | 90s        | `licensing.requestLicense`, `licensing.respondToLicenseRequest`                                                                                                                   | Yes  | Creator needs to see new requests promptly.                                                                                                                                                                            |
| `collabs.getMyApplications` (buyer)                                | 5 min      | 2 min      | `collabs.applyToCall`, `collabs.acceptApplication`                                                                                                                                | Yes  | Used to populate the `appliedCallIds` set for duplicate prevention.                                                                                                                                                    |

#### Storefront Server-side Cache Architecture

The Universe Storefront is the highest-read surface in the system. A single popular universe may receive hundreds of concurrent storefront views. To avoid fan-out Firestore reads on every view, a pre-computed cache document is maintained at `storefrontCache/{universeId}`.

**Cache document structure:**

```typescript
interface StorefrontCacheDocument {
  universeId: string;
  cachedAt: Timestamp;
  ttlSeconds: number; // 60
  data: {
    episodes: EpisodeListing[];
    subscriptionTiers: SubscriptionTier[];
    merch: MerchItem[];
    canonSubmissions: CanonSubmission[];
    adSlots: AdSlot[];
    tipsEnabled: boolean;
    creatorAddress: string;
    rightsClassification: 'fan' | 'original' | 'licensed';
  };
}
```

**Cache read flow in `storefront.get` handler:**

1. Read `storefrontCache/{universeId}`.
2. If the document exists and `cachedAt + ttlSeconds > now()`, return `document.data` directly. No further Firestore reads.
3. If the document is missing or stale, execute the full fan-out read (episodes, tiers, merch, canon, slots, universe metadata). Write the result to `storefrontCache/{universeId}` with `cachedAt = now()`. Return the freshly computed data.

**Cache invalidation (synchronous, end of mutation):**
Each mutation handler that affects storefront data deletes (or overwrites) `storefrontCache/{universeId}` as the last operation before returning the response. The delete is a Firestore `doc.delete()` call. If this write fails, log the error but do not fail the mutation — a stale cache document is acceptable; a failed mutation is not.

Affected mutations:

- `nft.createEpisodeListing`: delete cache after the episode is written to Firestore.
- `nft.deactivateEpisode`: delete cache.
- `subscriptions.configureTier`: delete cache.
- `licensing.createMerch`: delete cache.
- `marketplace.finalize({ status: 'ACCEPTED' })`: delete cache (accepted canon affects the canon section).
- `ads.createSlot`: delete cache.
- `ads.acceptBid`: delete cache (slot status changes).

**Cache warming:**
A `warmStorefrontCache()` function is called:

1. On Hono server startup (via the `onStarted` lifecycle hook or a startup script) for the top 100 universes by `viewCount` in the `universes` collection.
2. Via a Bun cron job scheduled at 5-minute intervals: `Bun.serve` supports `import { CronJob } from 'bun'` — schedule `warmStorefrontCache()` every 300 seconds.

`warmStorefrontCache()` implementation:

```typescript
async function warmStorefrontCache(): Promise<void> {
  const top100 = await db.collection('universes').orderBy('viewCount', 'desc').limit(100).get();

  await Promise.allSettled(top100.docs.map((doc) => computeAndWriteStorefrontCache(doc.id)));
}
```

Individual universe cache misses in `warmStorefrontCache` are caught and logged — one universe failing to warm must not block the others. The function completes in < 30 seconds for 100 universes (100 fan-out reads in parallel, each ~200ms).

#### On-chain State Freshness

On-chain state (supply remaining, subscription access) is authoritative. The tRPC layer reads from Firestore (Ponder-indexed data). Maximum acceptable lag between an on-chain event and the storefront reflecting the update: **30 seconds** (Ponder indexing latency ~15s + server cache TTL 60s, with SWR the user may see data up to 90s old in the worst case, but the target for new viewers is 30s).

**Optimistic update after user's own mint:**
When the user successfully mints an episode, the client immediately applies an optimistic update to the React Query cache for `nft.getEpisodesByUniverse`:

```typescript
queryClient.setQueryData(['episodes', universeId], (old: EpisodeListing[]) =>
  old.map((ep) => (ep.id === mintedEpisodeId ? { ...ep, mintedCount: ep.mintedCount + 1 } : ep))
);
```

This optimistic decrement is applied regardless of whether the Ponder indexer has caught up. When the real data arrives (on next SWR refetch), the true value from Ponder overwrites the optimistic value. If the true value is ≥ the optimistic value (expected), the transition is seamless. If the true value is lower (indicating the optimistic update was premature — e.g., a Ponder reorg), the value reverts gracefully.

**Subscription access optimistic update:**
After `subscriptions.subscribe` succeeds, the client locally marks the tier as subscribed in the `subscriptions.getTiers` cache, showing the "Subscribed" badge immediately. The next SWR refetch (within 10 minutes) confirms the on-chain state via Ponder.
